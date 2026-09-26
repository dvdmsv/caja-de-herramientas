import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EscritorioService } from '../../core/escritorio.service';
import { DE_SERIE, candidatas, extensionesDe } from '../../core/menu-contextual';
import { Grupo, Herramienta, agruparPorCategoria, claveDeCategoria } from '../../core/tools';

/**
 * Ajustes de la aplicación de Windows. Sólo existe en la rama `escritorio`, y
 * sólo se enlaza cuando la página va dentro de la aplicación.
 *
 * Lo único que hay hoy es el menú del Explorador: si sale «Caja de
 * herramientas» al hacer clic derecho en un archivo, y con qué acciones. Cada
 * cambio se aplica al momento: lo que manda es el registro de Windows, y lo
 * escribe main.rs (`aplicar_menu_contextual`).
 */
@Component({
  selector: 'app-ajustes',
  templateUrl: './ajustes.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './ajustes.component.css',
})
export class AjustesComponent {
  private readonly escritorio = inject(EscritorioService);

  readonly enAplicacion = this.escritorio.activo;

  /** Por categoría, como en el menú de la aplicación, sólo las que reciben archivos. */
  readonly grupos: Grupo[] = (() => {
    const ofrecibles = new Set(candidatas().map(h => h.slug));
    return agruparPorCategoria()
      .map(grupo => ({ ...grupo, herramientas: grupo.herramientas.filter(h => ofrecibles.has(h.slug)) }))
      .filter(grupo => grupo.herramientas.length > 0);
  })();

  cargando = true;
  aplicando = false;
  activo = false;
  marcadas = new Set<string>();
  /** Lo que se dice tras el último cambio: «Guardado» o el error. */
  estado = '';
  fallo = false;

  constructor() {
    if (!this.enAplicacion) {
      this.cargando = false;
      return;
    }
    this.escritorio.menuContextual().then(ajustes => {
      this.activo = ajustes?.activo ?? false;
      // Sin nada elegido todavía, las de uso común: que al activarlo no salga
      // un submenú vacío, ni uno de treinta entradas sin haberlas pedido.
      this.marcadas = new Set(ajustes?.acciones.length ? ajustes.acciones : DE_SERIE);
      this.cargando = false;
    });
  }

  clave(grupo: Grupo): string {
    return claveDeCategoria(grupo.categoria);
  }

  /** Sobre qué archivos sale, dicho corto: «PDF», «JPG, PNG, HEIC…». */
  formatos(herramienta: Herramienta): string {
    const extensiones = extensionesDe(herramienta).map(e => e.toUpperCase());
    return extensiones.length > 4 ? `${extensiones.slice(0, 4).join(', ')}…` : extensiones.join(', ');
  }

  alternarMenu(activo: boolean): void {
    this.activo = activo;
    this.aplicar();
  }

  alternarAccion(slug: string, marcada: boolean): void {
    if (marcada) {
      this.marcadas.add(slug);
    } else {
      this.marcadas.delete(slug);
    }
    this.aplicar();
  }

  private async aplicar(): Promise<void> {
    this.aplicando = true;
    this.estado = '';
    try {
      const ajustes = await this.escritorio.aplicarMenuContextual(this.activo, [...this.marcadas]);
      this.activo = ajustes.activo;
      this.estado = this.activo ? 'Guardado: ya sale en el menú del Explorador.' : 'Guardado.';
      this.fallo = false;
    } catch (error) {
      this.estado = `No se ha podido guardar: ${String((error as Error)?.message ?? error)}`;
      this.fallo = true;
    } finally {
      this.aplicando = false;
    }
  }
}
