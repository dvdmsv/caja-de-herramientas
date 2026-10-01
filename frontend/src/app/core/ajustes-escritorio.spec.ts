import {
  Avanzado, RANGOS, SECCIONES, avanzadoDeSerie, esUrlSegura, fueraDeRango, seccionDe, textoDeEspera, textoDeMegas,
} from './ajustes-escritorio';

const deSerie: Avanzado = {
  memoria_porcentaje: null, prioridad_baja: null, subida_max_mb: null, cuota_mb: null, sello_tiempo: null,
};

describe('ajustes de la aplicación', () => {
  it('los rangos dicen por qué no vale un número', () => {
    expect(fueraDeRango('memoriaPorcentaje', 60)).toBeNull();
    expect(fueraDeRango('memoriaPorcentaje', 95)).toBe('Entre 30 y 90.');
    expect(fueraDeRango('cuotaMb', 500)).toBe('Entre 1024 y 102.400.');
    expect(fueraDeRango('subidaMaxMb', 2.5)).toBe('Tiene que ser un número entero.');
    expect(fueraDeRango('subidaMaxMb', Number.NaN)).toBe('Tiene que ser un número entero.');
  });

  it('los rangos son los mismos que en ajustes.rs', () => {
    // Si alguien cambia uno, que se acuerde del otro (escritorio/src-tauri/src/ajustes.rs).
    expect(RANGOS).toEqual({ memoriaPorcentaje: [30, 90], subidaMaxMb: [100, 8192], cuotaMb: [1024, 102_400] });
  });

  it('el sello de tiempo, sólo https', () => {
    expect(esUrlSegura('https://freetsa.org/tsr')).toBe(true);
    expect(esUrlSegura('http://freetsa.org/tsr')).toBe(false);
    expect(esUrlSegura('https://')).toBe(false);
    expect(esUrlSegura('https://a b')).toBe(false);
  });

  it('avanzado está de serie mientras todo sea null', () => {
    expect(avanzadoDeSerie(deSerie)).toBe(true);
    expect(avanzadoDeSerie({ ...deSerie, prioridad_baja: false })).toBe(false);
    expect(avanzadoDeSerie({ ...deSerie, memoria_porcentaje: 0 })).toBe(false);
  });

  it('las cantidades se leen como se dicen', () => {
    expect(textoDeEspera(10)).toBe('10 s');
    expect(textoDeEspera(60)).toBe('1 minuto');
    expect(textoDeEspera(300)).toBe('5 minutos');
    expect(textoDeMegas(2048)).toBe('2 GB');
    expect(textoDeMegas(1500)).toBe('1500 MB');
  });

  it('la sección sale del fragmento de la URL, y sin él la primera', () => {
    expect(seccionDe('avanzado').id).toBe('avanzado');
    expect(seccionDe(null).id).toBe('ventana');
    expect(seccionDe('no-existe').id).toBe('ventana');
    expect(SECCIONES.at(-1)!.id).toBe('avanzado');
  });
});
