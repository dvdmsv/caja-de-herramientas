import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { AlmacenLocal, metadatos } from './almacen';
import { CUOTA_LOCAL, HERRAMIENTAS_LOCALES } from './catalogo';
import type { EntradaMotor, OpcionesMotor, PeticionMotor, ResultadoMotor } from './tipos';
import { Turno } from './turno';

@Injectable({ providedIn: 'root' })
export class LocalService {
  private nativo?: { id: string; desde: number; cancelar: () => void; hechos: number; total: number };
  private readonly almacen = new AlmacenLocal();
  private activo?: { id: string; worker: Worker; cancelar: () => void; hechos: number; total: number; desde: number };

  private readonly turno = new Turno();

  /**
   * Lo que pone a trabajar un motor espera su turno (`turno.ts`). El progreso,
   * la cancelación, la sesión y los archivos no: tienen que contestar justo
   * mientras otro trabaja.
   */
  atender(req: HttpRequest<unknown>, signal: AbortSignal): Promise<unknown> {
    const ruta = req.url.split('?')[0];
    const usaMotor = (ruta.startsWith('/api/tools/') && !ruta.endsWith('/formatos'))
      || /^\/api\/files\/[0-9a-f]{32}\/paginas$/.test(ruta);
    if (!usaMotor) return this.resolver(req, signal);
    return this.turno.ejecutar(signal, () => this.resolver(req, signal),
      () => new HttpErrorResponse({ status: 409, error: { error: 'Operación cancelada.' } }));
  }

