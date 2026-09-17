"""Interpretación de lo que el usuario escribe en «qué páginas quiero»."""
import pytest


@pytest.fixture
def expandir(entorno):
    entorno()
    from api.tools.dividir_pdf import expandir_paginas
    return expandir_paginas


def test_expande_rangos_abiertos_y_quita_repetidos(expandir):
    # "10-" es "de la 10 al final"; "-3", "desde el principio hasta la 3".
    assert expandir('1-3, 7, 9-', 10) == [1, 2, 3, 7, 9, 10]
    assert expandir('-3', 10) == [1, 2, 3]
    # El orden lo marca quien escribe; una página repetida se queda con la
    # primera aparición.
    assert expandir('5, 1, 5', 10) == [5, 1]
    assert expandir('2;4 6', 10) == [2, 4, 6]


@pytest.mark.parametrize('texto, motivo', [
    ('', 'vacío'),
    ('   ', 'sólo espacios'),
    ('hola', 'no es un número'),
    ('5-2', 'del revés'),
    ('0-3', 'antes de la primera'),
    ('8-20', 'más allá de la última'),
    ('-', 'un guion suelto'),
])
def test_rechaza_rangos_invalidos(expandir, texto, motivo):
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        expandir(texto, 10)
    assert fallo.value.status == 400, motivo
