import { it, expect } from 'vitest';
import { cuerpoMarkdown, documentoMarkdown, visorMarkdown } from '../../src/app/core/local/markdown';

it('interpreta tareas, tablas numéricas, tachado y código sin red',()=>{
  const html=cuerpoMarkdown('- [x] Hecho\n- [ ] Pendiente\n\n~~Viejo~~\n\n| Concepto | Precio |\n|---|---|\n| Pan | 2 € |\n| **Total** | **2 €** |\n\n```javascript\nconst x = 1;\n```');
  expect(html).toContain('casilla marcada');expect(html).toContain('class="tarea"');
  expect(html).toContain('class="numero"');expect(html).toContain('class="total"');
  expect(html).toContain('<s>Viejo</s>');expect(html).toContain('hljs-keyword');
});
it('preserva opciones de tema y elimina redirecciones del contenido',()=>{
  const html=documentoMarkdown('<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><link rel="stylesheet" href="https://example.com/x.css">\n\n# Hola',{tema:'oscuro',acento:'verde',familia:'serif'});
  expect(html).toContain("default-src 'none'");expect(html).toContain("img-src data:");
  expect(html).not.toContain('http-equiv="refresh"');expect(html).not.toContain('href="https://example.com');
  expect(html).toContain('color-scheme:dark');expect(html).toContain('Charis SIL');
});
it('lee archivos Windows-1252 y devuelve el informe sin archivos nuevos',async()=>{
  const r=await visorMarkdown({slug:'visor-markdown/previsualizar',archivos:[{name:'nota.md',blob:new Blob([new Uint8Array([35,32,65,241,111])])}],opciones:{}});
  expect(r.archivos).toEqual([]);expect(r.datos?.['html']).toContain('Año');expect(r.datos?.['palabras']).toBe(1);
});
it('rechaza texto y archivo simultáneos y parámetros inválidos',async()=>{
  const p={slug:'visor-markdown/previsualizar',archivos:[{name:'a.md',blob:new Blob(['hola'])}],opciones:{texto:'otro'}};
  await expect(visorMarkdown(p)).rejects.toThrow('no los dos');
  expect(()=>documentoMarkdown('Hola',{tema:'inventado'})).toThrow('no son válidos');
});