  private async resolver(req: HttpRequest<unknown>, signal: AbortSignal): Promise<unknown> {
    const ruta = req.url.split('?')[0];
    const o = (req.body ?? {}) as OpcionesMotor;
    if (ruta.startsWith('/api/progreso/')) {
      const trabajo = this.activo ?? this.nativo;
      const id = ruta.split('/')[3];
      if (ruta.endsWith('/cancelar')) {
        if (trabajo?.id === id) trabajo.cancelar();
        return {};
      }
      return { estado: trabajo?.id === id ? { modo: 'pasos', etapa: 'Procesando en tu teléfono',
        desde: trabajo.desde, cancelable: true, hechos: trabajo.hechos, total: trabajo.total } : null };
    }
    if (ruta === '/api/session/uso') return { usado: (await this.almacen.todos()).reduce((n, a) => n + a.size, 0),
      tope: CUOTA_LOCAL, caduca: null, plazo: 0, al_cerrar: false };
    if (ruta === '/api/session/keepalive') return {};
    if (ruta === '/api/session' && req.method === 'DELETE') {
      this.activo?.cancelar(); this.nativo?.cancelar();
      await this.almacen.eliminar(); return {};
    }
    if (ruta === '/api/files' && req.body instanceof FormData) {
      const entradas = req.body.getAll('files').filter((a): a is File => a instanceof File);
      if (!entradas.length) throw new Error('Elige al menos un archivo.');
      return { files: (await this.almacen.guardar(entradas.map(a => ({ name: a.name, blob: a })), false)).map(metadatos) };
    }
    const archivo = /^\/api\/files\/([0-9a-f]{32})(?:\/(download|paginas))?$/.exec(ruta);
    if (archivo) {
      const [, id, accion] = archivo;
      if (req.method === 'DELETE') { await this.almacen.eliminar(id); return {}; }
      if (req.method === 'PATCH') return metadatos(await this.almacen.renombrar(id, String(o['name'] ?? '')));
      const entrada = await this.almacen.leer(id);
      if (accion === 'download') return entrada.blob;
      if (accion === 'paginas') {
        if (entrada.blob.type.startsWith('image/')) return { paginas: 1 };
        const resultado = await this.procesar({ slug: 'paginas', archivos: [entrada], opciones: {} }, '', signal);
        return JSON.parse(await resultado.archivos[0].blob.text());
      }
    }
    if (/^\/api\/tools\/[^/]+\/formatos$/.test(ruta)) {
      return { formatos: [
        { id: 'JPEG', nombre: 'JPG', extension: '.jpg', calidad: true },
        { id: 'PNG', nombre: 'PNG', extension: '.png', calidad: false },
        ...(!ruta.includes('pdf-a-imagen') ? [{ id: 'WEBP', nombre: 'WebP', extension: '.webp', calidad: true }] : []),
      ] };
    }
    if (req.method === 'POST' && ['/api/tools/marca-de-tiempo/previsualizar', '/api/tools/numerar-paginas/previsualizar', '/api/tools/efecto-escaner/previsualizar', '/api/tools/marca-de-agua/previsualizar'].includes(ruta)) {
      if (!Array.isArray(o.file_ids) || !o.file_ids.length) throw new Error('Selecciona un PDF.');
      const entrada = await this.almacen.leer(o.file_ids[0]);
      const resultado = await this.procesar({ slug: ruta.replace('/api/tools/', ''), archivos: [entrada], opciones: o, recursos: await this.recursos(o) }, '', signal);
      return resultado.archivos[0].blob;
    }
    if (req.method === 'POST' && ruta === '/api/tools/leer-codigo/inspeccionar') {
      if (!Array.isArray(o.file_ids) || !o.file_ids.length) throw new Error('Selecciona una imagen o un PDF.');
      const archivos = await Promise.all(o.file_ids.map(id => this.almacen.leer(id)));
      const resultado = await this.procesar({ slug: 'leer-codigo/inspeccionar', archivos, opciones: o }, '', signal);
      return resultado.datos;
    }
    if(req.method==='POST'&&ruta==='/api/tools/documento-a-pdf') {
      if(!Array.isArray(o.file_ids)||!o.file_ids.length)throw new Error('Selecciona al menos un documento.');
      if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
      const entradas=await Promise.all(o.file_ids.map(id=>this.almacen.leer(id)));
      for(const e of entradas)if(!/\.(docx?|odt|rtf|txt|xlsx?|ods|pptx?|odp)$/i.test(e.name))throw new Error('El formato Office no está admitido.');
      if(signal.aborted)throw new Error('Operación cancelada.');
      const controller=new AbortController(),cancelar=()=>controller.abort();
      this.nativo={id:req.headers.get('X-Trabajo-Id')??'',desde:Date.now()/1000,cancelar,hechos:0,total:entradas.length};
      signal.addEventListener('abort',cancelar,{once:true});
      try {
        const {operarFirma}=await import('./firmas-digitales');
        const archivos:EntradaMotor[]=[];
        for(const [i,entrada] of entradas.entries()) {
          const result=await operarFirma(entrada,'office',{},controller.signal);
          if(result.archivo)archivos.push(result.archivo);
          if(this.nativo)this.nativo.hechos=i+1;
        }
        if(controller.signal.aborted||signal.aborted)throw new Error('Operación cancelada.');
        return {files:(await this.almacen.guardar(archivos,true)).map(metadatos)};
      }finally{this.nativo=undefined;signal.removeEventListener('abort',cancelar);}
    }
    if(req.method==='POST'&&['/api/tools/limpiar-metadatos','/api/tools/limpiar-metadatos/inspeccionar'].includes(ruta)) {
      if(!Array.isArray(o.file_ids)||!o.file_ids.length)throw new Error('Selecciona al menos un archivo.');
      const inspeccionar=ruta.endsWith('/inspeccionar'),seleccion=o['seleccion'],cambios=o['cambios'];
      for(const value of [seleccion,cambios])if(value!==undefined&&value!==null&&(typeof value!=='object'||Array.isArray(value)))throw new Error('Los ajustes de metadatos no son válidos.');
      const archivos:EntradaMotor[]=[],informes:unknown[]=[];
      for(const id of o.file_ids) {
        if(signal.aborted)throw new Error('Operación cancelada.');
        const entrada=await this.almacen.leer(id);
        if(/\.pdf$/i.test(entrada.name)) {
          const result=await this.procesar({slug:inspeccionar?'limpiar-metadatos/inspeccionar':'limpiar-metadatos',archivos:[entrada],opciones:{...o,file_ids:[id]}},req.headers.get('X-Trabajo-Id')??'',signal);
          archivos.push(...result.archivos);
          if(inspeccionar)informes.push(...result.datos!['metadatos'] as unknown[]);
        } else {
          if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
          const selected=seleccion==null?null:(seleccion as Record<string,unknown>)[id]??[],edited=cambios==null?{}:(cambios as Record<string,unknown>)[id]??{};
          if((selected!==null&&(!Array.isArray(selected)||!selected.every(v=>typeof v==='string')))||!edited||typeof edited!=='object'||Array.isArray(edited))throw new Error('Los ajustes de metadatos no son válidos.');
          for(const [key,value] of Object.entries(edited))if(typeof value!=='string'||value.length>500||(Array.isArray(selected)&&selected.includes(key)))throw new Error('El cambio de metadatos no es válido.');
          const controller=new AbortController(),cancelar=()=>controller.abort();
          this.nativo={id:req.headers.get('X-Trabajo-Id')??'',desde:Date.now()/1000,cancelar,hechos:0,total:1};
          signal.addEventListener('abort',cancelar,{once:true});
          try {
            const {operarFirma}=await import('./firmas-digitales');
            const result=await operarFirma(entrada,'metadatos',{inspeccionar,seleccion:selected,cambios:edited},controller.signal);
            if(controller.signal.aborted||signal.aborted)throw new Error('Operación cancelada.');
            if(inspeccionar)informes.push({id,archivo:entrada.name,...result.metadatos});
            else if(result.archivo) {
              result.archivo.name=entrada.name.replace(/(\.[^.]+)$/,selected===null||selected.length?'-sin-metadatos$1':'-metadatos$1');
              archivos.push(result.archivo);
            }
          }finally{this.nativo=undefined;signal.removeEventListener('abort',cancelar);}
        }
      }
      if(signal.aborted)throw new Error('Operación cancelada.');
      return inspeccionar?{metadatos:informes}:{files:(await this.almacen.guardar(archivos,true)).map(metadatos)};
    }
    if(req.method==='POST'&&['/api/tools/firmar-certificado/certificado','/api/tools/firmar-certificado/apariencia'].includes(ruta)) {
      if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
      const {FirmasAndroid}=await import('./firmas-digitales');
      const datos=await FirmasAndroid.certificado(o);
      if(signal.aborted)throw new Error('Operación cancelada.');
      if(ruta.endsWith('/certificado'))return datos;
      const result=await this.procesar({slug:'firmar-certificado/apariencia',archivos:[],opciones:{...o,datos_certificado:datos},recursos:await this.recursos(o)},'',signal);
      return result.archivos[0].blob;
    }
    if(req.method==='POST'&&(ruta==='/api/tools/comprobar-firmas/inspeccionar'||ruta==='/api/tools/firmar-certificado'||(ruta==='/api/tools/marca-de-tiempo'&&(o['modo']??'criptografico')==='criptografico'))) {
      if(!Array.isArray(o.file_ids)||!o.file_ids.length)throw new Error('Selecciona un PDF.');
      if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
      const modo=ruta.includes('comprobar-firmas')?'inspeccionar':ruta.includes('marca-de-tiempo')?'tiempo':'firmar';
      if(modo!=='inspeccionar'&&o.file_ids.length!==1)throw new Error('Selecciona un solo PDF por operación.');
      const entradas=await Promise.all(o.file_ids.map(id=>this.almacen.leer(id)));
      const {FirmasAndroid,operarFirma,base64}=await import('./firmas-digitales');
      let opciones=o;
      if(modo==='firmar') {
        const datos=await FirmasAndroid.certificado(o);
        const preparado=await this.procesar({slug:'firmar-certificado/preparar',archivos:[entradas[0]],opciones:{...o,datos_certificado:datos,fecha_firma:new Date().toISOString()},recursos:await this.recursos(o)},'',signal);
        opciones={...o,...preparado.datos,apariencia:preparado.archivos.length?await base64(preparado.archivos[0].blob):''};
      }
      if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
      if(signal.aborted)throw new Error('Operación cancelada.');
      const controller=new AbortController(),cancelar=()=>controller.abort();
      this.nativo={id:req.headers.get('X-Trabajo-Id')??'',desde:Date.now()/1000,cancelar,hechos:0,total:entradas.length};
      signal.addEventListener('abort',cancelar,{once:true});
      try {
        const informes:unknown[]=[],archivos:EntradaMotor[]=[];
        for(const [i,entrada] of entradas.entries()) {
          const result=await operarFirma(entrada,modo,opciones,controller.signal);
          if(modo==='inspeccionar')informes.push({id:o.file_ids[i],archivo:entrada.name,firmas:result.firmas});
          else if(result.archivo)archivos.push(result.archivo);
          if(this.nativo)this.nativo.hechos=i+1;
        }
        if(controller.signal.aborted||signal.aborted)throw new Error('Operación cancelada.');
        return modo==='inspeccionar'?{informes}:{files:(await this.almacen.guardar(archivos,true)).map(metadatos)};
      }finally{this.nativo=undefined;signal.removeEventListener('abort',cancelar);}
    }
    if (req.method === 'POST' && ruta === '/api/tools/pdf-a-pdfa') {
      if(!Array.isArray(o.file_ids)||!o.file_ids.length)throw new Error('Selecciona al menos un PDF.');
      const perfil=o['perfil']??'2b',conOcr=o['ocr']??false,idioma=o['idioma']??'spa+eng';
      if(!['1b','2b'].includes(String(perfil))||typeof conOcr!=='boolean'||!['spa','eng','spa+eng'].includes(String(idioma)))throw new Error('Las opciones de PDF/A no son válidas.');
      let entradas:EntradaMotor[]=await Promise.all(o.file_ids.map(id=>this.almacen.leer(id)));
      const id=req.headers.get('X-Trabajo-Id')??'';
      await this.procesar({slug:'pdf-a-pdfa/validar',archivos:entradas,opciones:{}},id,signal);
      if(conOcr) {
        const reconocidas:EntradaMotor[]=[];
        for(const entrada of entradas) {
          const resultado=await this.procesar({slug:'ocr-pdf',archivos:[entrada],opciones:{idioma,rehacer:false}},id,signal);
          reconocidas.push({...resultado.archivos[0],name:entrada.name});
        }
        entradas=reconocidas;
      }
      if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
      if(signal.aborted)throw new Error('Operación cancelada.');
      const controller=new AbortController(),cancelar=()=>controller.abort();
      this.nativo={id,desde:Date.now()/1000,cancelar,hechos:0,total:entradas.length};
      signal.addEventListener('abort',cancelar,{once:true});
      let archivos:EntradaMotor[];
      try {
        const {convertirGrises}=await import('./ghostscript');
        archivos=await convertirGrises(entradas,controller.signal,(hechos,total)=>{
          if(this.nativo)Object.assign(this.nativo,{hechos,total});
        },undefined,perfil==='1b'?'pdfa1':'pdfa2');
        if(controller.signal.aborted)throw new Error('Operación cancelada.');
      } finally {this.nativo=undefined;signal.removeEventListener('abort',cancelar);}
      if(perfil==='1b') {
        const restaurado=await this.procesar({slug:'pdf-a-pdfa/restaurar-texto',archivos,opciones:{},recursos:Object.fromEntries(entradas.map((entrada,n)=>[String(n),entrada]))},id,signal);
        if(restaurado.datos?.['cambiado'])archivos=await this.convertirNativo(restaurado.archivos,signal,id,'pdfa1');
      }
      await this.procesar({slug:'pdf-a-pdfa/verificar',archivos,opciones:{perfil}},id,signal);
      if(signal.aborted)throw new Error('Operación cancelada.');
      return {files:(await this.almacen.guardar(archivos,true)).map(metadatos)};
    }
    if (req.method === 'POST' && ['/api/tools/crear-certificado','/api/tools/pdf-a-grises'].includes(ruta)) {
      if (this.activo || this.nativo) throw new Error('Espera a que termine la operación actual.');
      if (signal.aborted) throw new Error('Operación cancelada.');
      let cancelado = false;
      const controlador = new AbortController();
      const cancelar = () => { cancelado = true; controlador.abort(); };
      this.nativo = { id: req.headers.get('X-Trabajo-Id') ?? '', desde: Date.now()/1000, cancelar, hechos: 0, total: 1 };
      signal.addEventListener('abort', cancelar, { once: true });
      try {
        let archivos: EntradaMotor[];
        if (ruta.endsWith('/pdf-a-grises')) {
          if (!Array.isArray(o.file_ids) || !o.file_ids.length) throw new Error('Selecciona un PDF.');
          const entradas = await Promise.all(o.file_ids.map(id => this.almacen.leer(id)));
          const { convertirGrises } = await import('./ghostscript');
          archivos = await convertirGrises(entradas, controlador.signal, (hechos,total) => {
            if (this.nativo) Object.assign(this.nativo,{hechos,total});
          });
        } else {
          const { crearCertificadoAndroid } = await import('./android');
          archivos = await crearCertificadoAndroid(o);
        }
        if (cancelado || signal.aborted) throw new Error('Operación cancelada.');
        return { files: (await this.almacen.guardar(archivos, true)).map(metadatos) };
      } finally { this.nativo = undefined; signal.removeEventListener('abort', cancelar); }
    }
    if (req.method === 'POST' && ruta === '/api/tools/firmar/preparar') {
      const resultado = await this.procesar({ slug: 'firmar/preparar', archivos: [], opciones: o, recursos: await this.recursos(o) }, '', signal);
      return resultado.archivos[0].blob;
    }
    if (req.method === 'POST' && ruta === '/api/tools/visor-markdown/previsualizar') {
      const ids = o.file_ids ?? [];
      if (!Array.isArray(ids)) throw new Error('La selección de archivos no es válida.');
      const archivos = await Promise.all(ids.map(id => this.almacen.leer(id)));
      const resultado = await this.procesar({ slug: 'visor-markdown/previsualizar', archivos, opciones: o }, '', signal);
      return resultado.datos;
    }
    if (req.method === 'POST' && ['/api/tools/extraer-tablas/inspeccionar', '/api/tools/pdf-a-epub/inspeccionar', '/api/tools/anonimizar-pdf/inspeccionar', '/api/tools/anonimizar-pdf/probar'].includes(ruta)) {
      const ids = o.file_ids ?? [];
      if (!Array.isArray(ids)) throw new Error('La selección de archivos no es válida.');
      const archivos = await Promise.all(ids.map(id => this.almacen.leer(id)));
      const resultado = await this.procesar({ slug: ruta.replace('/api/tools/', ''), archivos, opciones: o }, '', signal);
      return resultado.datos;
    }
    if(req.method==='POST'&&['/api/tools/comprimir-pdf','/api/tools/comprimir-pdf/minimo'].includes(ruta)&&o['web']===true) {
      if(!Array.isArray(o.file_ids)||!o.file_ids.length)throw new Error('Selecciona un PDF.');
      const entrada=await this.almacen.leer(o.file_ids[0]),minimo=ruta.endsWith('/minimo'),objetivo=Number(o['objetivo_mb']??0);
      if(!Number.isFinite(objetivo)||objetivo<0||objetivo>1000)throw new Error('El tamaño objetivo no es válido.');
      const bytes=Math.floor(objetivo*1024*1024),id=req.headers.get('X-Trabajo-Id')??'';
      let mejor:EntradaMotor|undefined;
      const pasos=minimo||bytes>0?8:1;
      for(let paso=0;paso<pasos;paso++) {
        const candidato=await this.procesar({slug:pasos===8?'comprimir-pdf/paso':'comprimir-pdf',archivos:[entrada],opciones:{...o,web:false,objetivo_mb:0,paso}},id,signal);
        const final=(await this.convertirNativo(candidato.archivos,signal,id,'linearizar'))[0];
        if(!mejor||final.blob.size<mejor.blob.size)mejor=final;
        if(!minimo&&bytes>0&&final.blob.size<=bytes){mejor=final;break;}
      }
      if(signal.aborted)throw new Error('Operación cancelada.');
      if(minimo)return {minimo:mejor!.blob.size,original:entrada.blob.size};
      return {files:(await this.almacen.guardar([mejor!],true)).map(metadatos),resumen:{antes:entrada.blob.size,despues:mejor!.blob.size},...(bytes?{objetivo:{bytes,logrado:mejor!.blob.size<=bytes}}:{})};
    }
    if (req.method === 'POST' && ruta === '/api/tools/comprimir-pdf/minimo') {
      if (!Array.isArray(o.file_ids) || !o.file_ids.length) throw new Error('Selecciona un PDF.');
      const archivos = [await this.almacen.leer(o.file_ids[0])];
      const resultado = await this.procesar({slug:'comprimir-pdf/minimo', archivos, opciones:{...o,web:false}}, req.headers.get('X-Trabajo-Id') ?? '', signal);
      return resultado.datos;
    }
    const slug = ruta === '/api/files/zip' ? 'zip' : ruta.replace('/api/tools/', '');
    if (req.method === 'POST' && (slug === 'zip' || HERRAMIENTAS_LOCALES.has(slug))) {
      const ids = o.file_ids ?? [];
      if (!Array.isArray(ids)) throw new Error('La selección de archivos no es válida.');
      const archivos = await Promise.all(ids.map(id => this.almacen.leer(id)));
      const resultado = await this.procesar({ slug, archivos, opciones:o, recursos:await this.recursos(o) }, req.headers.get('X-Trabajo-Id') ?? '', signal);
      if (signal.aborted) throw new Error('Operación cancelada.');
      const guardados = await this.almacen.guardar(resultado.archivos, true);
      return { ...resultado.datos, files: guardados.map(metadatos), resumen: resultado.resumen, objetivo: resultado.objetivo };
    }
    throw new Error('Esta función todavía no está disponible en Android.');
  }

