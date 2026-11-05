import {it,expect} from 'vitest';
import * as m from 'mupdf';
import {readFileSync} from 'node:fs';
import {comprobarPdfa} from '../../src/app/core/local/pdfa';
it('rechaza mapas incompatibles del mismo BaseFont antes de devolver texto corrupto',async()=>{
 const original=new Blob([readFileSync(new URL('./fixtures/pdfa/collision-original.pdf',import.meta.url))]);
 const doc=new m.PDFDocument(await original.arrayBuffer()),page=doc.loadPage(0),text=page.toStructuredText();
 try{expect(text.asText().replace(/\s+/g,' ').trim()).toBe('A Α');}finally{text.destroy();page.destroy();doc.destroy();}
 const flat=new Blob([readFileSync(new URL('./fixtures/pdfa/collision-aplanado.pdf',import.meta.url))]);
 await expect(comprobarPdfa(m,{slug:'pdf-a-pdfa/restaurar-texto',archivos:[{name:'flat.pdf',blob:flat}],recursos:{'0':{name:'original.pdf',blob:original}},opciones:{}})).rejects.toThrow('PDF/A-2b');
});
