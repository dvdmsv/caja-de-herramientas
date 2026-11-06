import {
  BOVEDA_VACIA, CertificadoGuardado, FirmaGuardada, SecretoGuardado, anadirCertificado, anadirFirma, anadirSecreto,
  cambiarSecreto, enlaceDe, fichaCompleta, filtrarSecretos, leerContenido, limpiarDatos, quitar, renombrar,
} from './contenido';

const certificado: CertificadoGuardado = {
  id: 'c1', nombre: 'Mío', titular: 'PEPA', emisor: 'FNMT', hasta: '2028-01-01', p12: 'AAA', anadido: '2026-10-27',
};
const firma: FirmaGuardada = { id: 'f1', nombre: 'Firma', tipo: 'image/png', imagen: 'BBB', anadida: '2026-10-27' };

const secreto = (nombre: string, resto: Partial<SecretoGuardado> = {}): SecretoGuardado => ({
  id: nombre, nombre, secreto: 'clave', anadido: '2026-11-01', cambiado: '2026-11-01', ...resto,
});

describe('secretos', () => {
  it('añadir, cambiar y quitar no tocan lo que reciben', () => {
    const uno = anadirSecreto(BOVEDA_VACIA, secreto('GitHub', { usuario: 'pepa', notas: 'códigos' }));
    expect(BOVEDA_VACIA.secretos).toEqual([]);

    const dos = cambiarSecreto(uno, 'GitHub', { nombre: 'GitHub', secreto: 'nueva' }, '2026-11-06');
    expect(uno.secretos[0].secreto).toBe('clave');
    expect(dos.secretos[0]).toEqual({
      id: 'GitHub', nombre: 'GitHub', secreto: 'nueva', anadido: '2026-11-01', cambiado: '2026-11-06',
    });

    expect(quitar(dos, 'GitHub').secretos).toEqual([]);
    expect(dos.secretos).toHaveLength(1);
  });

  it('quitar y renombrar otra cosa no se lleva los secretos', () => {
    const con = anadirSecreto(anadirFirma(BOVEDA_VACIA, firma), secreto('GitHub'));
    expect(quitar(con, 'f1').secretos).toHaveLength(1);
    expect(renombrar(con, 'f1', 'Otra').secretos).toHaveLength(1);
  });

  it('renombrar no cambia un secreto: eso va por su ficha', () => {
    const con = anadirSecreto(BOVEDA_VACIA, secreto('GitHub'));
    expect(renombrar(con, 'GitHub', 'Otra').secretos[0].nombre).toBe('GitHub');
  });

  it('la ficha recorta lo que no es secreto y quita lo vacío, pero el secreto queda tal cual', () => {
    expect(limpiarDatos({ nombre: '  GitHub ', secreto: ' con espacios ', usuario: '  ', web: ' a.com ', notas: '\n' }))
      .toEqual({ nombre: 'GitHub', secreto: ' con espacios ', web: 'a.com' });
    expect(fichaCompleta({ nombre: 'x', secreto: ' ' })).toBe(true);
    expect(fichaCompleta({ nombre: ' ', secreto: 'x' })).toBe(false);
    expect(fichaCompleta({ nombre: 'x', secreto: '' })).toBe(false);
  });

  it('el buscador mira nombre, usuario y web, sin tildes y en orden alfabético', () => {
    const lista = [secreto('Router'), secreto('Área privada'), secreto('Banco', { usuario: 'Pepa', web: 'banco.es' })];
    expect(filtrarSecretos(lista, '').map(s => s.nombre)).toEqual(['Área privada', 'Banco', 'Router']);
    expect(filtrarSecretos(lista, 'area').map(s => s.nombre)).toEqual(['Área privada']);
    expect(filtrarSecretos(lista, 'PEPA').map(s => s.nombre)).toEqual(['Banco']);
    expect(filtrarSecretos(lista, 'banco.es').map(s => s.nombre)).toEqual(['Banco']);
  });

  it('el buscador nunca mira el secreto ni las notas', () => {
    const lista = [secreto('GitHub', { secreto: 'hunter2', notas: 'código 998877' })];
    expect(filtrarSecretos(lista, 'hunter')).toEqual([]);
    expect(filtrarSecretos(lista, '998877')).toEqual([]);
  });

  it('sólo se enlaza lo que es http o https', () => {
    expect(enlaceDe('github.com')).toBe('https://github.com/');
    expect(enlaceDe('  http://router.local/admin ')).toBe('http://router.local/admin');
    expect(enlaceDe('192.168.1.1:8080/x')).toBe('https://192.168.1.1:8080/x');
    expect(enlaceDe('javascript:alert(1)')).toBeNull();
    expect(enlaceDe('JavaScript:alert(1)')).toBeNull();
    expect(enlaceDe('data:text/html,hola')).toBeNull();
    expect(enlaceDe('file:///C:/x')).toBeNull();
    expect(enlaceDe('la del trabajo')).toBeNull();
    expect(enlaceDe('')).toBeNull();
    expect(enlaceDe(undefined)).toBeNull();
  });
});

describe('contenido de la bóveda', () => {
  it('añadir, renombrar y quitar no tocan lo que reciben', () => {
    const con = anadirFirma(anadirCertificado(BOVEDA_VACIA, certificado), firma);
    expect(BOVEDA_VACIA).toEqual({ certificados: [], firmas: [], secretos: [] });

    const renombrado = renombrar(con, 'c1', '  El de casa  ');
    expect(renombrado.certificados[0].nombre).toBe('El de casa');
    expect(con.certificados[0].nombre).toBe('Mío');

    const sin = quitar(renombrado, 'f1');
    expect(sin.firmas).toEqual([]);
    expect(renombrado.firmas).toHaveLength(1);
  });

  it('un nombre vacío no se admite', () => {
    const con = anadirCertificado(BOVEDA_VACIA, certificado);
    expect(renombrar(con, 'c1', '   ')).toBe(con);
  });

  it('lo descifrado se lee tolerando lo que falte o sobre', () => {
    expect(leerContenido(null)).toEqual(BOVEDA_VACIA);
    expect(leerContenido({ certificados: 'no' })).toEqual(BOVEDA_VACIA);
    expect(leerContenido({ certificados: [certificado, { id: 3 }, null], firmas: [firma, {}] }))
      .toEqual({ certificados: [certificado], firmas: [firma], secretos: [] });
  });

  it('una bóveda sin secretos se lee con la lista vacía', () => {
    expect(leerContenido({ certificados: [], firmas: [] }).secretos).toEqual([]);
    expect(leerContenido({ secretos: [secreto('Bien'), { id: 'x', nombre: 'sin secreto' }] }).secretos.map(s => s.nombre))
      .toEqual(['Bien']);
  });

  it('lo que no se conoce se conserva, y sobrevive a los cambios: reescribir lo leído no puede borrarlo', () => {
    const leido = leerContenido({ certificados: [], firmas: [firma], secretos: [], delFuturo: { algo: 1 } });

    const cambiado = renombrar(quitar(anadirCertificado(leido, certificado), 'f1'), 'c1', 'Otro');

    expect((cambiado as unknown as { delFuturo: unknown }).delFuturo).toEqual({ algo: 1 });
  });
});
