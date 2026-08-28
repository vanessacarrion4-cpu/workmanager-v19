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

// ─────────────────────────────────────────────────────────────────────────────
// TRAMO 4 · computeVerdict — sentencia automática del Reporte (§16.42, umbrales aprobados).
// Mide estabilidad del plan. Sin foto no se inventa previsto.
// ─────────────────────────────────────────────────────────────────────────────
import { computeVerdict } from './filters';

const S = (o: Partial<{ completed: number; total: number; registered: number; estimatedTotal: number }> = {}) =>
  ({ completed: 0, total: 0, registered: 0, estimatedTotal: 0, ...o });

describe('computeVerdict — sentencia del reporte', () => {
  it('sin foto → "Día sin fijar", sin previsto ni desviación inventados', () => {
    const v = computeVerdict(S({ completed: 3, total: 8, registered: 240, estimatedTotal: 600 }), null, 480);
    expect(v.key).toBe('sin_fijar');
    expect(v.sentence).toBe('Día sin fijar');
    expect(v.previsto).toBeNull();
    expect(v.anadido).toBeNull();
    expect(v.hechasTrasFijar).toBeNull();
    expect(v.registrado).toBe(240); // lo calculable sí se muestra
    expect(v.hechas).toBe(3);
    expect(v.total).toBe(8);
  });

  it('sobreplanificado: previsto > jornada (sensible, sin ×1.25) — 9h con jornada 8h ya salta', () => {
    const v = computeVerdict(S({ estimatedTotal: 540 }), { estimated_minutes: 540, completed_count: 0 }, 480);
    expect(v.key).toBe('sobreplanificado');
    expect(v.sentence).toBe('Día sobreplanificado: 9h previstas');
  });

  it('previsto == jornada NO es sobreplanificado (estricto >)', () => {
    const v = computeVerdict(S({ estimatedTotal: 480, registered: 300 }), { estimated_minutes: 480, completed_count: 0 }, 480);
    expect(v.key).toBe('cumplido');
  });

  it('desviado: añadido ≥ max(1h, 25% del previsto)', () => {
    // previsto 360 (6h), 25% = 90m; añadido 120 ≥ 90 → desviado
    const v = computeVerdict(S({ estimatedTotal: 480 }), { estimated_minutes: 360, completed_count: 0 }, 600);
    expect(v.key).toBe('desviado');
    expect(v.sentence).toBe('Día desviado: entraron 2h no previstas');
  });

  it('desviado frontera: el suelo de 1h manda cuando 25% es menor', () => {
    // previsto 120, 25% = 30 → max(60,30)=60. añadido 60 → desviado; 59 → cumplido
    expect(computeVerdict(S({ estimatedTotal: 180 }), { estimated_minutes: 120, completed_count: 0 }, 600).key).toBe('desviado');
    expect(computeVerdict(S({ estimatedTotal: 179 }), { estimated_minutes: 120, completed_count: 0 }, 600).key).toBe('cumplido');
  });

  it('cumplido: dentro de jornada y sin desviación → "X de Y previstas"', () => {
    const v = computeVerdict(S({ registered: 300, estimatedTotal: 360 }), { estimated_minutes: 360, completed_count: 0 }, 480);
    expect(v.key).toBe('cumplido');
    expect(v.sentence).toBe('Día cumplido: 5h de 6h previstas');
  });

  it('sobreplanificado tiene prioridad sobre desviado', () => {
    const v = computeVerdict(S({ estimatedTotal: 900 }), { estimated_minutes: 720, completed_count: 0 }, 480);
    expect(v.key).toBe('sobreplanificado'); // 720>480 gana aunque añadido=180 también dispararía desviado
  });

  it('día aligerado (añadido negativo) → cumplido, nunca desviado', () => {
    const v = computeVerdict(S({ registered: 200, estimatedTotal: 300 }), { estimated_minutes: 360, completed_count: 0 }, 480);
    expect(v.key).toBe('cumplido');
    expect(v.anadido).toBe(-60);
  });

  it('hechasTrasFijar = completadas − foto.completed_count', () => {
    const v = computeVerdict(S({ completed: 5, total: 10, estimatedTotal: 360 }), { estimated_minutes: 360, completed_count: 2 }, 480);
    expect(v.hechasTrasFijar).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAMO 4 · getReportBreakdown — el desglose del REPORTE es el DÍA COMPLETO
// (hechas + pendientes), a diferencia del de la cabecera (solo pendientes). §16.42.
// ─────────────────────────────────────────────────────────────────────────────
import { getReportBreakdown } from './filters';

describe('getReportBreakdown — día completo (incluye completadas)', () => {
  it('cuenta las completadas; la cabecera (getStatsForDay) NO', () => {
    const hecha = task({ id: 'H', dueDate: WED, status: 'completed', estimatedMinutes: 60, taskType: 'core', tags: ['focus'], blockId: 'b1' });
    const pend = task({ id: 'P', dueDate: WED, status: 'pending', estimatedMinutes: 30, taskType: 'adhoc', tags: ['espera'], blockId: 'b1' });
    const ts = [hecha, pend];
    const m = mapOf(ts);

    // Cabecera: solo pendiente (30m adhoc/espera)
    const stats = getStatsForDay(ts, m, [], WED);
    expect(stats.byType).toEqual({ core: 0, adhoc: 30 });
    expect(stats.byTag).toEqual([{ tag: 'espera', minutes: 30 }]);

    // Reporte: día completo (90m = 60 core/focus + 30 adhoc/espera)
    const rep = getReportBreakdown(ts, m, WED);
    expect(rep.byType).toEqual({ core: 60, adhoc: 30 });
    expect(rep.byBlock).toEqual([{ blockId: 'b1', minutes: 90 }]);
    // por etiqueta, de más a menos: focus(60) antes que espera(30)
    expect(rep.byTag).toEqual([{ tag: 'focus', minutes: 60 }, { tag: 'espera', minutes: 30 }]);
  });
});
