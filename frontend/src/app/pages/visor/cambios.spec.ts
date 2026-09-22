import { Cambios, Marca, Texto } from './cambios';

const marca = (pagina: number, tipo: Marca['tipo'] = 'subrayado') => ({
  tipo,
  pagina,
  color: tipo === 'subrayado' ? ('amarillo' as const) : ('negro' as const),
  rects: [[0.1, 0.2, 0.5, 0.25]] as Marca['rects'],
  texto: 'lo que sea',
});

const texto = (pagina = 1, contenido = 'Juan Pérez'): Omit<Texto, 'id'> => ({
  pagina,
  x: 0.2,
  y: 0.3,
  rotacion: 0,
  texto: contenido,
  fuente: 'sans',
  tamano: 12,
  color: 'negro',
  negrita: false,
  cursiva: false,
});

describe('cambios del visor', () => {
  it('empieza sin nada que guardar', () => {
    const cambios = new Cambios();
    expect(cambios.hayAlgo).toBe(false);
    expect(cambios.sePuedeDeshacer).toBe(false);
  });

  it('acumula marcas con identificadores distintos', () => {
    const cambios = new Cambios();
    const a = cambios.marcar(marca(1));
    const b = cambios.marcar(marca(2));
    expect(a.id).not.toBe(b.id);
    expect(cambios.marcas.length).toBe(2);
  });

  it('deshace en orden inverso', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(1));
    cambios.girar(3);
    cambios.eliminar(5);

    cambios.deshacer();
    expect(cambios.eliminadas.has(5)).toBe(false);
    cambios.deshacer();
    expect(cambios.rotacionDe(3)).toBe(0);
    cambios.deshacer();
    expect(cambios.marcas.length).toBe(0);
    expect(cambios.sePuedeDeshacer).toBe(false);
  });

  it('deshacer devuelve la marca a su sitio en la lista', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(1));
    const enMedio = cambios.marcar(marca(2));
    cambios.marcar(marca(3));

    cambios.quitarMarca(enMedio.id);
    expect(cambios.marcas.map(m => m.pagina)).toEqual([1, 3]);
    cambios.deshacer();
    expect(cambios.marcas.map(m => m.pagina)).toEqual([1, 2, 3]);
  });

  it('gira en múltiplos de 90 y vuelve a cero al dar la vuelta', () => {
    const cambios = new Cambios();
    cambios.girar(1);
    cambios.girar(1);
    expect(cambios.rotacionDe(1)).toBe(180);
    cambios.girar(1);
    cambios.girar(1);
    expect(cambios.rotacionDe(1)).toBe(0);
    // Sin giro no hay nada que guardar de esa página.
    expect(cambios.rotaciones.size).toBe(0);
  });

  it('la petición conserva los números de página originales', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(5));
    cambios.eliminar(2);

    const peticion = cambios.aPeticion(6) as any;
    expect(peticion.subrayados[0].pagina).toBe(5);
    expect(peticion.paginas.map((p: any) => p.numero)).toEqual([1, 3, 4, 5, 6]);
  });

  it('no manda marcas de páginas que se van a eliminar', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(3));
    cambios.eliminar(3);
    expect((cambios.aPeticion(4) as any).subrayados.length).toBe(0);
  });

  it('separa subrayados de tachados', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(1, 'subrayado'));
    cambios.marcar(marca(1, 'tachado'));
    const peticion = cambios.aPeticion(2) as any;
    expect(peticion.subrayados.length).toBe(1);
    expect(peticion.tachados.length).toBe(1);
  });

  it('marcar muchas de golpe cuenta como un solo paso al deshacer', () => {
    // Es lo que hace «buscar y tachar todo»: arrepentirse no puede costar
    // cincuenta Ctrl+Z, ni enseñar por el camino estados que nadie ha pedido.
    const cambios = new Cambios();
    const antes = cambios.marcar(marca(1));

    cambios.marcarVarias([marca(1, 'tachado'), marca(2, 'tachado'), marca(3, 'tachado')]);
    expect(cambios.marcas.length).toBe(4);

    cambios.deshacer();
    expect(cambios.marcas.map(m => m.id)).toEqual([antes.id]);
  });

  it('marcar una lista vacía no deja un paso que deshacer', () => {
    const cambios = new Cambios();
    expect(cambios.marcarVarias([])).toEqual([]);
    expect(cambios.sePuedeDeshacer).toBe(false);
  });

  it('marcar muchas no borra lo que ya había marcado a mano', () => {
    const cambios = new Cambios();
    const mia = cambios.marcar(marca(1, 'tachado'));

    cambios.marcarVarias([marca(1, 'tachado')]);

    expect(cambios.marcas.map(m => m.id)).toContain(mia.id);
    expect(cambios.marcas.length).toBe(2);
  });

  it('sustituir una marca cuenta como un solo paso al deshacer', () => {
    const cambios = new Cambios();
    const vieja = cambios.marcar(marca(1));

    const nueva = cambios.marcar({ ...marca(1), color: 'verde' }, [vieja.id]);
    expect(cambios.marcas.map(m => m.id)).toEqual([nueva.id]);
    expect(cambios.marcas[0].color).toBe('verde');

    cambios.deshacer();
    // De una vez: vuelve la vieja y se va la nueva, sin estados intermedios.
    expect(cambios.marcas.map(m => m.id)).toEqual([vieja.id]);
    expect(cambios.marcas[0].color).toBe('amarillo');
  });

  it('la sustituida vuelve a su sitio en la lista', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(1));
    const enMedio = cambios.marcar(marca(2));
    cambios.marcar(marca(3));

    cambios.marcar(marca(2), [enMedio.id]);
    cambios.deshacer();
    expect(cambios.marcas.map(m => m.pagina)).toEqual([1, 2, 3]);
  });

  it('encuentra las marcas del mismo tipo que pisan una zona', () => {
    const cambios = new Cambios();
    const subrayado = cambios.marcar(marca(1));
    cambios.marcar(marca(1, 'tachado'));
    cambios.marcar({ ...marca(1), rects: [[0.1, 0.8, 0.5, 0.85]] });

    // Sólo la del mismo tipo y en la misma zona.
    expect(cambios.solapadas(1, 'subrayado', [[0.12, 0.2, 0.5, 0.25]])).toEqual([subrayado.id]);
    // Y nada en una página distinta.
    expect(cambios.solapadas(2, 'subrayado', [[0.1, 0.2, 0.5, 0.25]])).toEqual([]);
  });

  it('cambia el color y lo deshace', () => {
    const cambios = new Cambios();
    const puesta = cambios.marcar(marca(1));

    cambios.cambiarColor(puesta.id, 'azul');
    expect(cambios.marcas[0].color).toBe('azul');
    cambios.deshacer();
    expect(cambios.marcas[0].color).toBe('amarillo');
  });

  it('poner el mismo color no gasta un paso de deshacer', () => {
    const cambios = new Cambios();
    const puesta = cambios.marcar(marca(1));
    cambios.cambiarColor(puesta.id, 'amarillo');
    cambios.deshacer();
    expect(cambios.marcas.length).toBe(0);
  });

  it('sobrevive a una ida y vuelta por el borrador', () => {
    const cambios = new Cambios();
    cambios.marcar(marca(1));
    cambios.girar(2, 90);
    cambios.eliminar(4);

    const vuelto = Cambios.desdeBorrador(JSON.parse(JSON.stringify(cambios.aBorrador())));
    expect(vuelto.marcas.length).toBe(1);
    expect(vuelto.rotacionDe(2)).toBe(90);
    expect(vuelto.eliminadas.has(4)).toBe(true);
    // Y los identificadores siguen sin repetirse.
    expect(vuelto.marcar(marca(9)).id).not.toBe(cambios.marcas[0].id);
  });

  describe('textos escritos encima', () => {
    it('cuentan como algo que guardar', () => {
      const cambios = new Cambios();
      cambios.escribir(texto());
      expect(cambios.hayAlgo).toBe(true);
    });

    it('no comparten identificador con las marcas', () => {
      const cambios = new Cambios();
      const marcado = cambios.marcar(marca(1));
      const escrito = cambios.escribir(texto());
      expect(escrito.id).not.toBe(marcado.id);
    });

    it('editar el contenido y el estilo se deshace de una vez', () => {
      const cambios = new Cambios();
      const { id } = cambios.escribir(texto());

      expect(cambios.editarTexto(id, { texto: 'Ana', tamano: 20, negrita: true })).toBe(true);
      expect(cambios.textos[0]).toEqual(expect.objectContaining({ texto: 'Ana', tamano: 20, negrita: true }));

      cambios.deshacer();
      expect(cambios.textos[0]).toEqual(expect.objectContaining({ texto: 'Juan Pérez', tamano: 12, negrita: false }));
    });

    it('editar sin cambiar nada no gasta un paso de deshacer', () => {
      const cambios = new Cambios();
      const { id } = cambios.escribir(texto());
      cambios.deshacer();  // se vacía la pila
      expect(cambios.editarTexto(id, { tamano: 12 })).toBe(false);
      expect(cambios.sePuedeDeshacer).toBe(false);
    });

    it('mover y volver a su sitio', () => {
      const cambios = new Cambios();
      const { id } = cambios.escribir(texto());
      expect(cambios.moverTexto(id, 0.6, 0.7)).toBe(true);
      expect([cambios.textos[0].x, cambios.textos[0].y]).toEqual([0.6, 0.7]);
      cambios.deshacer();
      expect([cambios.textos[0].x, cambios.textos[0].y]).toEqual([0.2, 0.3]);
    });

    it('quitar y recuperar en su posición de la lista', () => {
      const cambios = new Cambios();
      const primero = cambios.escribir(texto(1, 'uno'));
      cambios.escribir(texto(1, 'dos'));
      cambios.quitarTexto(primero.id);
      expect(cambios.textos.map(t => t.texto)).toEqual(['dos']);
      cambios.deshacer();
      expect(cambios.textos.map(t => t.texto)).toEqual(['uno', 'dos']);
    });
  });

  describe('lo que se le manda al servidor', () => {
    it('lleva los textos sin su identificador, que es cosa del navegador', () => {
      const cambios = new Cambios();
      cambios.escribir(texto());
      const peticion = cambios.aPeticion(3) as { textos: Record<string, unknown>[] };
      expect(peticion.textos.length).toBe(1);
      expect(peticion.textos[0]['id']).toBeUndefined();
      expect(peticion.textos[0]['texto']).toBe('Juan Pérez');
    });

    it('descarta los vacíos y los de páginas eliminadas', () => {
      const cambios = new Cambios();
      cambios.escribir(texto(1, '   '));
      cambios.escribir(texto(2, 'se va con la página'));
      cambios.escribir(texto(3, 'este sí'));
      cambios.eliminar(2);

      const peticion = cambios.aPeticion(3) as { textos: { texto: string }[] };
      expect(peticion.textos.map(t => t.texto)).toEqual(['este sí']);
    });
  });

  describe('borrador', () => {
    it('conserva los textos entre visitas', () => {
      const cambios = new Cambios();
      cambios.escribir(texto());
      const vuelto = Cambios.desdeBorrador(JSON.parse(JSON.stringify(cambios.aBorrador())));
      expect(vuelto.textos.length).toBe(1);
      expect(vuelto.textos[0].texto).toBe('Juan Pérez');
    });

    it('abre un borrador de antes de que existieran los textos', () => {
      const viejo = { marcas: [], rotaciones: [], eliminadas: [] };
      const vuelto = Cambios.desdeBorrador(viejo);
      expect(vuelto.textos).toEqual([]);
      expect(vuelto.hayAlgo).toBe(false);
    });

    it('los identificadores nuevos no pisan a los recuperados', () => {
      const cambios = new Cambios();
      cambios.marcar(marca(1));
      const escrito = cambios.escribir(texto());

      const vuelto = Cambios.desdeBorrador(JSON.parse(JSON.stringify(cambios.aBorrador())));
      const nuevo = vuelto.escribir(texto());
      expect(nuevo.id).not.toBe(escrito.id);
      expect(vuelto.textos.map(t => t.id)).toEqual([escrito.id, nuevo.id]);
    });
  });

  describe('campos que ya trae el formulario', () => {
    it('escribir en uno cuenta como cambio', () => {
      const cambios = new Cambios();
      expect(cambios.rellenar('nombre', 'Ana', '')).toBe(true);
      expect(cambios.hayAlgo).toBe(true);
      expect(cambios.valorDeCampo('nombre', '')).toBe('Ana');
    });

    it('devolverlo a lo que traía el archivo deja de ser un cambio', () => {
      const cambios = new Cambios();
      cambios.rellenar('nombre', 'Ana', 'Original');
      expect(cambios.rellenar('nombre', 'Original', 'Original')).toBe(true);
      expect(cambios.hayAlgo).toBe(false);
      expect(cambios.valorDeCampo('nombre', 'Original')).toBe('Original');
    });

    it('escribir lo mismo dos veces no gasta un paso de deshacer', () => {
      const cambios = new Cambios();
      cambios.rellenar('nombre', 'Ana', '');
      cambios.deshacer();
      expect(cambios.rellenar('nombre', '', '')).toBe(false);
      expect(cambios.sePuedeDeshacer).toBe(false);
    });

    it('se deshace hasta el valor anterior, no hasta vacío', () => {
      const cambios = new Cambios();
      cambios.rellenar('nombre', 'Ana', '');
      cambios.rellenar('nombre', 'Ana María', '');
      cambios.deshacer();
      expect(cambios.valorDeCampo('nombre', '')).toBe('Ana');
      cambios.deshacer();
      expect(cambios.valorDeCampo('nombre', '')).toBe('');
    });

    it('viajan al servidor con su nombre', () => {
      const cambios = new Cambios();
      cambios.rellenar('nombre', 'Ana', '');
      cambios.rellenar('acepto', 'Yes', 'Off');
      const peticion = cambios.aPeticion(1) as { campos: { nombre: string; valor: string }[] };
      expect(peticion.campos).toEqual([
        { nombre: 'nombre', valor: 'Ana' },
        { nombre: 'acepto', valor: 'Yes' },
      ]);
    });

    it('el borrador los conserva, y aguanta uno de antes de que existieran', () => {
      const cambios = new Cambios();
      cambios.rellenar('nombre', 'Ana', '');
      const vuelto = Cambios.desdeBorrador(JSON.parse(JSON.stringify(cambios.aBorrador())));
      expect(vuelto.valorDeCampo('nombre', '')).toBe('Ana');

      const viejo = Cambios.desdeBorrador({ marcas: [], rotaciones: [], eliminadas: [] });
      expect(viejo.campos.size).toBe(0);
    });
  });
});
