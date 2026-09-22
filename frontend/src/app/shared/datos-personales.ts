/**
 * Los tipos de dato personal que el servidor sabe encontrar.
 *
 * Aquí sólo están los **nombres**: quien busca de verdad, y quien valida que un
 * DNI lo sea, es `backend/api/patrones.py`. Los identificadores tienen que
 * coincidir con las claves de su `PATRONES`, que además rechaza los que no
 * conoce, así que una errata sale como un 400 y no como un tachado de menos.
 *
 * Vive en `shared/` porque lo usan dos pantallas que no se conocen entre ellas:
 * «Anonimizar PDF», que deja elegir cuáles buscar, y el visor, que los busca
 * todos y deja revisarlos antes de guardar.
 */

export interface TipoDeDato {
  id: string;
  nombre: string;
  /** Qué se hace para no confundirlo con otra cosa. Se enseña bajo la casilla. */
  ayuda: string;
}

export const TIPOS_DE_DATO: TipoDeDato[] = [
  {
    id: 'dni',
    nombre: 'DNI',
    ayuda: 'Se comprueba la letra, así que una factura de ocho cifras no cuela.',
  },
  {
    id: 'nie',
    nombre: 'NIE',
    ayuda: 'Los que empiezan por X, Y o Z, con su letra de control.',
  },
  {
    id: 'telefono',
    nombre: 'Teléfonos',
    ayuda: 'Nueve cifras que empiezan por 6, 7, 8 o 9, con o sin prefijo.',
  },
  {
    id: 'correo',
    nombre: 'Correos electrónicos',
    ayuda: 'Cualquier dirección escrita entera.',
  },
  {
    id: 'iban',
    nombre: 'Cuentas bancarias (IBAN)',
    ayuda: 'Se comprueba el dígito de control de la cuenta.',
  },
  {
    id: 'tarjeta',
    nombre: 'Tarjetas de crédito',
    ayuda: 'Se comprueba el dígito de Luhn.',
  },
  {
    id: 'cif',
    nombre: 'CIF de empresa',
    ayuda: 'Se comprueba su dígito de control, como el del DNI.',
  },
  {
    id: 'matricula',
    nombre: 'Matrículas',
    ayuda: 'Las modernas (1234 BCD) y las antiguas con provincia (M-1234-AB). '
      + 'Una referencia con esa misma forma también entraría.',
  },
  {
    id: 'codigo_postal',
    nombre: 'Códigos postales',
    ayuda: 'Sólo se comprueba que las dos primeras cifras sean una provincia, así que '
      + 'cualquier número de cinco cifras puede colarse. Marca sólo si te hace falta.',
  },
];

/**
 * Los que vienen marcados de serie.
 *
 * Quedan fuera los que pueden dar más falsos positivos que aciertos. El código
 * postal es el caso claro: cinco cifras seguidas son muchas cosas —un importe
 * sin separadores, una referencia—, y tachar de más estropea el documento tan
 * bien como tachar de menos.
 */
export const MARCADOS_DE_SERIE: Record<string, boolean> = Object.fromEntries(
  TIPOS_DE_DATO.map(tipo => [tipo.id, tipo.id !== 'codigo_postal']),
);

/** Todos los identificadores, para cuando se buscan todos. */
export const IDS_DE_DATO = TIPOS_DE_DATO.map(tipo => tipo.id);

/**
 * Cómo se llama un tipo, para enseñarlo.
 *
 * Lo que no esté en la lista es lo que ha encontrado la expresión que escribió
 * el usuario, que no tiene nombre porque se lo puso él.
 */
export function nombreDeDato(id: string): string {
  return TIPOS_DE_DATO.find(tipo => tipo.id === id)?.nombre ?? 'tu expresión';
}
