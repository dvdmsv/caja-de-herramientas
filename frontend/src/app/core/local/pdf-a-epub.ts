import type * as MuPDF from 'mupdf';
import MarkdownIt from 'markdown-it';
import {zipSync,strToU8,type Zippable} from 'fflate';
import {abrirPdf,base} from './pdf';
import {estructuraPdf,markdownEstructurado} from './estructura-pdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';

const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const xhtml=(titulo:string,cuerpo:string)=>`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><title>${xml(titulo)}</title><meta charset="utf-8"/><style>body{line-height:1.5}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid;padding:.3em}pre{white-space:pre-wrap}</style></head><body>${cuerpo}</body></html>`;

export async function pdfEpub(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona un PDF.');
  for(const k of ['titulo','autor'])if(p.opciones[k]!==undefined&&(typeof p.opciones[k]!=='string'||String(p.opciones[k]).length>300))throw new Error('El título y el autor deben tener un máximo de 300 caracteres.');
  if(p.opciones['portada']!==undefined&&typeof p.opciones['portada']!=='boolean')throw new Error('La opción de portada no es válida.');
  const entrada=p.archivos[0],doc=await abrirPdf(m,entrada);
  try {
    const titulo=String(p.opciones['titulo']??'').trim()||doc.getMetaData('info:Title')?.trim()||base(entrada.name);
    const autor=String(p.opciones['autor']??doc.getMetaData('info:Author')??'').trim();
    if(p.slug.endsWith('/inspeccionar')) {
      let conTexto=false;
      for(let i=0;i<Math.min(doc.countPages(),20)&&!conTexto;i++) {
        const page=doc.loadPage(i);
        try {const text=page.toStructuredText('');try{conTexto=Boolean(text.asText().trim());}finally{text.destroy();}}finally{page.destroy();}
      }
      return {archivos:[],datos:{titulo,autor,paginas:doc.countPages(),con_texto:conTexto}};
    }
    const paginas=estructuraPdf(m,doc,true,avance);
    if(!paginas.some(p=>p.lineas.length))throw new Error('Este PDF no tiene texto: pásalo antes por PDF con OCR.');
    const contenido=markdownEstructurado(paginas);
    const capitulos:Array<{titulo:string;texto:string}>=[];
    for(const seccion of contenido.texto.split(/(?=^# )/m)) {
      if(!seccion.trim())continue;
      capitulos.push({titulo:/^# (.+)/.exec(seccion)?.[1].replace(/[*`]/g,'')||titulo,texto:seccion});
    }
    const md=new MarkdownIt({html:false,xhtmlOut:true});
    const archivos:Zippable={mimetype:[strToU8('application/epub+zip'),{level:0}]};
    archivos['META-INF/container.xml']=strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    const manifest:string[]=['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'],spine:string[]=[],nav:string[]=[];
    if(p.opciones['portada']!==false) {
      const page=doc.loadPage(0);
      try {
        const caja=page.getBounds(),escala=1200/(caja[2]-caja[0]);
        if(1200*(caja[3]-caja[1])*escala>20_000_000)throw new Error('La portada supera 20 megapíxeles.');
        const pix=page.toPixmap(m.Matrix.scale(escala,escala),m.ColorSpace.DeviceRGB,false);
        try {archivos['EPUB/portada.png']=pix.asPNG().slice();}finally{pix.destroy();}
        archivos['EPUB/portada.xhtml']=strToU8(xhtml(titulo,'<img src="portada.png" alt="Portada"/>'));
        manifest.push('<item id="cover-image" href="portada.png" media-type="image/png" properties="cover-image"/>','<item id="cover" href="portada.xhtml" media-type="application/xhtml+xml"/>');
        spine.push('<itemref idref="cover"/>');
      }finally{page.destroy();}
    }
    for(const [i,c] of capitulos.entries()) {
      const id='capitulo-'+(i+1),nombre=id+'.xhtml';
      archivos['EPUB/'+nombre]=strToU8(xhtml(c.titulo,md.render(c.texto)));
      manifest.push(`<item id="${id}" href="${nombre}" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="${id}"/>`);nav.push(`<li><a href="${nombre}">${xml(c.titulo)}</a></li>`);
    }
    for(const [i,[nombre,datos]] of Object.entries(contenido.imagenes).entries()) {
      archivos['EPUB/'+nombre]=datos;manifest.push(`<item id="imagen-${i}" href="${nombre}" media-type="image/png"/>`);
    }
    archivos['EPUB/nav.xhtml']=strToU8(xhtml(titulo,`<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><h1>Índice</h1><ol>${nav.join('')}</ol></nav>`));
    archivos['EPUB/package.opf']=strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${xml(titulo)}</dc:title><dc:creator>${xml(autor)}</dc:creator><dc:language>es</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
    const bytes=zipSync(archivos,{level:6});
    if(bytes.length>250*1024*1024)throw new Error('El EPUB supera 250 MB.');
    return {archivos:[{name:base(entrada.name)+'.epub',blob:new Blob([bytes],{type:'application/epub+zip'})}]};
  }finally{doc.destroy();}
}
