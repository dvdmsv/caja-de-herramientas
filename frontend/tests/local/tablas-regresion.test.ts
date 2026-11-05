import {describe,it,expect} from 'vitest';
import * as m from 'mupdf';
import * as XLSX from 'xlsx';
import {guardarPdf} from '../../src/app/core/local/pdf';
import {extraerTablas,importe} from '../../src/app/core/local/extraer-tablas';


const line=(x:number,y:number,X:number,Y:number)=>`${x} ${y} m ${X} ${Y} l S\n`;
const txt=(x:number,y:number,s:string)=>`BT /F1 10 Tf ${x} ${y} Td (${s.replace(/([()\\])/g,'\\$1')}) Tj ET\n`;
function grid(x=40,y=400,w=100,h=30,values=[['Codigo','Importe'],['08001','1.234,56']]) {
 let s='0 G 1 w\n';
 for(let c=0;c<=2;c++)s+=line(x+c*w,y,x+c*w,y-2*h);
 for(let r=0;r<=2;r++)s+=line(x,y-r*h,x+2*w,y-r*h);
 for(let r=0;r<2;r++)for(let c=0;c<2;c++)s+=txt(x+c*w+5,y-r*h-18,values[r][c]);
 return s;
}
function pdf(contents:string,rotation=0) {
 const d=new m.PDFDocument(),font=new m.Font('Helvetica');
 const page=d.addPage([0,0,600,600],rotation as any,{Font:{F1:d.addSimpleFont(font)}},contents);
 d.insertPage(-1,page);const blob=guardarPdf(d);page.destroy();font.destroy();d.destroy();return {name:'tablas.pdf',blob};
}
async function run(contents:string,formato='json',rotation=0,inspect=false) {
 const e=pdf(contents,rotation);const result=await extraerTablas(m,{slug:'extraer-tablas'+(inspect?'/inspeccionar':''),archivos:[e],opciones:{formato}},()=>{});
 return result;
}
async function json(contents:string,rotation=0) {const r=await run(contents,'json',rotation);return JSON.parse(await r.archivos[0].blob.text());}

