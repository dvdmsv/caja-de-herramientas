import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject } from '@angular/core';

import { EscritorioService } from '../../../core/escritorio.service';
import { DE_SERIE, candidatas, extensionesDe } from '../../../core/menu-contextual';
import { Grupo, Herramienta, agruparPorCategoria, claveDeCategoria } from '../../../core/tools';
import { FilaAjusteComponent } from '../fila-ajuste.component';

/**
 * El menú del Explorador: si sale «Caja de herramientas» al hacer clic derecho
 * en un archivo, y con qué acciones. Cada cambio se aplica al momento: lo que
 * manda es el registro de Windows, y lo escribe main.rs (`aplicar_menu_contextual`),
 * no `guardar_ajustes` como el resto de secciones.
 */
@Component({
  selector: 'app-ajustes-explorador',
  imports: [FilaAjusteComponent],
  templateUrl: './explorador.component.html',
  styleUrl: './explorador.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesExploradorComponent {
  private readonly escritorio = inject(EscritorioService);

  /** Lo que dice la página tras cada cambio: «Guardado» o el error. */
  @Output() readonly resultado = new EventEmitter<{ texto: string; fallo: boolean }>();

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

  constructor() {
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
    try {
      const ajustes = await this.escritorio.aplicarMenuContextual(this.activo, [...this.marcadas]);
      this.activo = ajustes.activo;
      this.resultado.emit({ texto: this.activo ? 'Guardado: ya sale en el menú del Explorador.' : 'Guardado.', fallo: false });
    } catch (error) {
      this.resultado.emit({ texto: `No se ha podido guardar: ${String((error as Error)?.message ?? error)}`, fallo: true });
    } finally {
      this.aplicando = false;
    }
  }
}
