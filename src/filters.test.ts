// ─────────────────────────────────────────────────────────────────────────────
// filters.ts — filterTasksForDay (camino REAL de ensamblado del día; antes SIN test).
// Cubre el hueco de riesgo medio nombrado por la usuaria (bloque 6, sesión 19).
// Fija el comportamiento día-scoped que demuestra que Mi Día NUNCA pinta hijas de
// otro día (la parte "buena" del bug del render, §16.17); Bloques es otra capa.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { filterTasksForDay, getStatsForDay } from './filters';
import { reconcileDay } from './fase3Contracts';

// 2026-07-15 Mié · 07-16 Jue
const WED = '2026-07-15';
const THU = '2026-07-16';
const BLOCKS = new Set(['b1']);

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const mapOf = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));
const run = (ts: Task[], day: string, opts = {}) =>
  filterTasksForDay(ts, mapOf(ts), BLOCKS, day, opts).map(t => t.id).sort();

describe('filterTasksForDay — tarea simple con fecha', () => {
  it('aparece en su día; no en otro', () => {
    const ts = [task({ id: 'A', dueDate: WED })];
    expect(run(ts, WED)).toEqual(['A']);
    expect(run(ts, THU)).toEqual([]);
  });

  it('completada del día: oculta con hideCompleted, visible sin él', () => {
    const ts = [task({ id: 'A', dueDate: WED, status: 'completed' })];
    expect(run(ts, WED, { hideCompleted: true })).toEqual([]);
    expect(run(ts, WED, { hideCompleted: false })).toEqual(['A']);
  });
});

describe('filterTasksForDay — exclusiones estructurales', () => {
  it('las plantillas (isTemplate) nunca aparecen', () => {
    const ts = [task({ id: 'T', dueDate: WED, isTemplate: true })];
    expect(run(ts, WED)).toEqual([]);
  });

  it('una subtarea (parentTaskId) nunca aparece suelta', () => {
    const ts = [task({ id: 'C', subtasks: ['s'] }), task({ id: 's', parentTaskId: 'C', dueDate: WED })];
    // 's' no aparece como raíz; 'C' aparece por su hija pendiente del día
    expect(run(ts, WED)).toEqual(['C']);
  });

  it('bloque inactivo: sus tareas no aparecen', () => {
    const ts = [task({ id: 'A', dueDate: WED, blockId: 'zzz' })];
    expect(run(ts, WED)).toEqual([]);
  });

  it('delegada sin tag real: oculta; con tag real: visible', () => {
    const sinTag = [task({ id: 'A', dueDate: WED, delegation: { to: 'x' } as any, tags: ['resto'] })];
    expect(run(sinTag, WED, { hideDelegatedNoTag: true })).toEqual([]);
    const conTag = [task({ id: 'A', dueDate: WED, delegation: { to: 'x' } as any, tags: ['focus'] })];
    expect(run(conTag, WED, { hideDelegatedNoTag: true })).toEqual(['A']);
  });
});

describe('filterTasksForDay — contenedor sin fecha (day-scoped)', () => {
  it('aparece si tiene ≥1 hija pendiente ESE día', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED }), // pendiente
    ];
    expect(run(ts, WED)).toEqual(['C']);
  });

  it('con TODAS las hijas del día completadas: oculto con hideCompleted, visible sin él', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
    ];
    expect(run(ts, WED, { hideCompleted: true })).toEqual([]);
    expect(run(ts, WED, { hideCompleted: false })).toEqual(['C']);
  });

  it('hijas en varios días: en WED cuenta solo WED; en THU solo THU (nunca mezcla)', () => {
    const ts = [
      task({ id: 'C', subtasks: ['w', 't'] }),
      task({ id: 'w', parentTaskId: 'C', dueDate: WED }),              // pendiente WED
      task({ id: 't', parentTaskId: 'C', dueDate: THU, status: 'completed' }), // completada THU
    ];
    // WED: aparece por la pendiente de WED
    expect(run(ts, WED, { hideCompleted: true })).toEqual(['C']);
    // THU: su única hija de THU está completada → oculto con hideCompleted, visible sin él
    expect(run(ts, THU, { hideCompleted: true })).toEqual([]);
    expect(run(ts, THU, { hideCompleted: false })).toEqual(['C']);
  });
});

