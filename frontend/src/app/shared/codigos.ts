/**
 * Lo que pone dentro de un código, desglosado para poder leerlo.
 *
 * Un QR de wifi lleva la cadena `WIFI:S:Oficina;T:WPA;P:clave;;`, y un lector
 * que la enseñe tal cual no sirve para lo que se quería: ver el nombre de la red
 * y la contraseña. Lo mismo con un `mailto:` de tres parámetros o con una
 * vCard de ocho líneas.
 *
 * Va aquí, fuera del componente y sin tocar el DOM, porque es lo que puede
 * equivocarse en silencio —una contraseña con un `;` dentro, un asunto con
 * acentos— y así se prueba con cadenas escritas a mano. Las clases que llegan
 * las pone `backend/api/tools/leer_codigo.py`.
 */

export interface CampoLeido {
  etiqueta: string;
  valor: string;
}

/**
 * Los campos legibles de un código, o una lista vacía si no hay nada que
 * desglosar (un enlace o un texto se leen tal cual).
 */
export function desglosar(clase: string, contenido: string): CampoLeido[] {
  switch (clase) {
    case 'wifi':
      return wifi(contenido);
    case 'correo':
      return correo(contenido);
    case 'telefono':
      return telefono(contenido);
    case 'contacto':
      return contacto(contenido);
    default:
      return [];
  }
}

const SEGURIDADES: Record<string, string> = {
  WPA: 'WPA/WPA2',
  WEP: 'WEP',
  nopass: 'Abierta, sin contraseña',
};

/**
 * `WIFI:S:red;T:WPA;P:clave;H:true;;`
 *
 * Los valores llevan con contrabarra los cuatro caracteres que la sintaxis usa
 * como separadores, así que hay que partir respetándola: una contraseña con un
 * `;` dentro es perfectamente legal y partir a lo bruto la cortaría por la mitad.
 */
function wifi(contenido: string): CampoLeido[] {
  const campos = new Map<string, string>();
  const cuerpo = contenido.slice('WIFI:'.length);

  let clave = '';
  let valor = '';
  let enValor = false;
  for (let i = 0; i < cuerpo.length; i++) {
    const letra = cuerpo[i];
    if (letra === '\\' && i + 1 < cuerpo.length) {
      valor += cuerpo[++i];
      continue;
    }
    if (letra === ':' && !enValor) {
      enValor = true;
      continue;
    }
    if (letra === ';') {
      if (clave) {
        campos.set(clave.toUpperCase(), valor);
      }
      clave = '';
      valor = '';
      enValor = false;
      continue;
    }
    if (enValor) {
      valor += letra;
    } else {
      clave += letra;
    }
  }

  const seguridad = campos.get('T') ?? 'nopass';
  const salida: CampoLeido[] = [{ etiqueta: 'Red', valor: campos.get('S') ?? '' }];
  salida.push({ etiqueta: 'Seguridad', valor: SEGURIDADES[seguridad] ?? seguridad });
  if (campos.get('P')) {
    salida.push({ etiqueta: 'Contraseña', valor: campos.get('P')! });
  }
  if ((campos.get('H') ?? '').toLowerCase() === 'true') {
    salida.push({ etiqueta: 'Red oculta', valor: 'Sí' });
  }
  return salida.filter(campo => campo.valor !== '');
}

/** `mailto:ana@ejemplo.es?subject=Hola&body=Qué tal` */
function correo(contenido: string): CampoLeido[] {
  const sinEsquema = contenido.slice('mailto:'.length);
  const corte = sinEsquema.indexOf('?');
  const direccion = corte < 0 ? sinEsquema : sinEsquema.slice(0, corte);

  const salida: CampoLeido[] = [{ etiqueta: 'Para', valor: decodificar(direccion) }];
  if (corte >= 0) {
    const extras = new URLSearchParams(sinEsquema.slice(corte + 1));
    for (const [clave, etiqueta] of [['subject', 'Asunto'], ['body', 'Mensaje']] as const) {
      const valor = extras.get(clave);
      if (valor) {
        salida.push({ etiqueta, valor });
      }
    }
  }
  return salida;
}

/** `tel:+34600123456` y `SMSTO:600123456:el mensaje` */
function telefono(contenido: string): CampoLeido[] {
  if (/^smsto:/i.test(contenido)) {
    const [, numero, ...resto] = contenido.split(':');
    const salida: CampoLeido[] = [{ etiqueta: 'Número', valor: numero ?? '' }];
    if (resto.length > 0 && resto.join(':')) {
      salida.push({ etiqueta: 'Mensaje', valor: resto.join(':') });
    }
    return salida;
  }
  return [{ etiqueta: 'Número', valor: contenido.slice('tel:'.length) }];
}

const ETIQUETAS_VCARD: Record<string, string> = {
  FN: 'Nombre',
  ORG: 'Organización',
  TEL: 'Teléfono',
  EMAIL: 'Correo',
  URL: 'Web',
  ADR: 'Dirección',
};

const ETIQUETAS_MECARD: Record<string, string> = {
  N: 'Nombre',
  ORG: 'Organización',
  TEL: 'Teléfono',
  EMAIL: 'Correo',
  URL: 'Web',
  ADR: 'Dirección',
};

/** Una vCard (`BEGIN:VCARD…`) o su prima corta, MECARD. */
function contacto(contenido: string): CampoLeido[] {
  if (/^mecard:/i.test(contenido)) {
    return contenido
      .slice('MECARD:'.length)
      .split(';')
      .map(trozo => {
        const corte = trozo.indexOf(':');
        return corte < 0 ? null : [trozo.slice(0, corte).toUpperCase(), trozo.slice(corte + 1)];
      })
      .filter((par): par is string[] => par !== null && par[1] !== '')
      .map(([clave, valor]) => ({ etiqueta: ETIQUETAS_MECARD[clave] ?? clave, valor }))
      .filter(campo => campo.etiqueta !== 'N' || campo.valor !== '');
  }

  return contenido
    .split(/\r?\n/)
    .map(linea => {
      const corte = linea.indexOf(':');
      if (corte < 0) {
        return null;
      }
      // Una línea de vCard puede traer parámetros: `TEL;TYPE=CELL:600…`.
      const clave = linea.slice(0, corte).split(';')[0].toUpperCase();
      return [clave, linea.slice(corte + 1).trim()];
    })
    .filter((par): par is string[] =>
      par !== null && par[1] !== '' && par[0] in ETIQUETAS_VCARD)
    .map(([clave, valor]) => ({ etiqueta: ETIQUETAS_VCARD[clave], valor: valor.replace(/;+$/, '') }));
}

/** Un `mailto:` puede traer la dirección con %40; sin esto se lee a medias. */
function decodificar(valor: string): string {
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}
