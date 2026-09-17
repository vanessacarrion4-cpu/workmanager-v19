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
  it('HIJA-plantilla terminada (con parentTaskId) → true (F5-6 split de hijas: se oculta del contenedor)', () => {
    expect(isExpiredTemplate({ isTemplate: true, parentTaskId: 't-cont', recurrence: { frequency: 'daily', endDate: '2026-07-31' } }, TODAY)).toBe(true);
  });
  it('null / sin recurrence → false', () => {
    expect(isExpiredTemplate(null, TODAY)).toBe(false);
    expect(isExpiredTemplate({ isTemplate: true }, TODAY)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.131 · el acumulado de tiempo no cuenta dos veces el de las hojas
// ─────────────────────────────────────────────────────────────────────────────
import { getTaskRegisteredCombo, getTaskRegisteredSelf } from './utils';

describe('§16.131 getTaskRegisteredCombo: cada minuto tiene un solo dueño', () => {
  // Forma REAL de las entradas: la de una hoja lleva el id del contenedor en taskId y el de la hoja en subtaskId.
  const tasks: any = {
    cont: { id: 'cont', title: 'Subvenció desglosar', subtasks: ['hoja'], estimatedMinutes: 30 },
    hoja: { id: 'hoja', title: 'Demanar subvenció', parentTaskId: 'cont', subtasks: [] },
  };
  const te = [
    { id: 'te1', taskId: 'cont', subtaskId: 'hoja', date: '2026-09-15', duration: 120 }, // 2h en la HOJA
    { id: 'te2', taskId: 'cont', subtaskId: null, date: '2026-09-14', duration: 180 },   // 3h en el CONTENEDOR
  ];

  it('el contenedor suma sus 3h propias + las 2h de la hoja = 5h (antes: 7h 30m)', () => {
    expect(getTaskRegisteredCombo('cont', tasks, te, new Set())).toBe(300);
  });

  it('la hoja sigue teniendo sus 2h', () => {
    expect(getTaskRegisteredCombo('hoja', tasks, te, new Set())).toBe(120);
  });

  it('filtrando por día, el contenedor no se queda el tiempo de la hoja', () => {
    expect(getTaskRegisteredCombo('cont', tasks, te, new Set(), '2026-09-15')).toBe(120); // solo la hoja ese día
    expect(getTaskRegisteredCombo('cont', tasks, te, new Set(), '2026-09-14')).toBe(180); // solo lo propio
  });

  it('getTaskRegisteredSelf NO se toca: sus otros llamadores (las guardas de "intacta") siguen igual', () => {
    // sigue siendo generoso a propósito: la entrada de la hoja también cuenta como del contenedor.
    expect(getTaskRegisteredSelf('cont', te)).toBe(300);
    expect(getTaskRegisteredSelf('hoja', te)).toBe(120);
  });
});