  private async recursos(o: OpcionesMotor): Promise<Record<string, EntradaMotor>> {
    const recursos: Record<string, EntradaMotor> = {};
    for (const clave of ['imagen_id', 'firma_id', 'trazo_id']) {
      const id = o[clave];
      if (typeof id === 'string' && id) recursos[clave] = await this.almacen.leer(id);
    }
    return recursos;
  }

  private async convertirNativo(entradas:EntradaMotor[],signal:AbortSignal,id:string,operacion:'linearizar'|'pdfa1'|'pdfa2'):Promise<EntradaMotor[]> {
    if(this.activo||this.nativo)throw new Error('Espera a que termine la operación actual.');
    if(signal.aborted)throw new Error('Operación cancelada.');
    const controller=new AbortController(),cancelar=()=>controller.abort();
    this.nativo={id,desde:Date.now()/1000,cancelar,hechos:0,total:entradas.length};signal.addEventListener('abort',cancelar,{once:true});
    try {
      const {convertirGrises}=await import('./ghostscript');
      const result=await convertirGrises(entradas,controller.signal,(hechos,total)=>{if(this.nativo)Object.assign(this.nativo,{hechos,total});},undefined,operacion);
      if(controller.signal.aborted||signal.aborted)throw new Error('Operación cancelada.');
      return result;
    }finally{this.nativo=undefined;signal.removeEventListener('abort',cancelar);}
  }

