from pathlib import Path
from docx import Document
from pptx import Presentation
from markitdown import MarkItDown
p=Path(__file__).parent
word=Document();word.add_heading('Título real',1);word.add_paragraph('Texto español básico.')
r=word.add_paragraph().add_run('No negrita');r.bold=False
r=word.add_paragraph().add_run('Estilo doble');r.bold=True;r.italic=True
word.add_paragraph('Elemento primero',style='List Bullet')
t=word.add_table(rows=2,cols=2);t.cell(0,0).text='Nombre';t.cell(0,1).text='Valor';t.cell(1,0).text='Uno';t.cell(1,1).text='Dos';word.save(p/'real.docx')
prs=Presentation()
for label in ['Primera','Segunda','Tercera']:
 s=prs.slides.add_slide(prs.slide_layouts[1]);s.shapes.title.text=label;s.placeholders[1].text='Contenido '+label
ids=prs.slides._sldIdLst;last=ids[-1];ids.remove(last);ids.insert(0,last);prs.save(p/'orden.pptx')
(p/'literal.md').write_text('```text\nuno\n\n\n\ncuatro\n```\n',encoding='utf8')
(p/'latin.txt').write_bytes('España, café y acción. Información del año español.'.encode('cp1252'))
(p/'simple.json').write_text('{"a": 1}',encoding='utf8')
conv=MarkItDown()
for name in ['real.docx','orden.pptx','literal.md','latin.txt','simple.json']:
 try:
  text=conv.convert(str(p/name)).text_content.strip();(p/(name+'.windows.md')).write_text(text,encoding='utf8');print(name,repr(text[:600]))
 except Exception as e:print(name,type(e).__name__,str(e)[:300])
