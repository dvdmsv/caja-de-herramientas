// Verifica contenido, orientación y píxeles con el motor real compilado para el host.
import * as m from 'mupdf';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';
const executable=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Indica la ruta del lanzador Ghostscript del host.');
const dir=mkdtempSync(join(tmpdir(),'caja-grises-'));
try {
  const doc=new m.PDFDocument(),font=new m.Font('Helvetica'),fontRef=doc.addSimpleFont(font);
  const page=doc.addPage([0,0,300,200],0,{Font:{F:fontRef}},'1 0 0 rg 20 20 50 50 re f 0 0 1 rg BT /F 18 Tf 30 140 Td (Texto seleccionable) Tj ET');
  doc.insertPage(-1,page);
  const buffer=doc.saveToBuffer('compress');writeFileSync(join(dir,'entrada.pdf'),buffer.asUint8Array());
  buffer.destroy();page.destroy();fontRef.destroy();font.destroy();doc.destroy();
  const result=spawnSync(executable,['-q','-dNOPAUSE','-dBATCH','-dSAFER','-sDEVICE=pdfwrite',
    '-sColorConversionStrategy=Gray','-dProcessColorModel=/DeviceGray','-dAutoRotatePages=/None',
    '-sOutputFile='+join(dir,'salida.pdf'),'-f',join(dir,'entrada.pdf')],
    {env:{...process.env,LD_LIBRARY_PATH:dirname(executable)},timeout:30000,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const out=new m.PDFDocument(readFileSync(join(dir,'salida.pdf'))),p=out.loadPage(0),text=p.toStructuredText();
  assert.equal(out.countPages(),1);assert.deepEqual(p.getBounds(),[0,0,300,200]);
  assert.match(text.asText(),/Texto seleccionable/);
  const pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false),data=pix.getPixels();
  let tinta=0;
  for(let i=0;i<data.length;i+=3){assert.equal(data[i],data[i+1]);assert.equal(data[i+1],data[i+2]);if(data[i]<240)tinta++;}
  assert.ok(tinta>2500,'Se conservan el rectángulo y el texto');
  pix.destroy();text.destroy();p.destroy();out.destroy();
  console.log('Ghostscript real: gris neutro, texto seleccionable y orientación conservados.');
}finally{rmSync(dir,{recursive:true,force:true});}
