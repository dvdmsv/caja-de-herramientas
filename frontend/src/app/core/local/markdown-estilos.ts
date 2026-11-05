// Estilos compartidos con backend/api/tools/visor_markdown.py; resaltado highlight.js.
export const estilosMarkdown = {
  "FAMILIAS": {
    "sans": "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif",
    "serif": "'Charis SIL', Georgia, Cambria, 'Times New Roman', 'DejaVu Serif', serif"
  },
  "MONO": "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
  "PALETAS": {
    "claro": {
      "fondo": "#ffffff",
      "texto": "#1f2328",
      "titulo": "#14181c",
      "suave": "#4a535c",
      "borde": "#d9dee3",
      "zebra": "#f6f8fa",
      "codigo": "#eef1f4",
      "bloque": "#f6f8fa",
      "borde_bloque": "#dfe4e9",
      "linea": "#d5dbe1",
      "casilla": "#8a949e",
      "hecha": "#6b747d",
      "etiqueta": "#eef1f4",
      "borde_form": "#c9d0d7",
      "sobre_acento": "#ffffff"
    },
    "oscuro": {
      "fondo": "#16191d",
      "texto": "#d7dce1",
      "titulo": "#f1f3f5",
      "suave": "#a5aeb8",
      "borde": "#33393f",
      "zebra": "#1d2126",
      "codigo": "#262b31",
      "bloque": "#1d2126",
      "borde_bloque": "#33393f",
      "linea": "#3a4148",
      "casilla": "#7b8590",
      "hecha": "#8a949e",
      "etiqueta": "#242a30",
      "borde_form": "#3d454c",
      "sobre_acento": "#ffffff"
    }
  },
  "ESTILOS": "\n* { box-sizing: border-box; }\nhtml { background: var(--fondo); color: var(--texto); font-family: var(--letra);\n       font-size: 16px; line-height: 1.6; -webkit-text-size-adjust: 100%; }\nbody { margin: 0; }\nmain { max-width: 780px; margin: 0 auto; padding: 28px 20px 56px; overflow-wrap: anywhere; }\n\nh1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: 700; }\nh1 { font-size: 2em; color: var(--titulo); letter-spacing: -0.01em; margin: 0 0 0.7em;\n     padding-bottom: 0.3em; border-bottom: 3px solid var(--acento); }\nh2 { font-size: 1.3em; color: var(--acento-texto); background: var(--tenue);\n     border-left: 4px solid var(--acento); padding: 0.3em 0.7em; margin: 1.6em 0 0.8em; }\nh3 { font-size: 1.1em; color: var(--acento-texto); margin: 1.3em 0 0.5em; }\nh4, h5, h6 { font-size: 1em; color: var(--titulo); margin: 1.1em 0 0.4em; }\nh1 + h2, h2 + h3 { margin-top: 0.7em; }\n\np { margin: 0 0 0.8em; }\np[align=\"center\"] { text-align: center; }\np[align=\"right\"] { text-align: right; }\nh1 + p { color: var(--suave); }\na { color: var(--acento-texto); text-decoration: underline; text-underline-offset: 2px; }\nstrong { color: var(--titulo); }\nhr { border: 0; border-top: 1px solid var(--linea); margin: 1.5em 0; }\nimg { max-width: 100%; height: auto; }\ndiv[style*=\"page-break\"] { height: 0; border-top: 1px dashed var(--linea); margin: 2em 0; }\n\nul, ol { margin: 0 0 0.8em; padding-left: 1.6em; }\nli { margin: 0.2em 0; }\nli > ul, li > ol { margin: 0.15em 0 0.25em; }\nul > li::marker { color: var(--acento-texto); }\nol > li::marker { color: var(--acento-texto); font-weight: 600; }\n\ntable { display: block; width: max-content; max-width: 100%; overflow-x: auto;\n        border-collapse: collapse; margin: 0.4em 0 1.2em; font-size: 0.94em; line-height: 1.4; }\nth { background: var(--acento); color: var(--sobre-acento); font-weight: 600; text-align: left;\n     padding: 0.5em 0.8em; border: 1px solid var(--acento); }\ntd { padding: 0.45em 0.8em; border-bottom: 1px solid var(--borde); vertical-align: top; }\ntbody tr:nth-child(even) td { background: var(--zebra); }\ntd.numero, th.numero { text-align: right; white-space: nowrap; }\ntr.etiquetas td { background: var(--etiqueta); color: var(--suave); font-size: 0.88em;\n                  padding-top: 0.3em; padding-bottom: 0.3em; }\ntr.etiquetas td strong { color: var(--suave); font-weight: 600; }\ntr.total td { background: var(--tenue); border-top: 2px solid var(--acento); border-bottom: 0; }\ntable.cuadro { min-width: 45%; margin-left: auto; }\ntable.cuadro th { background: none; color: inherit; font-weight: 400; border: 0;\n                  border-bottom: 1px solid var(--borde); }\ntable.formulario th, table.formulario tr.etiquetas td { background: var(--etiqueta);\n    color: var(--suave); font-size: 0.88em; font-weight: 600;\n    border: 1px solid var(--borde-form); padding: 0.3em 0.8em; }\ntable.formulario td { border: 1px solid var(--borde-form); background: none; }\ntable.formulario tbody tr:nth-child(even) td { background: none; }\ntable.formulario tbody tr.etiquetas td { background: var(--etiqueta); }\n\nli.tarea { list-style: none; margin-left: -1.3em; }\n.casilla { display: inline-block; width: 0.85em; height: 0.85em; margin-right: 0.5em;\n           border: 1.5px solid var(--casilla); border-radius: 3px; vertical-align: -0.1em; }\n.casilla.marcada { background: var(--acento); border-color: var(--acento); }\nli.tarea:has(.marcada) { color: var(--hecha); }\n\nblockquote { margin: 0.3em 0 1em; padding: 0.5em 1em; border-left: 4px solid var(--acento);\n             background: var(--bloque); color: var(--suave); }\nblockquote p:last-child { margin-bottom: 0; }\n\ncode { font-family: var(--mono); font-size: 0.88em; background: var(--codigo);\n       border-radius: 4px; padding: 0.1em 0.35em; }\npre { font-family: var(--mono); font-size: 0.85em; line-height: 1.5; background: var(--bloque);\n      border: 1px solid var(--borde-bloque); border-radius: 6px; padding: 0.8em 1em;\n      margin: 0.3em 0 1em; overflow-x: auto; }\npre code { background: none; padding: 0; font-size: 1em; }\n\n@media (max-width: 480px) {\n  html { font-size: 15px; }\n  main { padding: 20px 14px 40px; }\n}\n",
  "COLORES_ACENTO": {
    "azul": {
      "base": "#1a56a8",
      "oscuro": "#123f7c",
      "tenue": "#eaf1fa"
    },
    "rojo": {
      "base": "#b3122c",
      "oscuro": "#8a0d21",
      "tenue": "#fbecee"
    },
    "verde": {
      "base": "#186b4c",
      "oscuro": "#0f4f37",
      "tenue": "#e8f3ee"
    },
    "grafito": {
      "base": "#3a4148",
      "oscuro": "#23282d",
      "tenue": "#eef0f2"
    }
  },
  "RESALTADO_CLARO": "pre code.hljs {\n  display: block;\n  overflow-x: auto;\n  padding: 1em\n}\ncode.hljs {\n  padding: 3px 5px\n}\n/*!\n  Theme: GitHub\n  Description: Light theme as seen on github.com\n  Author: github.com\n  Maintainer: @Hirse\n  Updated: 2021-05-15\n\n  Outdated base version: https://github.com/primer/github-syntax-light\n  Current colors taken from GitHub's CSS\n*/\n.hljs {\n  color: #24292e;\n  background: #ffffff\n}\n.hljs-doctag,\n.hljs-keyword,\n.hljs-meta .hljs-keyword,\n.hljs-template-tag,\n.hljs-template-variable,\n.hljs-type,\n.hljs-variable.language_ {\n  /* prettylights-syntax-keyword */\n  color: #d73a49\n}\n.hljs-title,\n.hljs-title.class_,\n.hljs-title.class_.inherited__,\n.hljs-title.function_ {\n  /* prettylights-syntax-entity */\n  color: #6f42c1\n}\n.hljs-attr,\n.hljs-attribute,\n.hljs-literal,\n.hljs-meta,\n.hljs-number,\n.hljs-operator,\n.hljs-variable,\n.hljs-selector-attr,\n.hljs-selector-class,\n.hljs-selector-id {\n  /* prettylights-syntax-constant */\n  color: #005cc5\n}\n.hljs-regexp,\n.hljs-string,\n.hljs-meta .hljs-string {\n  /* prettylights-syntax-string */\n  color: #032f62\n}\n.hljs-built_in,\n.hljs-symbol {\n  /* prettylights-syntax-variable */\n  color: #e36209\n}\n.hljs-comment,\n.hljs-code,\n.hljs-formula {\n  /* prettylights-syntax-comment */\n  color: #6a737d\n}\n.hljs-name,\n.hljs-quote,\n.hljs-selector-tag,\n.hljs-selector-pseudo {\n  /* prettylights-syntax-entity-tag */\n  color: #22863a\n}\n.hljs-subst {\n  /* prettylights-syntax-storage-modifier-import */\n  color: #24292e\n}\n.hljs-section {\n  /* prettylights-syntax-markup-heading */\n  color: #005cc5;\n  font-weight: bold\n}\n.hljs-bullet {\n  /* prettylights-syntax-markup-list */\n  color: #735c0f\n}\n.hljs-emphasis {\n  /* prettylights-syntax-markup-italic */\n  color: #24292e;\n  font-style: italic\n}\n.hljs-strong {\n  /* prettylights-syntax-markup-bold */\n  color: #24292e;\n  font-weight: bold\n}\n.hljs-addition {\n  /* prettylights-syntax-markup-inserted */\n  color: #22863a;\n  background-color: #f0fff4\n}\n.hljs-deletion {\n  /* prettylights-syntax-markup-deleted */\n  color: #b31d28;\n  background-color: #ffeef0\n}\n.hljs-char.escape_,\n.hljs-link,\n.hljs-params,\n.hljs-property,\n.hljs-punctuation,\n.hljs-tag {\n  /* purposely ignored */\n  \n}",
  "RESALTADO_OSCURO": "pre code.hljs {\n  display: block;\n  overflow-x: auto;\n  padding: 1em\n}\ncode.hljs {\n  padding: 3px 5px\n}\n/*!\n  Theme: GitHub Dark\n  Description: Dark theme as seen on github.com\n  Author: github.com\n  Maintainer: @Hirse\n  Updated: 2021-05-15\n\n  Outdated base version: https://github.com/primer/github-syntax-dark\n  Current colors taken from GitHub's CSS\n*/\n.hljs {\n  color: #c9d1d9;\n  background: #0d1117\n}\n.hljs-doctag,\n.hljs-keyword,\n.hljs-meta .hljs-keyword,\n.hljs-template-tag,\n.hljs-template-variable,\n.hljs-type,\n.hljs-variable.language_ {\n  /* prettylights-syntax-keyword */\n  color: #ff7b72\n}\n.hljs-title,\n.hljs-title.class_,\n.hljs-title.class_.inherited__,\n.hljs-title.function_ {\n  /* prettylights-syntax-entity */\n  color: #d2a8ff\n}\n.hljs-attr,\n.hljs-attribute,\n.hljs-literal,\n.hljs-meta,\n.hljs-number,\n.hljs-operator,\n.hljs-variable,\n.hljs-selector-attr,\n.hljs-selector-class,\n.hljs-selector-id {\n  /* prettylights-syntax-constant */\n  color: #79c0ff\n}\n.hljs-regexp,\n.hljs-string,\n.hljs-meta .hljs-string {\n  /* prettylights-syntax-string */\n  color: #a5d6ff\n}\n.hljs-built_in,\n.hljs-symbol {\n  /* prettylights-syntax-variable */\n  color: #ffa657\n}\n.hljs-comment,\n.hljs-code,\n.hljs-formula {\n  /* prettylights-syntax-comment */\n  color: #8b949e\n}\n.hljs-name,\n.hljs-quote,\n.hljs-selector-tag,\n.hljs-selector-pseudo {\n  /* prettylights-syntax-entity-tag */\n  color: #7ee787\n}\n.hljs-subst {\n  /* prettylights-syntax-storage-modifier-import */\n  color: #c9d1d9\n}\n.hljs-section {\n  /* prettylights-syntax-markup-heading */\n  color: #1f6feb;\n  font-weight: bold\n}\n.hljs-bullet {\n  /* prettylights-syntax-markup-list */\n  color: #f2cc60\n}\n.hljs-emphasis {\n  /* prettylights-syntax-markup-italic */\n  color: #c9d1d9;\n  font-style: italic\n}\n.hljs-strong {\n  /* prettylights-syntax-markup-bold */\n  color: #c9d1d9;\n  font-weight: bold\n}\n.hljs-addition {\n  /* prettylights-syntax-markup-inserted */\n  color: #aff5b4;\n  background-color: #033a16\n}\n.hljs-deletion {\n  /* prettylights-syntax-markup-deleted */\n  color: #ffdcd7;\n  background-color: #67060c\n}\n.hljs-char.escape_,\n.hljs-link,\n.hljs-params,\n.hljs-property,\n.hljs-punctuation,\n.hljs-tag {\n  /* purposely ignored */\n  \n}"
};
