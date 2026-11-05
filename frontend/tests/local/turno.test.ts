import { it, expect } from 'vitest';
import { Turno } from '../../src/app/core/local/turno';

const cancelada = () => new Error('cancelada');
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms));

it('ejecuta de uno en uno y por orden de llegada', async () => {
  const turno = new Turno();
  const traza: string[] = [];
  const trabajo = (nombre: string, ms: number) => turno.ejecutar(new AbortController().signal, async () => {
    traza.push(nombre + '+'); await pausa(ms); traza.push(nombre + '-'); return nombre;
  }, cancelada);
  // La vista previa tarda más que el trabajo que llega detrás: aun así no se solapan.
  const resultados = await Promise.all([trabajo('vista', 30), trabajo('principal', 5), trabajo('otra', 1)]);
  expect(resultados).toEqual(['vista', 'principal', 'otra']);
  expect(traza).toEqual(['vista+', 'vista-', 'principal+', 'principal-', 'otra+', 'otra-']);
});

it('lo cancelado mientras espera no se ejecuta ni retrasa a los siguientes', async () => {
  const turno = new Turno();
  const traza: string[] = [];
  let soltarPrimero!: () => void;
  const primero = turno.ejecutar(new AbortController().signal,
    () => new Promise<void>(r => (soltarPrimero = r)).then(() => { traza.push('primero'); }), cancelada);
  const control = new AbortController();
  const segundo = turno.ejecutar(control.signal, async () => { traza.push('segundo'); }, cancelada);
  const tercero = turno.ejecutar(new AbortController().signal, async () => { traza.push('tercero'); }, cancelada);
  control.abort();
  await expect(segundo).rejects.toThrow('cancelada');
  // El tercero sigue esperando al primero, que no ha terminado.
  await pausa(5);
  expect(traza).toEqual([]);
  soltarPrimero();
  await Promise.all([primero, tercero]);
  expect(traza).toEqual(['primero', 'tercero']);
});

it('un fallo suelta el turno', async () => {
  const turno = new Turno();
  const sigue = new AbortController().signal;
  const falla = turno.ejecutar(sigue, async () => { throw new Error('motor'); }, cancelada);
  const despues = turno.ejecutar(sigue, async () => 'hecho', cancelada);
  await expect(falla).rejects.toThrow('motor');
  await expect(despues).resolves.toBe('hecho');
});

it('lo cancelado antes de pedir turno ni siquiera entra', async () => {
  const control = new AbortController();
  control.abort();
  let ejecutada = false;
  await expect(new Turno().ejecutar(control.signal, async () => { ejecutada = true; }, cancelada)).rejects.toThrow('cancelada');
  expect(ejecutada).toBe(false);
});
