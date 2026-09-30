
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { Resultado, VistaPrevia } from '../../../core/api.service';
import { avisoError, avisoExito } from '../../../shared/notify';
import { copiarAlPortapapeles } from '../../../shared/portapapeles';
import { adelgazamiento, markdownUnido } from './vistas';

/** Regla de andar por casa para estimar tokens a partir de caracteres. */
const CARACTERES_POR_TOKEN = 4;

@Component({
  selector: 'app-a-markdown',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  templateUrl: './a-markdown.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './a-markdown.component.css',
})
export class AMarkdownComponent extends PaginaHerramienta {
  protected readonly slug = 'a-markdown';
  protected override get mensajeExito(): string {
    return 'Documentos convertidos';
  }

  unir = false;
  /** Cuál de las vistas previas se enseña, con varios documentos sin «Unir». */
  seleccionada = 0;

  protected override opciones(): Record<string, unknown> {
    return { unir: this.unir };
  }

  protected override alTerminar(_resultado: Resultado): void {
    this.seleccionada = 0;
  }

  get vista(): VistaPrevia | null {
    return this.vistasPrevias[this.seleccionada] ?? this.vistasPrevias[0] ?? null;
  }

  /** «Copiar todos», o `null` si a alguno le falta el texto. */
  get todos(): string | null {
    return markdownUnido(this.vistasPrevias);
  }

  /** «de 2,3 MB a 14 KB (0,6 %)». */
  get adelgaza(): string | null {
    return this.vista ? adelgazamiento(this.vista.original, this.vista.markdown) : null;
  }

  /** Para saber de un vistazo si el texto le cabe al modelo. */
  get tokensAproximados(): number {
    return Math.ceil((this.vista?.caracteres ?? 0) / CARACTERES_POR_TOKEN);
  }

  async copiar(texto: string | null | undefined, exito: string): Promise<void> {
    if (!texto) {
      return;
    }
    try {
      await copiarAlPortapapeles(texto);
      avisoExito(exito);
    } catch {
      avisoError('El navegador no ha dejado copiar. Descarga el archivo o selecciona el texto a mano.');
    }
  }
}
