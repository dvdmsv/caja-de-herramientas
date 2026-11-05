import type * as MuPDF from 'mupdf';
import {abrirPdf,guardarPdf} from './pdf';
import {incorporar} from './ocr-pdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';

/** Verifica la declaración; la certificación completa corresponde a veraPDF. */
export async function comprobarPdfa(m:typeof MuPDF,p:PeticionMotor):Promise<ResultadoMotor> {
  if(p.slug.endsWith('/restaurar-texto'))return restaurarTexto(m,p);
  for(const entrada of p.archivos) {
    if(!/\.pdf$/i.test(entrada.name))throw new Error('Selecciona archivos PDF.');
    const doc=await abrirPdf(m,entrada);
    try {
      if(p.slug.endsWith('/validar'))continue;
      const trailer=doc.getTrailer(),meta=trailer.get('Root','Metadata');
      try {
        if(meta.isNull()||!meta.isStream())throw new Error('El resultado no declara un perfil PDF/A.');
        const buffer=meta.readStream();
        try {
          const xml=buffer.asString(),parte=String(p.opciones['perfil']).slice(0,1);
          const part=/<pdfaid:part[^>]*>\s*([12])\s*<\/pdfaid:part>/i.exec(xml)?.[1]??/pdfaid:part\s*=\s*["']([12])["']/i.exec(xml)?.[1];
          const conformidad=/<pdfaid:conformance[^>]*>\s*([ABU])\s*<\/pdfaid:conformance>/i.exec(xml)?.[1]??/pdfaid:conformance\s*=\s*["']([ABU])["']/i.exec(xml)?.[1];
          if(part!==parte||conformidad?.toUpperCase()!=='B')throw new Error('El resultado no declara el perfil PDF/A solicitado.');
        }finally{buffer.destroy();}
      }finally{meta.destroy();trailer.destroy();}
    }finally{doc.destroy();}
  }
  return {archivos:[]};
}

/** PDF/A-1 aplana transparencias; recupera el texto de páginas rasterizadas.
 * La salida se convierte otra vez con Ghostscript para incrustar fuentes y validar
 * las restricciones del perfil, sin volver a introducir transparencias. */
async function restaurarTexto(m:typeof MuPDF,p:PeticionMotor):Promise<ResultadoMotor> {
  const archivos:ResultadoMotor['archivos']=[];let cambiado=false;
  for(let i=0;i<p.archivos.length;i++) {
    const entrada=p.archivos[i],fuente=p.recursos?.[String(i)];
    if(!fuente)throw new Error('Falta el PDF original para conservar su texto.');
    const original=await abrirPdf(m,fuente),destino=await abrirPdf(m,entrada);let modificado=false;
    try {
      if(original.countPages()!==destino.countPages())throw new Error('La conversión ha cambiado el número de páginas.');
      for(let n=0;n<original.countPages();n++) {
        const source=original.loadPage(n),target=destino.loadPage(n);
        try {
          const a=source.toStructuredText(''),b=target.toStructuredText('');let restaurar=false;
          try {restaurar=Boolean(a.asText().trim())&&!b.asText().trim();}finally{a.destroy();b.destroy();}
          if(!restaurar)continue;
          const buffer=new m.Buffer(),writer=new m.DocumentWriter(buffer,'pdf','compress');
          try {
            const output=writer.beginPage(source.getBounds());
            let ultimo='';
            const mapas=new Map<string,Map<number,number>>();
            const emitir=(text:MuPDF.Text,matrix:MuPDF.Matrix)=>{
              // Algunos documentos pintan los mismos glifos con relleno y trazo.
              const serial:unknown[]=[];
              text.walk({showGlyph:(font,trm,glyph,unicode,wmode)=>{
                serial.push([font.getName(),trm,glyph,unicode,wmode]);
                if(glyph>=0&&unicode>=0) {
                  const nombre=font.getName().replace(/^[A-Z]{6}\+/,''),mapa=mapas.get(nombre)??new Map<number,number>();
                  if(mapa.has(glyph)&&mapa.get(glyph)!==unicode)throw new Error('Este PDF tiene fuentes con el mismo nombre y codificaciones incompatibles. Usa PDF/A-2b para conservar su texto.');
                  mapa.set(glyph,unicode);mapas.set(nombre,mapa);
                }
              }});
              const clave=JSON.stringify([matrix,serial]);
              if(clave!==ultimo)output.ignoreText(text,matrix);ultimo=clave;
            };
            const device=new m.Device({fillText:(text,ctm)=>emitir(text,ctm),strokeText:(text,_stroke,ctm)=>emitir(text,ctm),ignoreText:emitir});
            try {source.runPageContents(device,m.Matrix.identity);device.close();}finally{device.destroy();output.destroy();}
            writer.endPage();writer.close();
            const layer=new m.PDFDocument(buffer);
            try {
              // El escritor de MuPDF puede omitir glifos y emitir rangos Unicode
              // que Ghostscript interpreta de forma diferente. Mapear cada CID.
              const fonts=layer.findPage(0).getInheritable('Resources').get('Font');
              try {
                fonts.forEach((ref)=>{
                  const nombre=ref.get('BaseFont').asName().replace(/^[A-Z]{6}\+/,''),mapa=mapas.get(nombre);
                  if(!mapa)throw new Error('No se puede conservar la codificación de una fuente. Usa PDF/A-2b para conservar su texto.');
                  const utf16=(cp:number)=>{const s=String.fromCodePoint(cp);let hex='';for(let k=0;k<s.length;k++)hex+=s.charCodeAt(k).toString(16).padStart(4,'0');return hex;};
                  const pares=[...mapa].map(([gid,cp])=>`<${gid.toString(16).padStart(4,'0')}> <${utf16(cp)}>`);
                  let cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /CajaUnicode def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange\n';
                  for(let k=0;k<pares.length;k+=100){const grupo=pares.slice(k,k+100);cmap+=`${grupo.length} beginbfchar\n${grupo.join('\n')}\nendbfchar\n`;}
                  cmap+='endcmap CMapName currentdict /CMap defineresource pop end end';
                  const mapping=layer.addStream(cmap,{});try{ref.put('ToUnicode',mapping);}finally{mapping.destroy();}
                });
              }finally{fonts.destroy();}
              incorporar(m,destino,n,layer);
            }finally{layer.destroy();}
            modificado=true;
          }finally{writer.destroy();buffer.destroy();}
        }finally{source.destroy();target.destroy();}
      }
      archivos.push({name:entrada.name,blob:modificado?guardarPdf(destino,{garbage:2}):entrada.blob});
      cambiado ||= modificado;
    }finally{original.destroy();destino.destroy();}
  }
  return {archivos,datos:{cambiado}};
}
