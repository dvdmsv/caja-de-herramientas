import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PdfService, DocumentoPdf } from '../../core/pdf.service';
import { TraspasoService } from '../../core/traspaso.service';
import { ApiService } from '../../core/api.service';
import { avisoError } from '../../shared/notify';
import { MAXIMO_ARCHIVO, MAXIMO_PIXELES } from '../../core/local/catalogo';

@Component({
  selector: 'app-visor-android',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <header class="barra">
      <a routerLink="/" class="btn btn-outline-secondary">Inicio</a>
      <label class="btn btn-primary">Abrir PDF<input type="file" accept=".pdf" hidden (change)="elegir($event)"></label>
      <button class="btn btn-outline-primary" [disabled]="!archivo || ocupado" (click)="guardar()">Guardar copia</button>
    </header>
    <h1 class="h6 px-3 text-break">{{ archivo?.name || 'Visor de PDF' }}</h1>
    <nav class="barra" aria-label="Páginas">
      <button class="btn btn-outline-secondary" [disabled]="ocupado || numero <= 1" (click)="mover(-1)">Anterior</button>
      <span aria-live="polite">{{ numero }} / {{ documento?.paginas || 0 }}</span>
      <button class="btn btn-outline-secondary" [disabled]="ocupado || numero >= (documento?.paginas || 0)" (click)="mover(1)">Siguiente</button>
      <button class="btn btn-outline-secondary" [disabled]="ocupado || !documento || zoom <= 1" (click)="ampliar(-1)" aria-label="Reducir">−</button>
      <button class="btn btn-outline-secondary" [disabled]="ocupado || !documento || zoom >= 3" (click)="ampliar(1)" aria-label="Ampliar">+</button>
    </nav>
    @if (ocupado) { <p role="status" class="px-3">Preparando página…</p> }
    <main class="pagina"><canvas #lienzo [style.width.px]="anchoVisible" [attr.aria-label]="'Página ' + numero"></canvas></main>
  `,
  styles: [`:host { display:block; height:100dvh; overflow:auto; }
    .barra { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; padding:.75rem; }
    .btn { min-height:44px; } .pagina { overflow:auto; padding:.5rem; text-align:center; }
    canvas { max-width:none; height:auto; background:white; }`],
})
export class VisorAndroidComponent implements OnDestroy {
  @ViewChild('lienzo', { static: true }) lienzo!: ElementRef<HTMLCanvasElement>;
  private readonly pdf = inject(PdfService);
  private readonly api = inject(ApiService);
  private readonly traspaso = inject(TraspasoService);
  archivo: File | null = null;
  documento: DocumentoPdf | null = null;
  numero = 0;
  zoom = 1;
  ocupado = false;
  anchoVisible = 0;
  private generacion = 0;
  private inicio: ReturnType<typeof setTimeout>;

  constructor() {
    // El marco cambia de router-outlet al entrar en pantalla completa. Recoger
    // después evita consumir el traspaso en la instancia que se destruye.
    this.inicio = setTimeout(() => {
      const pendiente = this.traspaso.tomar()[0];
      if (pendiente) void this.abrir(pendiente);
    });
  }
  elegir(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    if (input.files?.[0]) void this.abrir(input.files[0]);
    input.value = '';
  }
  async abrir(archivo: File): Promise<void> {
    if (archivo.size > MAXIMO_ARCHIVO) { avisoError('En Android puedes abrir archivos de hasta 50 MB.'); return; }
    const mia = ++this.generacion;
    this.documento?.cerrar(); this.documento = null; this.ocupado = true;
    try {
      const documento = await this.pdf.abrir(archivo);
      if (mia !== this.generacion) { documento.cerrar(); return; }
      this.documento = documento; this.archivo = archivo; this.numero = 1; this.zoom = 1;
      await this.pintar();
    } catch (err) { if (mia === this.generacion) avisoError(String(err instanceof Error ? err.message : err)); }
    finally { if (mia === this.generacion) this.ocupado = false; }
  }
  async pintar(): Promise<void> {
    if (!this.documento) return;
    const mia = this.generacion;
    this.ocupado = true;
    try {
      const pagina = await this.documento.pagina(this.numero);
      if (mia !== this.generacion) return;
      const natural = pagina.getViewport({ scale: 1 });
      this.anchoVisible = Math.min(window.innerWidth - 20, 1000) * this.zoom;
      const viewport = pagina.getViewport({ scale: this.anchoVisible * Math.min(devicePixelRatio, 2) / natural.width });
      if (viewport.width * viewport.height > MAXIMO_PIXELES) throw new Error('La página es demasiado grande para esta ampliación.');
      const canvas = this.lienzo.nativeElement;
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await pagina.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      pagina.cleanup();
    } catch (err) { if (mia === this.generacion) avisoError(String(err instanceof Error ? err.message : err)); }
    finally { if (mia === this.generacion) this.ocupado = false; }
  }
  mover(delta: number): void { this.numero += delta; void this.pintar(); }
  ampliar(delta: number): void { this.zoom += delta; void this.pintar(); }
  async guardar(): Promise<void> {
    if (!this.archivo) return;
    try { await this.api.guardarArchivo(this.archivo, this.archivo.name); }
    catch (err) { avisoError(String(err instanceof Error ? err.message : err)); }
  }
  ngOnDestroy(): void { clearTimeout(this.inicio); this.generacion++; this.documento?.cerrar(); }
}
