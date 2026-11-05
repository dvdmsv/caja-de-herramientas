import {describe,it,expect,vi} from 'vitest';
import * as m from 'mupdf';
import {readFileSync} from 'node:fs';
import {correoPdf} from '../../src/app/core/local/correo';
const eml=(body='Cuerpo visible',more='')=>`From: Ana <ana@example.com>\r\nTo: Luis <luis@example.com>\r\nCc: copia@example.com\r\nSubject: =?UTF-8?B?UHJlc3VwdWVzdG8gZGVsIGHDsW8=?=\r\nDate: Fri, 30 Oct 2026 10:00:00 +0100\r\nMIME-Version: 1.0\r\n${more || 'Content-Type: text/plain; charset=utf-8'}\r\n\r\n${body}`;
const run=(source:string|Uint8Array,name='correo.eml')=>correoPdf(m,{slug:'correo-a-pdf',archivos:[{name,blob:new Blob([source as BlobPart])}],opciones:{}},()=>{});
async function text(blob:Blob){const d=new m.PDFDocument(await blob.arrayBuffer());let s='';try{for(let i=0;i<d.countPages();i++){const p=d.loadPage(i),st=p.toStructuredText();s+=st.asText();st.destroy();p.destroy();}}finally{d.destroy();}return s;}
const multipart=(parts:string[])=>eml(parts.map(p=>'--X\r\n'+p).join('\r\n')+'\r\n--X--','Content-Type: multipart/mixed; boundary=X');
const attachment=(name:string,data='AAECA//+')=>`Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}`;
describe('correo auditoria',()=>{
it('EML UTF8 cabeceras cuerpo y PDF',async()=>{const r=await run(eml('España, pingüino y acción'));expect(r.archivos[0].name).toBe('correo.pdf');const t=await text(r.archivos[0].blob);for(const s of ['Presupuesto del año','ana@example.com','luis@example.com','copia@example.com','España, pingüino y acción','2026'])expect(t).toContain(s);});
it('quoted printable ISO8859-1',async()=>{const r=await run(eml('Espa=F1a y caf=E9','Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable'));expect(await text(r.archivos[0].blob)).toContain('España y café');});
it('adjuntos bytes exactos y basename',async()=>{const r=await run(multipart(['Content-Type: text/plain\r\n\r\nCuerpo',attachment('../../prueba.bin')]));expect(r.archivos[1].name).toBe('prueba.bin');expect([...new Uint8Array(await r.archivos[1].blob.arrayBuffer())]).toEqual([0,1,2,3,255,254]);expect(await text(r.archivos[0].blob)).toContain('prueba.bin');});
it('nombres de adjuntos repetidos son unicos como Windows',async()=>{const r=await run(multipart(['Content-Type: text/plain\r\n\r\nCuerpo',attachment('datos.csv','dW5v'),attachment('datos.csv','ZG9z')]));expect(r.archivos.map(a=>a.name)).toEqual(['correo.pdf','datos.csv','datos-2.csv']);});
it('HTML activo remoto no se ejecuta ni solicita',async()=>{const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network prohibited'));try{const r=await run(eml('<p>Contenido seguro</p><script>globalThis.CORREO_PWN=1</script><img src="https://example.com/pixel"><iframe src="https://example.com"></iframe>','Content-Type: text/html; charset=utf-8'));expect(await text(r.archivos[0].blob)).toContain('Contenido seguro');expect((globalThis as any).CORREO_PWN).toBeUndefined();expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}});
it.each(['','Esto es una nota cualquiera.\n'])('rechaza EML invalido %j',async(source)=>{await expect(run(source)).rejects.toThrow();});
it('rechaza extension incorrecta',async()=>{await expect(run(eml(),'nota.txt')).rejects.toThrow(/EML o MSG/);});
it('rechaza entrada ausente',async()=>{await expect(correoPdf(m,{slug:'correo-a-pdf',archivos:[],opciones:{}},()=>{})).rejects.toThrow();});
it('rechaza MSG invalido con error comprensible',async()=>{await expect(run(new Uint8Array(100),'malo.msg')).rejects.toThrow(/MSG|correo/i);});
it('MSG real cabeceras cuerpo fecha',async()=>{const bytes=readFileSync('/home/david/Desarrollos/merge-pdf/backend/tests/archivos/outlook.msg');const r=await run(bytes,'outlook.msg');const t=await text(r.archivos[0].blob);for(const s of ['Test Email Message','test.sender@example.com','test.recipient@example.com','This is the body of the test email message'])expect(t).toContain(s);expect(t).toMatch(/Fecha:[^\n]*2024/);});
it('progreso completo por correo',async()=>{const fn=vi.fn();const r=await correoPdf(m,{slug:'correo-a-pdf',archivos:[{name:'a.eml',blob:new Blob([eml()])},{name:'b.eml',blob:new Blob([eml()])}],opciones:{}},fn);expect(r.archivos).toHaveLength(2);expect(fn.mock.calls).toEqual([[1,2],[2,2]]);});
});
// PostalMime pasa la fecha a ISO en UTC; el servidor enseña la cabecera tal cual.
it('la fecha va como la escribió el remitente, con su zona horaria',async()=>{const t=await text((await run(eml())).archivos[0].blob);expect(t).toContain('Fri, 30 Oct 2026 10:00:00 +0100');expect(t).not.toContain('2026-10-30T09');});
