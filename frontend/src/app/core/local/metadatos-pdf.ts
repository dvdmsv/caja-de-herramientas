import type * as MuPDF from 'mupdf';
import {abrirPdf,guardarPdf,base} from './pdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';
import {quitarTextoInvisible} from './ocr-pdf';

const campos = [
  ['title','Title','Título'], ['author','Author','Autor'], ['subject','Subject','Asunto'],
  ['keywords','Keywords','Palabras clave'], ['creator','Creator','Creado con'],
  ['producer','Producer','Generado por'], ['creationDate','CreationDate','Fecha de creación'],
  ['modDate','ModDate','Fecha de modificación'],
] as const;

function objeto(valor:unknown):Record<string,unknown> {
  if(!valor || typeof valor!=='object' || Array.isArray(valor))throw new Error('Los ajustes de metadatos no son válidos.');
  return valor as Record<string,unknown>;
}
function fecha(clave:string,valor:string):string {
  if(!valor||!['creationDate','modDate'].includes(clave))return valor;
  const r=/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(valor);
  if(!r)throw new Error('Escribe la fecha como 31/12/2026 o 31/12/2026 09:30.');
  const [,d,m,y,h='00',min='00']=r;
  const date=new Date(`${y}-${m}-${d}T${h}:${min}:00Z`);
  if(!Number.isFinite(date.getTime())||date.getUTCDate()!==Number(d)||date.getUTCMonth()+1!==Number(m))throw new Error('La fecha no es válida.');
  return `D:${y}${m}${d}${h}${min}00`;
}
function legible(valor:string):string {
  const r=/^D:(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?/.exec(valor);
  return r?`${r[3]}/${r[2]}/${r[1]}${r[4]?` ${r[4]}:${r[5]}`:''}`:valor;
}

/** Adaptador PDF. Las imágenes se procesan en su adaptador sin rasterizar JPEG. */
export async function metadatosPdf(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona al menos un archivo.');
  const inspeccionar=p.slug.endsWith('/inspeccionar');
  const seleccion=p.opciones['seleccion']==null?null:objeto(p.opciones['seleccion']);
  const cambios=p.opciones['cambios']==null?{}:objeto(p.opciones['cambios']);
  const fondo=p.opciones['a_fondo']??false;
  if(typeof fondo!=='boolean')throw new Error('La opción de limpieza a fondo no es válida.');
  const resultado:ResultadoMotor={archivos:[]};
  const informes:unknown[]=[];
  for(const [i,entrada] of p.archivos.entries()) {
    const id=p.opciones.file_ids?.[i]??String(i);
    const doc=await abrirPdf(m,entrada);
    try {
      const trailer=doc.getTrailer(),root=trailer.get('Root');
      try {
        if(inspeccionar) {
          const listado:Array<{clave:string;etiqueta:string;valor:string;texto:string;editable:boolean}>=campos.map(([clave,pdf,etiqueta])=>{
            const texto=legible((doc.getMetaData('info:'+pdf)??'').trim());
            return {clave,etiqueta,texto,valor:texto.length>120?texto.slice(0,119)+'…':texto,editable:true};
          });
          const xmp=root.get('Metadata');
          try {if(!xmp.isNull())listado.push({clave:'xmp',etiqueta:'Metadatos XMP',valor:'un bloque incrustado en el documento',texto:'',editable:false});}finally{xmp.destroy();}
          informes.push({id,archivo:entrada.name,campos:listado,ubicacion:false});
          continue;
        }
        const borrar=seleccion===null?null:seleccion[id]??[];
        if(borrar!==null&&(!Array.isArray(borrar)||!borrar.every(x=>typeof x==='string')))throw new Error('La selección de metadatos no es válida.');
        const nuevos=objeto(cambios[id]??{});
        for(const [clave,valor] of Object.entries(nuevos)) {
          if(!campos.some(c=>c[0]===clave)||typeof valor!=='string'||valor.length>500)throw new Error('El cambio de metadatos no es válido.');
          if(Array.isArray(borrar)&&borrar.includes(clave))throw new Error('No se puede borrar y cambiar el mismo dato.');
          fecha(clave,valor.trim());
        }
        if(fondo) {
          trailer.delete('Info');root.delete('Metadata');
          const fields=doc.newNull();try{doc.resetForm(fields,false);}finally{fields.destroy();}
          for(const [name,ref] of Object.entries(doc.getEmbeddedFiles())) {ref.destroy();doc.deleteEmbeddedFile(name);}
          for(let n=0;n<doc.countPages();n++) {
            const page=doc.loadPage(n),obj=doc.findPage(n);
            try {
              obj.delete('Thumb');
              let redactions=false;
              for(const annotation of page.getAnnotations()) {
                const annot=annotation.getObject(),reply=annot.get('IRT');
                try {
                  if(!reply.isNull()){page.deleteAnnotation(annotation);continue;}
                  annot.delete('Popup');
                  if(annotation.getType()==='FileAttachment') {
                    const stream=annot.get('FS','EF','F');try{if(stream.isStream())stream.writeStream(' ');}finally{stream.destroy();}
                  }
                  if(annotation.getType()==='Redact')redactions=true;
                }finally{reply.destroy();annot.destroy();}
              }
              if(redactions)page.applyRedactions(true,m.PDFPage.REDACT_IMAGE_NONE,m.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,m.PDFPage.REDACT_TEXT_REMOVE);
              page.update();
            }finally{page.destroy();obj.destroy();}
            quitarTextoInvisible(m,doc,n);
          }
          for(let xref=1;xref<doc.countObjects();xref++) {
            const obj=doc.newIndirect(xref),type=obj.get('Type'),action=obj.get('S');
            try {
              if(action.asName()==='JavaScript'){obj.delete('JS');obj.delete('S');}
              if(obj.isDictionary()||obj.isStream())obj.delete('Metadata');
              if(type.asName()==='Metadata'&&obj.isStream())obj.writeStream('deleted');
            }finally{obj.destroy();type.destroy();action.destroy();}
          }
        }
        if(borrar===null) {trailer.delete('Info');root.delete('Metadata');}
        else {
          // Tras la limpieza a fondo ya no hay Info: no queda nada que borrar.
          const info=trailer.get('Info');
          try {if(info.isDictionary())for(const [clave,pdf] of campos)if(borrar.includes(clave))info.delete(pdf);}finally{info.destroy();}
          if(borrar.includes('xmp'))root.delete('Metadata');
        }
        for(const [clave,valor] of Object.entries(nuevos)) {
          const campo=campos.find(c=>c[0]===clave)!;
          doc.setMetaData('info:'+campo[1],fecha(clave,(valor as string).trim()));
        }
        const sinCambios=!fondo&&Array.isArray(borrar)&&borrar.length===0&&Object.keys(nuevos).length===0;
        resultado.archivos.push({name:base(entrada.name)+(fondo||borrar===null||(Array.isArray(borrar)&&borrar.length)?'-sin-metadatos.pdf':'-metadatos.pdf'),blob:sinCambios?entrada.blob:guardarPdf(doc,{clean:true,...(fondo?{garbage:2}:{})})});
      }finally{root.destroy();trailer.destroy();}
    }finally{doc.destroy();avance(i+1,p.archivos.length);}
  }
  if(inspeccionar)resultado.datos={metadatos:informes};
  return resultado;
}
