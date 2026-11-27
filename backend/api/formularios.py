"""Selección de páginas sin perder el árbol AcroForm del documento."""
import re

import fitz


def seleccionar_paginas(documento: fitz.Document, paginas: list[int]) -> None:
    catalogo = documento.pdf_catalog()
    tipo, valor = documento.xref_get_key(catalogo, 'AcroForm')
    if tipo not in {'dict', 'xref'}:
        documento.select(paginas)
        return

    # Usar un objeto indirecto permite modificar Fields sin reescribir DR,
    # DA ni los demás recursos del formulario, incluso si venía directo.
    if tipo == 'dict':
        formulario = documento.get_new_xref()
        documento.update_object(formulario, valor)
        valor = f'{formulario} 0 R'
    else:
        formulario = int(valor.split()[0])

    conservados = set()
    padres = set()
    for numero in set(paginas):
        for xref, subtipo, _ in documento[numero].annot_xrefs():
            if subtipo != fitz.PDF_ANNOT_WIDGET:
                continue
            while xref not in conservados:
                conservados.add(xref)
                tipo_padre, padre = documento.xref_get_key(xref, 'Parent')
                if tipo_padre != 'xref':
                    break
                xref = int(padre.split()[0])
                padres.add(xref)

    # select también vacía Kids en campos padre. Guardar las listas antes.
    listas = []

    def filtrar(xref, clave):
        tipo_lista, lista = documento.xref_get_key(xref, clave)
        if tipo_lista == 'xref':
            lista = documento.xref_object(int(lista.split()[0]))
        elif tipo_lista != 'array':
            return
        referencias = [m.group() for m in re.finditer(r'(\d+)\s+\d+\s+R\b', lista)
                       if int(m.group(1)) in conservados]
        listas.append((xref, clave, '[' + ' '.join(referencias) + ']'))

    for padre in padres:
        filtrar(padre, 'Kids')
    filtrar(formulario, 'Fields')
    filtrar(formulario, 'CO')
    documento.select(paginas)
    if not conservados:
        return
    for xref, clave, referencias in listas:
        documento.xref_set_key(xref, clave, referencias)
    documento.xref_set_key(catalogo, 'AcroForm', valor)
