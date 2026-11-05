import type * as MuPDF from 'mupdf';
import type { OpcionesMotor } from './tipos';

export function estampar(m: typeof MuPDF, doc: MuPDF.PDFDocument, n: number, comandos: string,
                         recursos: Record<string, unknown>, encima = true): void {
  const page = doc.loadPage(n), obj = doc.findPage(n);
  try {
    const form = doc.addStream(comandos, { Type:'XObject', Subtype:'Form', BBox:page.getBounds(), Resources:recursos });
    let resources = obj.getInheritable('Resources');
    if (resources.isNull()) { resources = doc.newDictionary(); obj.put('Resources',resources); }
    let xobjects = resources.get('XObject');
    if (xobjects.isNull()) { xobjects = doc.newDictionary(); resources.put('XObject',xobjects); }
    let name = 'CajaEstampa'; while(!xobjects.get(name).isNull()) name += '_';
    xobjects.put(name,form);
    const stream = doc.addStream(`q ${m.Matrix.invert(page.getTransform()).join(' ')} cm /${name} Do Q\n`,{});
    const old = obj.get('Contents'), contents = doc.newArray();
    const save = doc.addStream('q\n',{}), restore = doc.addStream('\nQ\n',{});
    if(!encima) contents.push(stream);
    contents.push(save);
    if(old.isArray()) for(let i=0;i<old.length;i++) contents.push(old.get(i));
    else if(!old.isNull()) contents.push(old);
    contents.push(restore);
    if(encima) contents.push(stream);
    obj.put('Contents',contents);
    for(const v of [form,resources,xobjects,stream,old,contents,save,restore]) v.destroy();
  } finally { page.destroy();obj.destroy(); }
}

export function marcaDeAgua(m: typeof MuPDF, doc: MuPDF.PDFDocument, o: OpcionesMotor,
                            imagen?: MuPDF.Image, solo?: number): void {
  const numero = (k:string,d:number,min:number,max:number,entero=false) => {
    const v=Number(o[k]??d);
    if(!Number.isFinite(v)||v<min||v>max||(entero&&!Number.isInteger(v))) throw new Error(`El valor de ${k} no es válido.`);
    return v;
  };
  const modo=String(o['modo']??'texto');
  if(!['texto','imagen'].includes(modo)) throw new Error('El modo de marca no es válido.');
  const opacidad=numero('opacidad',25,5,100,true)/100, giro=numero('giro',45,-180,180)*Math.PI/180;
  const c=Math.cos(giro),s=Math.sin(giro), mosaico=o['mosaico']===true, encima=o['encima']!==false;
  const texto=String(o['texto']??'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
  if(modo==='texto'&&(!texto||texto.length>120)) throw new Error('Escribe una marca de entre 1 y 120 caracteres.');
  if(modo==='imagen'&&!imagen) throw new Error('Sube la imagen de la marca.');
  const familia=String(o['fuente']??'sans'), color=String(o['color']??'negro');
  const fonts:Record<string,string[]>={sans:['Helvetica','Helvetica-Bold'],serif:['Times-Roman','Times-Bold'],mono:['Courier','Courier-Bold']};
  const colores:Record<string,number[]>={negro:[0,0,0],azul:[26/255,63/255,208/255],rojo:[200/255,30/255,30/255]};
  if(!fonts[familia]||!colores[color]) throw new Error('La fuente o el color no son válidos.');
  const tamano=numero('tamano',48,6,96,true), fraccion=numero('ancho',0.4,0.05,1);
  const font=new m.Font(fonts[familia][o['negrita']===false?0:1]);
  const ref=modo==='texto'?doc.addFont(font):doc.addImage(imagen!);
  try {
    const unidad=[...texto].reduce((sum,v)=>sum+font.advanceGlyph(font.encodeCharacter(v)),0);
    const hex=[...texto].map(v=>font.encodeCharacter(v).toString(16).padStart(4,'0')).join('');
    const posiciones=mosaico?Array.from({length:12},(_,k)=>[(k%3+0.5)/3,(Math.floor(k/3)+0.5)/4]):[[0.5,0.5]];
    for(let n=0;n<doc.countPages();n++) {
      if(solo!==undefined&&n!==solo-1) continue;
      const page=doc.loadPage(n),bounds=page.getBounds();page.destroy();
      const [x0,y0,x1,y1]=bounds,w=x1-x0,h=y1-y0;
      let contenido='';
      for(const [px,py] of posiciones) {
        const cx=x0+px*w,cy=y0+py*h;
        contenido+=`q /GS gs ${c} ${s} ${-s} ${c} ${cx} ${cy} cm `;
        if(modo==='texto') {
          let size=tamano;
          if(mosaico) size=Math.max(6,Math.min(size,w/3*0.9/(unidad*Math.abs(c)+0.7*Math.abs(s)),h/4*0.9/(unidad*Math.abs(s)+0.7*Math.abs(c))));
          contenido+=`BT /F ${size} Tf ${colores[color].join(' ')} rg 1 0 0 -1 ${-unidad*size/2} ${size*0.35} Tm <${hex}> Tj ET `;
        } else {
          const proporcion=imagen!.getHeight()/imagen!.getWidth();
          let iw=w*fraccion;
          if(mosaico) iw=Math.min(iw,w/3*0.9/(Math.abs(c)+proporcion*Math.abs(s)),h/4*0.9/(Math.abs(s)+proporcion*Math.abs(c)));
          const ih=iw*proporcion;
          contenido+=`${iw} 0 0 ${-ih} ${-iw/2} ${ih/2} cm /Im Do `;
        }
        contenido+='Q\n';
      }
      estampar(m,doc,n,contenido,{ExtGState:{GS:{Type:'ExtGState',ca:opacidad,CA:opacidad}},...(modo==='texto'?{Font:{F:ref}}:{XObject:{Im:ref}})},encima);
    }
  } finally {ref.destroy();font.destroy();}
}
