import { it, expect } from 'vitest';
import { trabajadoresOcr } from '../../src/app/core/local/ocr-pdf';

it('reparte entre la mitad de los núcleos, con tope de cuatro', () => {
  expect(trabajadoresOcr(8, 8)).toBe(4);   // OnePlus 6: ocho núcleos, 8 GB
  expect(trabajadoresOcr(16, 16)).toBe(4);
  expect(trabajadoresOcr(4, 8)).toBe(2);
});

it('con poca memoria, menos Tesseract: cada uno pide la suya', () => {
  expect(trabajadoresOcr(8, 3)).toBe(2);
  expect(trabajadoresOcr(8, 1)).toBe(1);
});

it('sin datos del sistema, al menos uno', () => {
  expect(trabajadoresOcr(undefined, undefined)).toBe(1);
  expect(trabajadoresOcr(1, undefined)).toBe(1);
  expect(trabajadoresOcr(0, 0.5)).toBe(1);
});
