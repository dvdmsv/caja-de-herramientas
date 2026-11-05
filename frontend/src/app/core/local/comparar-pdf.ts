import type * as MuPDF from 'mupdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';
import {abrirPdf,guardarPdf,base} from './pdf';
import {convertirTexto} from './documentos-texto';
import {alinear,huella,zonasCambiadas,recuadrar,type Pareja,type Zona} from './comparacion';
import {CUOTA_LOCAL,MAXIMO_PIXELES} from './catalogo';

export async function compararPdf(m:typeof MuPDF,p:PeticionMotor,avance:(hechos:number,total:number)=>void):Promise<ResultadoMotor> {
  if(p.archivos.length!==2||p.archivos.some(a=>!/\.pdf$/i.test(a.name)))throw new Error('Elige exactamente dos PDF para comparar.');
  if(p.opciones['imagenes']!==undefined&&typeof p.opciones['imagenes']!=='boolean')throw new Error('La opción de imágenes no es válida.');
  const docs:MuPDF.PDFDocument[]=[];
  try {
    for(const entrada of p.archivos)docs.push(await abrirPdf(m,entrada));
    if(docs.some(d=>d.countPages()>100))throw new Error('Se comparan documentos de hasta 100 páginas. Divide el PDF en tramos.');
    let caracteres=0;
    const textos=docs.map(doc=>Array.from({length:doc.countPages()},(_,n)=>{
      const page=doc.loadPage(n),text=page.toStructuredText();
      try {
        const s=text.asText();caracteres+=s.length;
        if(caracteres>2_000_000)throw new Error('El texto de los documentos supera dos millones de caracteres. Divide los PDF en tramos.');
        return s;
      }finally{text.destroy();page.destroy();}
    }));
    const parejas=alinear(textos[0].map(huella),textos[1].map(huella));
    const ilustraciones:{pareja:Pareja;jpeg:Uint8Array<ArrayBuffer>;w:number;h:number}[]=[];
    let bytes=0;
    const raster=(doc:MuPDF.PDFDocument,n:number)=>{
      const page=doc.loadPage(n);
      try {
        const [x0,y0,x1,y1]=page.getBounds();
        if(Math.ceil((x1-x0)*110/72)*Math.ceil((y1-y0)*110/72)>MAXIMO_PIXELES)throw new Error('Una página supera 20 megapíxeles al comparar.');
        return page.toPixmap(m.Matrix.scale(110/72,110/72),m.ColorSpace.DeviceRGB,false,true);
      }finally{page.destroy();}
    };
    for(const [i,pareja] of parejas.entries()) {
      let a:MuPDF.Pixmap|undefined,b:MuPDF.Pixmap|undefined;
      try {
        let zonas:Zona[]=[];
        if(pareja.a!==null&&pareja.b!==null) {
          a=raster(docs[0],pareja.a);b=raster(docs[1],pareja.b);
          zonas=a.getWidth()!==b.getWidth()||a.getHeight()!==b.getHeight()?[[0,0,b.getWidth(),b.getHeight()]]:
            zonasCambiadas(a.getPixels(),b.getPixels(),b.getWidth(),b.getHeight());
          if(zonas.length)pareja.estado='cambiada';
        }
        if(p.opciones['imagenes']!==false&&pareja.estado!=='igual'&&ilustraciones.length<25) {
          if(!b)b=pareja.b!==null?raster(docs[1],pareja.b):raster(docs[0],pareja.a!);
          recuadrar(b.getPixels(),b.getWidth(),b.getHeight(),zonas);
          const jpeg=b.asJPEG(72).slice();bytes+=jpeg.length;
          if(bytes>CUOTA_LOCAL)throw new Error('Las imágenes del informe superan 250 MB. Desactiva las imágenes.');
          ilustraciones.push({pareja,jpeg,w:b.getWidth(),h:b.getHeight()});
        }
      }finally{a?.destroy();b?.destroy();}
      avance(i+1,parejas.length);
    }
    const lineas=textos.map(pags=>pags.join('\n').split(/\r?\n/).map(s=>s.trim()).filter(Boolean));
    const diferencias=alinear(lineas[0],lineas[1]).filter(p=>p.estado!=='igual');
    const cuentas={identicos:false,iguales:0,cambiadas:0,anadidas:0,quitadas:0,diferencias:diferencias.length};
    for(const pareja of parejas)cuentas[({igual:'iguales',cambiada:'cambiadas',añadida:'anadidas',quitada:'quitadas'} as const)[pareja.estado]]++;
    cuentas.identicos=!cuentas.cambiadas&&!cuentas.anadidas&&!cuentas.quitadas&&!diferencias.length;
    const escapar=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    let html=`<html><body><h1>Comparación de dos documentos</h1><p>Antes: ${escapar(p.archivos[0].name)} (${docs[0].countPages()} páginas)</p><p>Después: ${escapar(p.archivos[1].name)} (${docs[1].countPages()} páginas)</p>`;
    html+=cuentas.identicos?'<p>Los dos documentos dicen lo mismo y se ven igual. No se han detectado diferencias.</p>':
      `<p>${cuentas.iguales} páginas iguales, ${cuentas.cambiadas} cambiadas, ${cuentas.anadidas} añadidas y ${cuentas.quitadas} quitadas.</p><h2>Lo que cambia en el texto</h2>`;
    for(const diff of diferencias.slice(0,120)) {
      html+=`<p><b>${diff.estado==='añadida'?'Añadido':diff.estado==='quitada'?'Quitado':'Cambiado'}:</b> `;
      if(diff.a!==null)html+=`<del>${escapar(lineas[0][diff.a])}</del>`;
      if(diff.a!==null&&diff.b!==null)html+=' → ';
      if(diff.b!==null)html+=escapar(lineas[1][diff.b]);html+='</p>';
    }
    if(diferencias.length>120)html+=`<p>…y ${diferencias.length-120} cambios más.</p>`;
    if(!diferencias.length&&!cuentas.identicos)html+='<p>El texto es el mismo. Las diferencias son visuales o de páginas.</p>';
    if(!cuentas.identicos) {
      html+='<h2>Página a página</h2>';
      for(const pareja of parejas.filter(p=>p.estado!=='igual'))html+=`<p>Antes: ${pareja.a===null?'—':pareja.a+1}. Después: ${pareja.b===null?'—':pareja.b+1}. ${pareja.estado}.</p>`;
      html+=`<p>Se incluyen imágenes de ${ilustraciones.length} páginas, con un máximo de 25. Los recuadros rojos indican cambios visuales.</p>`;
    }
    html+='</body></html>';
    const informe=await convertirTexto(m,{slug:'html-a-pdf',archivos:[{name:'informe.html',blob:new Blob([html])}],opciones:{margen:15}},()=>{});
    const out=await abrirPdf(m,informe.archivos[0]);
    try {
      const font=new m.Font('Helvetica'),ref=out.addSimpleFont(font);
      try {
        for(const img of ilustraciones) {
          const image=new m.Image(img.jpeg),im=out.addImage(image);
          try {
            const scale=Math.min(535/img.w,720/img.h),w=img.w*scale,h=img.h*scale;
            const titulo=`Antes: ${img.pareja.a===null?'-':img.pareja.a+1} - Despues: ${img.pareja.b===null?'-':img.pareja.b+1}`;
            const page=out.addPage([0,0,595,842],0,{Font:{F:ref},XObject:{Im:im}},`BT /F 12 Tf 30 808 Td (${titulo}) Tj ET q ${w} 0 0 ${h} 30 ${780-h} cm /Im Do Q`);
            try{out.insertPage(-1,page);}finally{page.destroy();}
          }finally{im.destroy();image.destroy();}
        }
      }finally{ref.destroy();font.destroy();}
      const blob=guardarPdf(out);if(blob.size>CUOTA_LOCAL)throw new Error('El informe supera 250 MB.');
      return {archivos:[{name:`${base(p.archivos[0].name).slice(0,40)}-vs-${base(p.archivos[1].name).slice(0,40)}.pdf`,blob}],datos:{comparacion:cuentas}};
    }finally{out.destroy();}
  }finally{docs.forEach(d=>d.destroy());}
}