describe('Auditoria independiente tablas Android',()=>{
 it('extrae rejilla simple y tipa importes conservando codigos',async()=>{
   const r=await json(grid());expect(r.tablas).toHaveLength(1);expect(r.tablas[0].filas).toEqual([['Codigo','Importe'],['08001',1234.56]]);
 });
 it('inspeccion coincide con exportacion',async()=>{
   const r=await run(grid(),'xlsx',0,true);expect(r.datos).toEqual({total:1,tablas:[{pagina:1,filas:2,columnas:2}]});expect(r.archivos).toEqual([]);
 });
 it('separa dos rejillas desconectadas',async()=>{
   const r=await json(grid()+grid(320,400));expect(r.tablas).toHaveLength(2);expect(r.tablas.map((t:any)=>t.filas)).toEqual([[['Codigo','Importe'],['08001',1234.56]],[['Codigo','Importe'],['08001',1234.56]]]);
 });
 it('no inventa tablas en texto alineado sin bordes',async()=>{
   const r=await run(txt(45,382,'Codigo')+txt(145,382,'Importe')+txt(45,352,'08001')+txt(145,352,'1.234,56'),'json',0,true);expect(r.datos?.['total']).toBe(0);
 });
 it('no convierte marco sencillo en tabla',async()=>{
   const r=await run('40 340 200 60 re S\n'+txt(45,382,'Aviso importante')+txt(45,352,'Texto dentro del recuadro'),'json',0,true);expect(r.datos?.['total']).toBe(0);
 });
 it.each([90,180,270])('iguala Windows con Rotate %s',async rotation=>{
   const esperado:Record<number,unknown>={90:[['08001','Codigo'],[1234.56,'Importe']],180:[[1234.56,'08001'],['Importe','Codigo']],270:[['Importe',1234.56],['Codigo','08001']]};
   const r=await json(grid(),rotation);expect(r.tablas).toHaveLength(1);expect(r.tablas[0].filas).toEqual(esperado[rotation]);
 });
 it('xlsx almacena codigos como texto e importes como numeros',async()=>{
   const r=await run(grid(),'xlsx');const book=XLSX.read(await r.archivos[0].blob.arrayBuffer());const sheet=book.Sheets[book.SheetNames[0]];
   expect(sheet.A2.t).toBe('s');expect(sheet.A2.v).toBe('08001');expect(sheet.B2.t).toBe('n');expect(sheet.B2.v).toBe(1234.56);
 });
 it('csv BOM punto y coma y escape de comillas',async()=>{
   const r=await run(grid(40,400,100,30,[['A;B','C"D'],['08001','12,50']]),'csv');
   expect([...new Uint8Array(await r.archivos[0].blob.slice(0,3).arrayBuffer())]).toEqual([239,187,191]);expect(await r.archivos[0].blob.text()).toBe('"A;B";"C""D"\r\n08001;12,50\r\n');
 });
 it('markdown escapa datos como texto',async()=>{
   const r=await run(grid(40,400,140,30,[['<script>x</script>','A|B'],['08001','12,50']]),'markdown');
   const s=await r.archivos[0].blob.text();expect(s).toContain('## Tabla 1 · Página 1');expect(s).toContain('A\\|B');expect(s).not.toContain('<script>');
 });
 it('numero español sin corromper codigos y porcentajes',()=>{
   expect(['08001','2026','45 %','(12,00','1.23','12345678'].map(importe)).toEqual(['08001','2026','45 %','(12,00','1.23','12345678']);
   expect(['(1.234,56)','€ 12','12,50','1.234'].map(importe)).toEqual([-1234.56,12,12.5,1234]);
 });
 it('respeta texto largo en celda combinada sin desplazarlo a otra columna',async()=>{
   let s=line(40,400,240,400)+line(40,370,240,370)+line(40,340,240,340)+line(40,400,40,340)+line(240,400,240,340)+line(140,370,140,340);
   s+=txt(75,382,'Cabecera combinada muy larga')+txt(45,352,'Dato A')+txt(145,352,'Dato B');
   const r=await json(s);expect(r.tablas[0].filas[0][0]).toBe('Cabecera combinada muy larga');expect(r.tablas[0].filas[0][1]).toBe('');
 });
 it('no inventa celdas a partir de ejes y marcas de grafico',async()=>{
   const s=line(40,400,40,340)+line(40,340,240,340)+line(140,335,140,345)+line(240,335,240,345)+line(35,370,45,370)+line(35,400,45,400)+txt(50,382,'Serie A')+txt(150,382,'Serie B')+txt(50,352,'10')+txt(150,352,'20');
   const r=await run(s,'json',0,true);expect(r.datos?.['total']).toBe(0);
 });
 it('extrae factura con cuatro columnas y cinco filas como Windows',async()=>{
   const rows=[['Concepto','Uds','Precio','Importe'],['Horas de desarrollo','12','45,00','540,00'],['Licencia anual','1','1.200,00','1.200,00'],['Descuento','1','(120,00)','(120,00)'],['Total','','','1.620,00']];
   let contents='0 G 0.7 w\n';
   for(let i=0;i<rows.length;i++){let x=60;for(let j=0;j<4;j++){const w=[150,50,90,90][j];contents+=`${x} ${500-(i+1)*24} ${w} 24 re S\n`+txt(x+4,500-i*24-16,rows[i][j]);x+=w;}}
   contents+='60 280 340 60 re S\n'+txt(66,320,'Aviso: esto es un recuadro, no una tabla.');
   const blob=pdf(contents).blob;
   const r=await extraerTablas(m,{slug:'extraer-tablas',archivos:[{name:'factura.pdf',blob}],opciones:{formato:'json'}},()=>{});
   const j=JSON.parse(await r.archivos[0].blob.text());expect(j.tablas).toHaveLength(1);expect(j.tablas[0].filas).toEqual([
     ['Concepto','Uds','Precio','Importe'],['Horas de desarrollo','12',45,540],['Licencia anual','1',1200,1200],['Descuento','1',-120,-120],['Total','','',1620]
   ]);
 });
 it('rechaza formato desconocido',async()=>{await expect(run(grid(),'docx')).rejects.toThrow('formato');});
 it('rechaza PDF corrupto',async()=>{await expect(extraerTablas(m,{slug:'extraer-tablas',archivos:[{name:'roto.pdf',blob:new Blob(['%PDF-1.7 basura'])}],opciones:{}},()=>{})).rejects.toThrow();});
 it('rechaza archivo no PDF por extension',async()=>{
   const e=pdf(grid());await expect(extraerTablas(m,{slug:'extraer-tablas',archivos:[{...e,name:'documento.txt'}],opciones:{}},()=>{})).rejects.toThrow();
 });
});
