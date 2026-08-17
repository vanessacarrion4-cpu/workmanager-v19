// F5-6 (ii): helpers puros del "partir la serie" y del ocultado de series terminadas.
import { describe, it, expect } from 'vitest';
import { recurrenceChanged, isExpiredTemplate } from './utils';

describe('recurrenceChanged (F5-6: solo dispara el split si cambia la PAUTA)', () => {
  it('misma pauta (daily = daily) → false', () => {
    expect(recurrenceChanged({ frequency: 'daily', startDate: '2026-05-01' }, { frequency: 'daily', startDate: '2026-08-01' })).toBe(false);
  });
  it('solo cambian startDate/endDate → false (no es cambio de pauta)', () => {
    expect(recurrenceChanged({ frequency: 'weekly', weekDays: [0, 2], startDate: '2026-01-01' }, { frequency: 'weekly', weekDays: [0, 2], startDate: '2026-08-01', endDate: '2026-12-31' })).toBe(false);
  });
  it('cambia la frecuencia (daily → weekly) → true', () => {
    expect(recurrenceChanged({ frequency: 'daily' }, { frequency: 'weekly', weekDays: [0] })).toBe(true);
  });
  it('cambian los weekDays → true', () => {
    expect(recurrenceChanged({ frequency: 'weekly', weekDays: [0, 1] }, { frequency: 'weekly', weekDays: [0, 2] })).toBe(true);
  });
  it('weekDays en distinto orden pero mismo conjunto → false', () => {
    expect(recurrenceChanged({ frequency: 'weekly', weekDays: [2, 0] }, { frequency: 'weekly', weekDays: [0, 2] })).toBe(false);
  });
  it('cambia monthDay → true', () => {
    expect(recurrenceChanged({ frequency: 'monthly', monthDay: 5 }, { frequency: 'monthly', monthDay: 12 })).toBe(true);
  });
  it('una presente y la otra ausente → true', () => {
    expect(recurrenceChanged(null, { frequency: 'daily' })).toBe(true);
    expect(recurrenceChanged({ frequency: 'daily' }, null)).toBe(true);
  });
});

describe('isExpiredTemplate (F5-6: ocultar series terminadas de Bloques/Búsqueda)', () => {
  const TODAY = '2026-08-17';
  it('plantilla con endDate PASADO → true (se oculta)', () => {
    expect(isExpiredTemplate({ isTemplate: true, recurrence: { frequency: 'daily', endDate: '2026-07-31' } }, TODAY)).toBe(true);
  });
  it('plantilla con endDate HOY o futuro → false (sigue viva)', () => {
    expect(isExpiredTemplate({ isTemplate: true, recurrence: { frequency: 'daily', endDate: '2026-08-17' } }, TODAY)).toBe(false);
    expect(isExpiredTemplate({ isTemplate: true, recurrence: { frequency: 'daily', endDate: '2026-12-31' } }, TODAY)).toBe(false);
  });
  it('plantilla sin endDate → false', () => {
    expect(isExpiredTemplate({ isTemplate: true, recurrence: { frequency: 'daily' } }, TODAY)).toBe(false);
  });
  it('NO plantilla (aunque tenga endDate pasado) → false', () => {
    expect(isExpiredTemplate({ isTemplate: false, recurrence: { frequency: 'daily', endDate: '2026-07-31' } }, TODAY)).toBe(false);
  });
  it('null / sin recurrence → false', () => {
    expect(isExpiredTemplate(null, TODAY)).toBe(false);
    expect(isExpiredTemplate({ isTemplate: true }, TODAY)).toBe(false);
  });
});
