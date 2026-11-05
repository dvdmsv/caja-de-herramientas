import { CUOTA_LOCAL, MAXIMO_ARCHIVO } from './catalogo';

export interface ArchivoLocal {
  id: string;
  name: string;
  size: number;
  generated: boolean;
  blob: Blob;
}

export function nombreSeguro(nombre: string): string {
  return nombre.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').trim().slice(0, 160) || 'archivo';
}

export function metadatos({ id, name, size, generated }: ArchivoLocal) {
  return { id, name, size, generated };
}

/** Almacén privado del WebView. Una transacción publica todos los resultados o ninguno. */
export class AlmacenLocal {
  private apertura?: Promise<IDBDatabase>;

  private abrir(): Promise<IDBDatabase> {
    return this.apertura ??= new Promise((resolve, reject) => {
      const peticion = indexedDB.open('caja-android', 1);
      peticion.onupgradeneeded = () => peticion.result.createObjectStore('archivos', { keyPath: 'id' });
      peticion.onsuccess = () => resolve(peticion.result);
      peticion.onerror = () => reject(new Error('No se puede abrir el almacenamiento del teléfono.'));
    });
  }

  async todos(): Promise<ArchivoLocal[]> {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const r = db.transaction('archivos').objectStore('archivos').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async leer(id: string): Promise<ArchivoLocal> {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const r = db.transaction('archivos').objectStore('archivos').get(id);
      r.onsuccess = () => r.result ? resolve(r.result)
        : reject(new Error('El archivo ya no está disponible. Vuelve a elegirlo.'));
      r.onerror = () => reject(r.error);
    });
  }

  async guardar(entradas: { name: string; blob: Blob }[], generated: boolean): Promise<ArchivoLocal[]> {
    const nuevos = entradas.map(({ name, blob }) => ({
      id: crypto.randomUUID().replaceAll('-', ''), name: nombreSeguro(name),
      size: blob.size, generated, blob,
    }));
    if (nuevos.some(a => !a.size)) throw new Error('El archivo está vacío.');
    if (!generated && nuevos.some(a => a.size > MAXIMO_ARCHIVO)) {
      throw new Error('En Android puedes abrir archivos de hasta 50 MB.');
    }
    const db = await this.abrir();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('archivos', 'readwrite');
      const store = tx.objectStore('archivos');
      const r = store.getAll();
      let error: Error | null = null;
      r.onsuccess = () => {
        const peso = [...r.result, ...nuevos].reduce((n, a) => n + a.size, 0);
        if (peso > CUOTA_LOCAL) {
          error = new Error('El espacio de trabajo supera 250 MB. Guarda tus resultados y pulsa «Empezar de cero».');
          tx.abort();
        } else nuevos.forEach(a => store.put(a));
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(error ?? new Error('No queda espacio para guardar los archivos en el teléfono.'));
    });
    return nuevos;
  }

  async eliminar(id?: string): Promise<void> {
    const db = await this.abrir();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('archivos', 'readwrite');
      const store = tx.objectStore('archivos');
      if (id) store.delete(id); else store.clear();
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }

  async renombrar(id: string, nombre: string): Promise<ArchivoLocal> {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('archivos', 'readwrite');
      const store = tx.objectStore('archivos');
      const r = store.get(id);
      let archivo: ArchivoLocal;
      r.onsuccess = () => {
        archivo = r.result;
        if (!archivo) { tx.abort(); return; }
        const ext = /\.[^.]+$/.exec(archivo.name)?.[0] ?? '';
        const limpio = nombreSeguro(nombre);
        archivo.name = limpio.toLowerCase().endsWith(ext.toLowerCase()) ? limpio : limpio + ext;
        store.put(archivo);
      };
      tx.oncomplete = () => resolve(archivo);
      tx.onabort = tx.onerror = () => reject(new Error('No se ha podido renombrar el archivo.'));
    });
  }
}
