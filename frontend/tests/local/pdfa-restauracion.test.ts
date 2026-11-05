import {it,expect} from 'vitest';
import * as m from 'mupdf';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {comprobarPdfa} from '../../src/app/core/local/pdfa';
const frontend=fileURLToPath(new URL('../../',import.meta.url));
const fixtureDir=fileURLToPath(new URL('./fixtures/pdfa/',import.meta.url));
const cases=JSON.parse(readFileSync(join(fixtureDir,'manifest.json'),'utf8')) as {id:string;original:string;aplanado:string;cambiado:boolean}[];
function inspect(bytes:Uint8Array){const d=new m.PDFDocument(bytes),pages=[];try{for(let n=0;n<d.countPages();n++){const p=d.loadPage(n),s=p.toStructuredText(),pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false);try{pages.push({text:s.asText().replace(/\s+/g,' ').trim(),bounds:p.getBounds(),pixels:pix.getPixels().slice()});}finally{pix.destroy();s.destroy();p.destroy();}}return pages;}finally{d.destroy();}}
async function restored(c:typeof cases[number]){const original=new Uint8Array(readFileSync(join(fixtureDir,c.original))),flat=new Uint8Array(readFileSync(join(fixtureDir,c.aplanado)));const r=await comprobarPdfa(m,{slug:'pdf-a-pdfa/restaurar-texto',archivos:[{name:c.id+'.pdf',blob:new Blob([flat])}],recursos:{'0':{name:'original.pdf',blob:new Blob([original])}},opciones:{}});expect(r.datos?.['cambiado']).toBe(c.cambiado);return {original,flat,bytes:new Uint8Array(await r.archivos[0].blob.arrayBuffer())};}
for(const c of cases)it('restauración PDF/A portable: '+c.id,async()=>{
 const r=await restored(c),before=inspect(r.original),flat=inspect(r.flat),after=inspect(r.bytes);expect(after).toHaveLength(before.length);
 for(let n=0;n<after.length;n++){expect(after[n].text).toBe(before[n].text);expect(after[n].bounds).toEqual(flat[n].bounds);expect(after[n].pixels).toEqual(flat[n].pixels);}
 if(!c.cambiado)expect(r.bytes).toEqual(r.flat);
});
// Integración opcional: motores reales del host, nunca se descargan durante el test.
const gs=process.env['PDFA_GS_LIB_DIR'],vera=process.env['PDFA_VERAPDF'];
for(const c of cases)it.skipIf(!gs||!vera)('segunda GS + veraPDF: '+c.id,async()=>{
 const r=await restored(c),dir=mkdtempSync(join(tmpdir(),'pdfa-integration-'));
 try{
  writeFileSync(join(dir,'entrada.pdf'),r.bytes);
  const compiler=spawnSync('javac',['-d',dir,resolve(frontend,'android/app/src/main/java/io/github/dvdmsv/cajadeherramientas/MotorGhostscript.java'),resolve(frontend,'tests/native/pdfa/ProbarPdfa.java')],{encoding:'utf8'});expect(compiler.status,compiler.stderr).toBe(0);
  const convert=spawnSync('java',['-cp',dir,'io.github.dvdmsv.cajadeherramientas.ProbarPdfa',gs!,dir,resolve(frontend,'src/assets/pdfa/srgb.icc'),'pdfa1'],{encoding:'utf8',timeout:60000});expect(convert.status,convert.stdout+convert.stderr).toBe(0);
  const out=new Uint8Array(readFileSync(join(dir,'salida.pdf'))),before=inspect(r.original),after=inspect(out);expect(after.map(p=>p.text)).toEqual(before.map(p=>p.text));expect(after.map(p=>p.bounds)).toEqual(before.map(p=>p.bounds));
  const check=spawnSync(vera!,['--format','xml',join(dir,'salida.pdf')],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});expect(check.status,check.stderr).toBe(0);expect(check.stdout).toContain('isCompliant="true"');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
