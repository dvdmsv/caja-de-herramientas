import {
  BOVEDA_VACIA, CertificadoGuardado, FirmaGuardada, anadirCertificado, anadirFirma, leerContenido, quitar, renombrar,
} from './contenido';

const certificado: CertificadoGuardado = {
  id: 'c1', nombre: 'Mío', titular: 'PEPA', emisor: 'FNMT', hasta: '2028-01-01', p12: 'AAA', anadido: '2026-10-27',
};
const firma: FirmaGuardada = { id: 'f1', nombre: 'Firma', tipo: 'image/png', imagen: 'BBB', anadida: '2026-10-27' };

describe('contenido de la bóveda', () => {
  it('añadir, renombrar y quitar no tocan lo que reciben', () => {
    const con = anadirFirma(anadirCertificado(BOVEDA_VACIA, certificado), firma);
    expect(BOVEDA_VACIA).toEqual({ certificados: [], firmas: [] });

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
      .toEqual({ certificados: [certificado], firmas: [firma] });
  });
});
