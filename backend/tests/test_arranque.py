"""Que el maestro precargado quepa en el perfil de sus hijos.

Esto no prueba ninguna herramienta: prueba la forma del despliegue, y existe por
un fallo que costó encontrar. Con `preload_app`, quien importa las bibliotecas
es el **maestro**, y cada hijo nace con su `VmData` heredado; encima,
`post_fork` le pone un `RLIMIT_DATA`. Si el maestro ya pasa de ese límite, el
hijo nace sin poder pedir un solo `mmap` nuevo, y eso **no se ve como un error de
memoria**: se ve como una biblioteca nativa que «no se puede mapear» y como
MuPDF abortando el proceso a media página.

Pasó de verdad: al añadir «Efecto escáner» entró numpy en el maestro, y OpenBLAS
reserva de entrada 639 MB de memoria virtual por sus hilos. `ligeros`, con 192
MB, dejó de funcionar **entero**, no sólo la herramienta nueva.

Se mide en un proceso aparte a propósito: el de pytest ya tiene medio proyecto
importado y no se parece en nada a un maestro recién arrancado.
"""
import subprocess
import sys
import textwrap

import pytest

RAIZ = __file__.rsplit('/tests/', 1)[0]


def en_un_proceso_limpio(guion: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, '-c', textwrap.dedent(guion)],
                          cwd=RAIZ, capture_output=True, text=True, timeout=180)


MEDIR = '''
    import sys
    sys.path.insert(0, '.')
    import app  # noqa: F401 — precarga lo mismo que el maestro de gunicorn
    for linea in open('/proc/self/status'):
        if linea.startswith('VmData'):
            print(int(linea.split()[1]) // 1024)
'''


def test_el_maestro_cabe_en_el_perfil_mas_estrecho():
    """Si esto falla, `ligeros` no arranca roto: arranca y va fallando."""
    import config

    hecho = en_un_proceso_limpio(MEDIR)
    assert hecho.returncode == 0, hecho.stderr[-800:]
    vmdata = int(hecho.stdout.strip().splitlines()[-1])

    tope = min(perfil['memoria_mb'] for perfil in config.PERFILES_TRABAJO.values())
    assert vmdata < tope, (
        f'El maestro precargado ocupa {vmdata} MB de memoria virtual de datos y el '
        f'perfil más estrecho da {tope} MB por trabajo. Sus hijos nacerán con el '
        f'límite ya superado y no podrán pedir memoria nueva. Mira qué se ha '
        f'empezado a importar en el arranque.')


@pytest.mark.parametrize('perfil', ['ligeros', 'pesados'])
def test_un_hijo_con_su_limite_puede_trabajar(perfil):
    """La prueba de verdad: con el límite puesto, ¿se puede seguir trabajando?

    Va en un proceso aparte porque el caso malo **aborta**: MuPDF lanza una
    excepción de C++ que nadie recoge, y eso pytest no lo puede atrapar.
    """
    import config

    memoria = config.PERFILES_TRABAJO[perfil]['memoria_mb']
    hecho = en_un_proceso_limpio(f'''
        import io, resource, sys
        sys.path.insert(0, '.')
        import app  # noqa: F401

        # Lo que hace `post_fork` en el hijo.
        resource.setrlimit(resource.RLIMIT_DATA, ({memoria} * 1024 * 1024,) * 2)

        # 1. Pedir memoria nueva.
        del_medio = bytearray(32 * 1024 * 1024)
        del del_medio

        # 2. Rasterizar, que es lo que hacen las vistas previas.
        import fitz
        from PIL import Image
        documento = fitz.open()
        pagina = documento.new_page()
        pagina.insert_text((72, 100), 'hola')
        imagen = Image.open(io.BytesIO(pagina.get_pixmap(dpi=150).tobytes('ppm')))
        assert imagen.size[0] > 0
        documento.close()

        # 3. Cargar una biblioteca nativa que el maestro no traía. Es lo que hace
        #    "Leer QR", y lo primero que se rompió.
        import zxingcpp  # noqa: F401
        print('bien')
    ''')

    assert hecho.returncode == 0, (
        f'Un trabajo de «{perfil}» ({memoria} MB) no puede trabajar con su propio '
        f'límite:\n{hecho.stderr[-800:]}')
    assert 'bien' in hecho.stdout