  private procesar(peticion: PeticionMotor, id: string, signal: AbortSignal): Promise<ResultadoMotor> {
    if (signal.aborted) return Promise.reject(new Error('Operación cancelada.'));
    if (this.activo || this.nativo) return Promise.reject(new Error('Espera a que termine la operación actual.'));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./motor.worker', import.meta.url), { type: 'module' });
      let terminado = false;
      const limpiar = () => {
        terminado = true; worker.terminate(); clearTimeout(plazo);
        signal.removeEventListener('abort', cancelar);
        if (this.activo?.worker === worker) this.activo = undefined;
      };
      const cancelar = () => {
        if (terminado) return;
        limpiar(); reject(new HttpErrorResponse({ status: 409, error: { error: 'Operación cancelada.' } }));
      };
      const auxiliar = peticion.slug === 'anonimizar-pdf/probar' || peticion.slug === 'anonimizar-pdf/inspeccionar';
      // El OCR crece con las páginas (4,6 s cada una en un OnePlus 6 con un
      // solo Tesseract): con cinco minutos no pasaba de unas 65. Se puede
      // cancelar y enseña por qué página va, así que se le deja una hora.
      const ocr = peticion.slug === 'ocr-pdf';
      const plazo = setTimeout(() => {
        limpiar(); reject(new Error(auxiliar ? 'La búsqueda ha superado diez segundos. Simplifica la expresión o divide el PDF.'
          : ocr ? 'El reconocimiento ha superado una hora. Prueba a dividir el PDF.'
          : 'La operación ha superado cinco minutos. Prueba con un archivo más pequeño.'));
      }, auxiliar ? 10_000 : ocr ? 3_600_000 : 300_000);
      this.activo = { id, worker, cancelar, hechos: 0, total: 0, desde: Date.now() / 1000 };
      signal.addEventListener('abort', cancelar, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.tipo === 'progreso') {
          if (this.activo?.worker === worker) Object.assign(this.activo, { hechos: data.hechos, total: data.total });
          return;
        }
        limpiar();
        if (data.tipo === 'resultado') resolve(data.resultado);
        else reject(new Error(data.mensaje));
      };
      worker.onerror = () => { limpiar(); reject(new Error('No se ha podido iniciar el motor local. Actualiza Android System WebView y vuelve a abrir la app.')); };
      worker.postMessage(peticion);
    });
  }
}
