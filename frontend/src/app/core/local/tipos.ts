export interface EntradaMotor { name: string; blob: Blob }
export interface OpcionesMotor {
  [clave: string]: unknown;
  file_ids?: string[];
}
export interface PeticionMotor {
  slug: string;
  archivos: EntradaMotor[];
  opciones: OpcionesMotor;
  recursos?: Record<string, EntradaMotor>;
}
export interface ResultadoMotor {
  datos?: Record<string, unknown>;
  archivos: EntradaMotor[];
  resumen?: { antes: number; despues: number };
  objetivo?: { bytes: number; logrado: boolean };
}
