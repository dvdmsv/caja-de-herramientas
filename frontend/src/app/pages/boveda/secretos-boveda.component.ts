import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BovedaService } from '../../core/boveda.service';
import { SecretoGuardado, enlaceDe, filtrarSecretos } from '../../core/boveda/contenido';
import { avisoError, avisoExito, confirmar } from '../../shared/notify';
import { copiarAlPortapapeles } from '../../shared/portapapeles';
import { SecretoFormularioComponent } from './secreto-formulario.component';

/** Lo revelado se vuelve a ocultar pasado este rato. */
const OCULTAR_TRAS_MS = 30_000;

/**
 * «Secretos» de la bóveda: la lista, el buscador, ver, copiar y el menú con lo demás.
 *
 * **El secreto sólo entra en el DOM mientras se ve**, y va siempre con la misma
 * máscara para no decir cuánto mide. Las notas se ocultan con él, porque pueden
 * llevar códigos de recuperación.
 */
@Component({
  selector: 'app-secretos-boveda',
  imports: [FormsModule, SecretoFormularioComponent],
  templateUrl: './secretos-boveda.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './secretos-boveda.component.css',
})
export class SecretosBovedaComponent implements OnDestroy {
  protected readonly boveda = inject(BovedaService);

  readonly mascara = '••••••••';

  busqueda = '';
  /** Con qué ficha está abierto el menú `...`. */
  menuDe: string | null = null;
  /** La ficha que se edita, `'nueva'` si se añade una, o `null` con la ventana cerrada. */
  editando: SecretoGuardado | 'nueva' | null = null;

  /** Lo revelado, con el temporizador que lo volverá a ocultar. */
  private readonly revelados = new Map<string, ReturnType<typeof setTimeout>>();

  /** Sólo se recalcula si cambia algo: la plantilla lo pide en cada movimiento del ratón. */
  private calculados?: { lista: SecretoGuardado[]; busqueda: string; visibles: SecretoGuardado[] };

  get visibles(): SecretoGuardado[] {
    const lista = this.boveda.contenido.secretos;
    if (this.calculados?.lista !== lista || this.calculados.busqueda !== this.busqueda) {
      this.calculados = { lista, busqueda: this.busqueda, visibles: filtrarSecretos(lista, this.busqueda) };
    }
    return this.calculados.visibles;
  }

  enlaceDe(web: string | undefined): string | null {
    return enlaceDe(web);
  }

  ngOnDestroy(): void {
    this.revelados.forEach(temporizador => clearTimeout(temporizador));
  }

  // --- ver y copiar -----------------------------------------------------------

  estaRevelado(id: string): boolean {
    return this.revelados.has(id);
  }

  alternarRevelado(id: string): void {
    const temporizador = this.revelados.get(id);
    if (temporizador !== undefined) {
      clearTimeout(temporizador);
      this.revelados.delete(id);
      return;
    }
    this.revelados.set(id, setTimeout(() => this.revelados.delete(id), OCULTAR_TRAS_MS));
    this.boveda.seguirUsando();
  }

  async copiar(secreto: SecretoGuardado): Promise<void> {
    try {
      await this.boveda.copiar(secreto);
      avisoExito('Copiada; se borrará en 30 s');
    } catch (error) {
      avisoError(String((error as Error)?.message ?? error));
    }
  }

  /** Por el portapapeles normal: un usuario no es un secreto. */
  async copiarUsuario(secreto: SecretoGuardado): Promise<void> {
    this.menuDe = null;
    try {
      await copiarAlPortapapeles(secreto.usuario ?? '');
      this.boveda.seguirUsando();
      avisoExito('Usuario copiado');
    } catch {
      avisoError('No se ha podido copiar el usuario.');
    }
  }

  // --- el menú `...` ----------------------------------------------------------

  alternarMenu(evento: Event, id: string): void {
    // Si no, el `document:click` de aquí abajo lo cerraría al momento.
    evento.stopPropagation();
    this.menuDe = this.menuDe === id ? null : id;
  }

  @HostListener('document:click')
  alPulsarFuera(): void {
    this.menuDe = null;
  }

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    this.menuDe = null;
  }

  // --- añadir, editar y quitar --------------------------------------------------

  editar(secreto: SecretoGuardado): void {
    this.menuDe = null;
    this.editando = secreto;
  }

  async quitar(secreto: SecretoGuardado): Promise<void> {
    this.menuDe = null;
    if (!await confirmar(`¿Quitar «${secreto.nombre}»?`, 'Se quita de la bóveda. No hay forma de deshacerlo.', 'Quitar')) {
      return;
    }
    try {
      await this.boveda.quitar(secreto.id);
    } catch (error) {
      avisoError((error as Error).message);
    }
  }
}