describe('Mi Día real: reconcileDay → filterTasksForDay (cableado C3)', () => {
  it('el pipeline compone: contenedor sin fecha con hija pendiente del día aparece', () => {
    const all = mapOf([
      task({ id: 'C', subtasks: ['a'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'X', dueDate: THU }), // de otro día, no debe salir
    ]);
    const dayMap = reconcileDay(WED, all);
    const candidates = Object.values(dayMap).filter((t: any) => t && !t.isDeleted && !t.isTemplate) as Task[];
    const ids = filterTasksForDay(candidates, dayMap, BLOCKS, WED, { hideCompleted: false }).map(t => t.id).sort();
    expect(ids).toEqual(['C']);
  });
});

describe('getStatsForDay — totales del día (cabecera de Mi Día)', () => {
  it('tareas simples del día: cuenta, completadas/pendientes y estimados', () => {
    const ts = [
      task({ id: 'A', dueDate: WED, estimatedMinutes: 30 }),
      task({ id: 'B', dueDate: WED, estimatedMinutes: 20, status: 'completed' }),
    ];
    const s = getStatsForDay(ts, mapOf(ts), [], WED);
    expect(s).toMatchObject({
      total: 2, completed: 1, pending: 1,
      estimatedTotal: 50, estimatedCompleted: 20, estimatedPending: 30, registered: 0,
    });
  });

  it('contenedor: cuenta sus HIJAS-hoja del día, no el contenedor', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 10 }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 5, status: 'completed' }),
    ];
    const s = getStatsForDay([mapOf(ts)['C']], mapOf(ts), [], WED);
    expect(s).toMatchObject({ total: 2, completed: 1, pending: 1, estimatedTotal: 15 });
  });

  it('no cuenta hijas de otro día', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 10 }),
      task({ id: 'b', parentTaskId: 'C', dueDate: THU, estimatedMinutes: 5 }),
    ];
    const s = getStatsForDay([mapOf(ts)['C']], mapOf(ts), [], WED);
    expect(s).toMatchObject({ total: 1, estimatedTotal: 10 });
  });

  it('registered = suma de time_entries de ESE día', () => {
    const ts = [task({ id: 'A', dueDate: WED })];
    const te = [{ date: WED, duration: 25 }, { date: THU, duration: 99 }, { date: WED, duration: 5 }];
    expect(getStatsForDay(ts, mapOf(ts), te, WED).registered).toBe(30);
  });

  it('deduplica: la misma hoja pasada dos veces se cuenta una vez', () => {
    const ts = [task({ id: 'A', dueDate: WED })];
    const A = mapOf(ts)['A'];
    expect(getStatsForDay([A, A], mapOf(ts), [], WED).total).toBe(1);
  });
});

import { getVisibleSubtasksForBloques, hiddenCompletedCountForBloques } from './filters';

describe('getVisibleSubtasksForBloques (regla canónica de Bloques)', () => {
  it('NORMAL: pendientes sí; completadas solo a petición', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', status: 'pending', order: 0 }),
      task({ id: 'b', parentTaskId: 'C', status: 'completed', order: 1 }),
    ];
    const m = mapOf(ts);
    expect(getVisibleSubtasksForBloques(m['C'], m, false)).toEqual(['a']);
    expect(getVisibleSubtasksForBloques(m['C'], m, true)).toEqual(['a', 'b']);
    expect(hiddenCompletedCountForBloques(m['C'], m)).toBe(1);
  });

  it('NORMAL con TODO completado ("cierre eam"): 0 visibles pero hiddenCompletedCount>0', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', status: 'completed' }),
      task({ id: 'b', parentTaskId: 'C', status: 'completed' }),
    ];
    const m = mapOf(ts);
    expect(getVisibleSubtasksForBloques(m['C'], m, false)).toEqual([]);
    expect(hiddenCompletedCountForBloques(m['C'], m)).toBe(2);
  });

  it('RECURRENTE: regla + instancia modificada pendiente; completadas históricas NO (ni a petición)', () => {
    const ts = [
      task({ id: 'C', isTemplate: true, subtasks: ['rule', 'instDone', 'instPend'] }),
      task({ id: 'rule', isTemplate: true, parentTaskId: 'C', order: 0 }),
      task({ id: 'instDone', templateId: 'rule', isException: true, status: 'completed', order: 1 }),
      task({ id: 'instPend', templateId: 'rule', isException: true, status: 'pending', order: 2 }),
    ];
    const m = mapOf(ts);
    expect(getVisibleSubtasksForBloques(m['C'], m, false)).toEqual(['rule', 'instPend']);
    expect(getVisibleSubtasksForBloques(m['C'], m, true)).toEqual(['rule', 'instPend']); // histórica completada nunca inline
    expect(hiddenCompletedCountForBloques(m['C'], m)).toBe(0); // la histórica va por el icono info, no por este toggle
  });

  it('RECURRENTE MIXTO: hija manual pendiente sí; manual completada a petición', () => {
    const ts = [
      task({ id: 'C', isTemplate: true, subtasks: ['rule', 'manP', 'manC'] }),
      task({ id: 'rule', isTemplate: true, parentTaskId: 'C', order: 0 }),
      task({ id: 'manP', parentTaskId: 'C', status: 'pending', order: 1 }),
      task({ id: 'manC', parentTaskId: 'C', status: 'completed', order: 2 }),
    ];
    const m = mapOf(ts);
    expect(getVisibleSubtasksForBloques(m['C'], m, false)).toEqual(['rule', 'manP']);
    expect(getVisibleSubtasksForBloques(m['C'], m, true)).toEqual(['rule', 'manP', 'manC']);
    expect(hiddenCompletedCountForBloques(m['C'], m)).toBe(1);
  });
});
