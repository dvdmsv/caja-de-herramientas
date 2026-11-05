import { SIN_SERVIDOR } from '../../core/plataforma';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EscritorioService } from '../../core/escritorio.service';

/** Una pieza de fuera que hace parte del trabajo, con su licencia. */
interface Pieza {
  nombre: string;
  para: string;
  licencia: string;
}

/**
 * Quién hace esto, dónde está el código y con qué está hecho.
 *
 * Enlazar el código fuente no es sólo cortesía: la licencia es AGPL, que pide
 * ofrecerlo a quien usa la aplicación a través de una red.
 */
@Component({
  selector: 'app-acerca-de',
  templateUrl: './acerca-de.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './acerca-de.component.css',
})
export class AcercaDeComponent {
  readonly local = SIN_SERVIDOR;
  licencias = '';
  async verLicencias(): Promise<void> {
    if (!this.local || this.licencias) return;
    try {
      const respuesta = await fetch('/assets/legal/AVISOS.txt');
      if (!respuesta.ok) throw new Error('No disponible');
      this.licencias = await respuesta.text();
    } catch { this.licencias = 'No se han podido abrir los avisos incluidos en la aplicación.'; }
  }
  /** Sólo en la aplicación de Windows, que sabe qué versión es; la web no la tiene. */
  version: string | null = null;

  readonly autor = 'dvdmsv';
  readonly perfil = 'https://github.com/dvdmsv';
  readonly codigo = 'https://github.com/dvdmsv/caja-de-herramientas';
  readonly descargaWindows =
    'https://github.com/dvdmsv/caja-de-herramientas/releases/latest/download/CajaDeHerramientas-setup.exe';

  /** Las mismas de «Lo que viene de fuera» del README, más los programas externos. */
  readonly piezas: Pieza[] = SIN_SERVIDOR ? [
    { nombre: 'MuPDF.js', para: 'procesar los PDF dentro del teléfono', licencia: 'AGPL-3.0-or-later' },
    { nombre: 'pdf.js', para: 'leer y previsualizar documentos', licencia: 'Apache-2.0' },
    { nombre: 'Capacitor', para: 'integración con Android', licencia: 'MIT' },
    { nombre: 'Angular y Bootstrap', para: 'la interfaz', licencia: 'MIT' },
    { nombre: 'fflate y qrcode', para: 'archivos ZIP y códigos QR', licencia: 'MIT' },
  ] : [
    { nombre: 'PyMuPDF', para: 'casi todo lo que se hace con un PDF', licencia: 'AGPL-3.0' },
    { nombre: 'LibreOffice', para: 'documentos, hojas y presentaciones a PDF', licencia: 'MPL-2.0' },
    { nombre: 'Tesseract', para: 'reconocer el texto de un escaneado', licencia: 'Apache-2.0' },
    { nombre: 'ocrmypdf y Ghostscript', para: 'OCR, PDF/A y grises', licencia: 'MPL-2.0 · AGPL-3.0' },
    { nombre: 'pyHanko', para: 'firmar y comprobar firmas', licencia: 'MIT' },
    { nombre: 'WeasyPrint', para: 'Markdown a PDF y HTML a PDF', licencia: 'BSD-3-Clause' },
    { nombre: 'Pillow', para: 'las imágenes', licencia: 'MIT-CMU' },
    { nombre: 'pdf.js', para: 'el visor', licencia: 'Apache-2.0' },
    { nombre: 'Angular, Bootstrap y Flask', para: 'la aplicación en sí', licencia: 'MIT · BSD-3-Clause' },
  ];

  constructor() {
    inject(EscritorioService).version().then(version => (this.version = version));
  }
}
