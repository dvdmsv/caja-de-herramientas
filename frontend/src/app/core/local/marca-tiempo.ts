import type * as MuPDF from 'mupdf';
import {abrirPdf,guardarPdf,base} from './pdf';
import {numerar} from './numeracion';
import type {PeticionMotor,ResultadoMotor} from './tipos';

export async function fechaVisible(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(p.archivos.length!==1||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un solo PDF.');
  if((p.opciones['modo']??(p.slug.endsWith('/previsualizar')?'visible':'criptografico'))!=='visible')throw new Error('El sello criptográfico requiere la autoridad de tiempo.');
  const raw=String(p.opciones['fecha']??'');
  const r=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if(!r||!Number.isFinite(Date.parse(raw)))throw new Error('Indica una fecha y hora válidas con su desplazamiento UTC.');
  const [,year,month,day,hour,minute,second='00',offset]=r;
  const days=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
  const zone=offset==='Z'?'+00:00':offset,zoneH=Number(zone.slice(1,3)),zoneM=Number(zone.slice(4,6));
  if(Number(year)<1||Number(month)<1||Number(month)>12||Number(day)<1||Number(day)>days||Number(hour)>23||Number(minute)>59||Number(second)>59||zoneH>14||zoneM>59||(zoneH===14&&zoneM!==0))throw new Error('La fecha o su desplazamiento UTC no son válidos.');
  const texto=`${day}/${month}/${year} ${hour}:${minute}:${second} UTC${zone}`;
  const doc=await abrirPdf(m,p.archivos[0]);
  try {
    for(let i=1;i<doc.countObjects();i++) {
      const obj=doc.newIndirect(i),range=obj.get('ByteRange'),contenido=obj.get('Contents');
      try{if(range.isArray()&&!contenido.isNull())throw new Error('Este PDF lleva firmas o sellos digitales. Usa un PDF sin firmas para añadir una fecha visible.');}finally{obj.destroy();range.destroy();contenido.destroy();}
    }
    const preview=p.slug.endsWith('/previsualizar');
    const pagina=Number(p.opciones['pagina']??1);
    if(preview&&(!Number.isInteger(pagina)||pagina<1||pagina>doc.countPages()))throw new Error('La página no existe.');
    numerar(m,doc,{...p.opciones,desde:1,empezar_en:1,alineacion:p.opciones['alineacion']??'derecha'},preview?pagina:undefined,texto);
    if(preview) {
      const page=doc.loadPage(pagina-1);
      try {
        const b=page.getBounds(),scale=Math.min(1.5,1400/Math.max(b[2]-b[0],b[3]-b[1]));
        const pix=page.toPixmap(m.Matrix.scale(scale,scale),m.ColorSpace.DeviceRGB,false);
        try{return {archivos:[{name:'vista.jpg',blob:new Blob([pix.asJPEG(85).slice()],{type:'image/jpeg'})}]};}finally{pix.destroy();}
      }finally{page.destroy();}
    }
    avance(doc.countPages(),doc.countPages());
    return {archivos:[{name:base(p.archivos[0].name)+'-marca-de-tiempo.pdf',blob:guardarPdf(doc)}]};
  }finally{doc.destroy();}
}
