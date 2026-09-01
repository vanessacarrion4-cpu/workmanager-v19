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
// TRAMO 4 · computeVerdict — NOTA del día + etiqueta (§16.47, aprobado).
// nota = registrado en tareas DEL PLAN (foto.plan_task_ids) / previsto. Fuera de plan no suma a la nota.
// ─────────────────────────────────────────────────────────────────────────────
import { computeVerdict } from './filters';

const DAY = '2026-07-15';
const S = (o: Partial<{ completed: number; total: number; registered: number; estimatedTotal: number }> = {}) =>
  ({ completed: 0, total: 0, registered: 0, estimatedTotal: 0, ...o });
// foto con plan; time entries que apuntan a ids del plan ese día
const foto = (estimated: number, plan: string[] = [], completed_count = 0) => ({ estimated_minutes: estimated, completed_count, plan_task_ids: plan });
const te = (id: string, duration: number, date = DAY) => ({ taskId: id, subtaskId: null, date, duration });

describe('computeVerdict — NOTA del día', () => {
  it('sin foto → "Día sin fijar", nota null', () => {
    const v = computeVerdict(S({ registered: 240 }), null, 480, [], DAY);
    expect(v.key).toBe('sin_fijar');
    expect(v.nota).toBeNull();
    expect(v.hasFoto).toBe(false);
  });

  it('foto SIN plan_task_ids (antigua) → "sin_nota", nota null, no revienta', () => {
    const v = computeVerdict(S({ registered: 240 }), foto(360, []), 480, [], DAY);
    expect(v.key).toBe('sin_nota');
    expect(v.nota).toBeNull();
    expect(v.hasFoto).toBe(true);
    expect(v.previsto).toBe(360); // las medidas siguen
  });

  it('con foto y 0 registrado en plan → nota 0, "Día sin arrancar"', () => {
    const v = computeVerdict(S({ registered: 0 }), foto(360, ['P1']), 480, [], DAY);
    expect(v.nota).toBe(0);
    expect(v.key).toBe('sin_arrancar');
    expect(v.planRegistered).toBe(0);
  });

  it('a medias: 260m de 360 en el plan → nota 7,2 · "Día a medias"', () => {
    const v = computeVerdict(S({ registered: 260 }), foto(360, ['P1']), 480, [te('P1', 260)], DAY);
    expect(v.nota).toBe(7.2);
    expect(v.key).toBe('a_medias');
    expect(v.planRegistered).toBe(260);
    expect(v.frase).toBe('4h 20m registradas de 6h previstas');
  });

  it('cumplido: 300m de 360 (83%) → nota 8,3 · "Día cumplido" (≥80%)', () => {
    const v = computeVerdict(S({ registered: 300 }), foto(360, ['P1']), 480, [te('P1', 300)], DAY);
    expect(v.nota).toBe(8.3);
    expect(v.key).toBe('cumplido');
  });

  it('completo: 348m de 360 (96,7%) → nota 9,7 · "Día completo" (≥95%)', () => {
    const v = computeVerdict(S({ registered: 348 }), foto(360, ['P1']), 480, [te('P1', 348)], DAY);
    expect(v.nota).toBe(9.7);
    expect(v.key).toBe('completo');
  });

  it('§16.88: el tiempo TOTAL suma a la nota (incluido lo de fuera del plan); outOfPlan solo informa', () => {
    // 260 en el plan (P1) + 120 fuera (X9) → total 380. La nota es sobre el TOTAL (380/360 → tope 10),
    // NO solo sobre el plan (que daría 7,2). planRegistered/outOfPlan se conservan como dato informativo.
    const v = computeVerdict(S({ registered: 380 }), foto(360, ['P1']), 480, [te('P1', 260), te('X9', 120)], DAY);
    expect(v.planRegistered).toBe(260);
    expect(v.nota).toBe(10);           // total(380)/previsto(360) → tope 10 (con el diseño viejo habría sido 7,2)
    expect(v.outOfPlan).toBe(120);     // total(380) − plan(260), solo informativo
  });

  it('sobreplanificado: previsto > jornada → "Día sobreplanificado" (aunque haya nota)', () => {
    const v = computeVerdict(S({ registered: 300 }), foto(540, ['P1']), 480, [te('P1', 300)], DAY);
    expect(v.key).toBe('sobreplanificado');
    expect(v.nota).not.toBeNull();
  });

  it('nota tope 10 si el registrado en plan supera el previsto', () => {
    const v = computeVerdict(S({ registered: 500 }), foto(360, ['P1']), 480, [te('P1', 500)], DAY);
    expect(v.nota).toBe(10);
    expect(v.key).toBe('completo');
  });

  it('hechasTrasFijar = completadas − foto.completed_count', () => {
    const v = computeVerdict(S({ completed: 5, total: 10, registered: 300 }), foto(360, ['P1'], 2), 480, [te('P1', 300)], DAY);
    expect(v.hechasTrasFijar).toBe(3);
  });

  // §16.102: el denominador del reporte viene del PLAN CONGELADO, no del recuento en vivo.
  it('con planCompletion: total = plan congelado, hechas = del plan (NO stats en vivo)', () => {
    const v = computeVerdict(S({ completed: 78, total: 78, registered: 465 }), foto(360, ['P1'], 60), 480, [], DAY, { total: 100, hechas: 78 });
    expect(v.total).toBe(100);   // plan congelado, no los 78 vivos
    expect(v.hechas).toBe(78);
    expect(v.hechasTrasFijar).toBe(18); // 78 − 60
  });

  it('sin foto (o sin plan): total = null → el reporte NO inventa denominador', () => {
    const v = computeVerdict(S({ completed: 78, total: 78, registered: 465 }), null, 480, [], DAY, null);
    expect(v.total).toBeNull();
    expect(v.hechas).toBe(78); // recuento honesto de lo hecho hoy
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

// ─────────────────────────────────────────────────────────────────────────────
// §16.101 · getEstimationDeviation — ¿estimo bien? (estimado vs registrado de lo COMPLETADO)
// Distinto del FIJADO vs HECHO. No depende de la foto. Completadas sin tiempo → aparte.
// ─────────────────────────────────────────────────────────────────────────────
import { getEstimationDeviation } from './filters';

describe('getEstimationDeviation — desviación estimado vs registrado', () => {
  const D = '2026-07-15';
  it('solo completadas CON tiempo; tardé +20m en total; por bloque y etiqueta', () => {
    const ts = [
      task({ id: 'A', dueDate: D, status: 'completed', estimatedMinutes: 60, tags: ['focus'] }),
      task({ id: 'B', dueDate: D, status: 'completed', estimatedMinutes: 30, tags: ['resto'] }),
      task({ id: 'C', dueDate: D, status: 'completed', estimatedMinutes: 45, tags: ['focus'] }), // sin tiempo
      task({ id: 'D', dueDate: D, status: 'pending', estimatedMinutes: 100 }),                   // no completada
    ];
    const te = [
      { taskId: 'A', subtaskId: null, date: D, duration: 90 },   // estimé 60, tardé 90 → +30
      { taskId: 'B', subtaskId: null, date: D, duration: 20 },   // estimé 30, tardé 20 → −10
    ];
    const dev = getEstimationDeviation(ts, mapOf(ts), te, D);
    expect(dev.count).toBe(2);
    expect(dev.estimated).toBe(90);
    expect(dev.registered).toBe(110);
    expect(dev.deviation).toBe(20);
    expect(dev.ratioPct).toBe(122);
    expect(dev.sinTiempo).toEqual({ count: 1, estimated: 45 });
    expect(dev.byBlock).toEqual([{ key: 'b1', estimated: 90, registered: 110, deviation: 20, count: 2 }]);
    // ordenado por |desviación|: focus(+30) antes que resto(−10)
    expect(dev.byTag).toEqual([
      { key: 'focus', estimated: 60, registered: 90, deviation: 30, count: 1 },
      { key: 'resto', estimated: 30, registered: 20, deviation: -10, count: 1 },
    ]);
  });

  it('registrado = SOLO el del día (día-scoped): no agrega histórico de recurrentes', () => {
    const ts = [task({ id: 'A', dueDate: D, status: 'completed', estimatedMinutes: 60, tags: ['focus'] })];
    const te = [
      { taskId: 'A', subtaskId: null, date: '2026-07-14', duration: 40 }, // otro día → NO cuenta
      { taskId: 'A', subtaskId: null, date: D, duration: 50 },            // el del día → cuenta
    ];
    const dev = getEstimationDeviation(ts, mapOf(ts), te, D);
    expect(dev.registered).toBe(50); // solo el del día
    expect(dev.deviation).toBe(-10); // estimé 60, fiché 50 ese día
  });

  it('día sin fijación: funciona igual (no toca la foto)', () => {
    const ts = [task({ id: 'A', dueDate: D, status: 'completed', estimatedMinutes: 60 })];
    const te = [{ taskId: 'A', subtaskId: null, date: D, duration: 60 }];
    const dev = getEstimationDeviation(ts, mapOf(ts), te, D);
    expect(dev.deviation).toBe(0);
    expect(dev.ratioPct).toBe(100);
  });

  it('nada completado → todo a cero', () => {
    const ts = [task({ id: 'A', dueDate: D, status: 'pending', estimatedMinutes: 60 })];
    const dev = getEstimationDeviation(ts, mapOf(ts), [], D);
    expect(dev).toMatchObject({ count: 0, estimated: 0, registered: 0, deviation: 0, ratioPct: null });
    expect(dev.sinTiempo).toEqual({ count: 0, estimated: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.104 (pieza 8) · getEntradaForDay — dos secciones + hijas agrupadas bajo su contenedor
// ─────────────────────────────────────────────────────────────────────────────
import { getEntradaForDay } from './filters';

describe('getEntradaForDay — agrupado en dos secciones', () => {
  const D = '2026-07-15';
  const born = { createdAt: `${D}T10:00:00` };
  it('contenedor con hijas en las dos secciones aparece en ambas con su nota', () => {
    const ts = [
      task({ id: 'C', subtasks: ['a', 'b'], ...born }),
      task({ id: 'a', parentTaskId: 'C', dueDate: D, estimatedMinutes: 10, ...born }),        // hoy
      task({ id: 'b', parentTaskId: 'C', dueDate: '2026-07-20', estimatedMinutes: 5, ...born }), // otro
      task({ id: 'S', dueDate: D, estimatedMinutes: 30, ...born }),                            // suelta, hoy
    ];
    const e = getEntradaForDay(D, mapOf(ts));
    // sección HOY: la suelta S + el contenedor C con hija a (y nota: 1 en la otra)
    expect(e.hoy.count).toBe(2);
    expect(e.hoy.minutes).toBe(40);
    const cHoy = e.hoy.groups.find(g => g.containerId === 'C');
    expect(cHoy?.rows.map(r => r.id)).toEqual(['a']);
    expect(cHoy?.otherCount).toBe(1);
    // sección OTRO: el contenedor C con hija b (nota: 1 para hoy)
    expect(e.otro.count).toBe(1);
    const cOtro = e.otro.groups.find(g => g.containerId === 'C');
    expect(cOtro?.rows.map(r => r.id)).toEqual(['b']);
    expect(cOtro?.otherCount).toBe(1);
  });

  it('tarea suelta va en su sección, sin contenedor', () => {
    const ts = [task({ id: 'X', dueDate: '2026-07-20', estimatedMinutes: 15, ...born })];
    const e = getEntradaForDay(D, mapOf(ts));
    expect(e.hoy.count).toBe(0);
    expect(e.otro.count).toBe(1);
    expect(e.otro.groups[0]).toMatchObject({ containerId: null, title: 'X', minutes: 15 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.104 (pieza 7) · getOutOfPlanBreakdown — tiempo fichado FUERA del plan, agrupado por contenedor
// ─────────────────────────────────────────────────────────────────────────────
import { getOutOfPlanBreakdown } from './filters';

describe('getOutOfPlanBreakdown — tiempo no previsto', () => {
  const D = '2026-07-15';
  it('excluye el tiempo del plan; agrupa hijas bajo contenedor; suma = outOfPlan', () => {
    const ts = [
      task({ id: 'P1', dueDate: D }),                       // en el plan
      task({ id: 'X', dueDate: D }),                        // fuera del plan, suelta
      task({ id: 'C', subtasks: ['a'] }),
      task({ id: 'a', parentTaskId: 'C' }),                 // fuera del plan, hija de C
    ];
    const te = [
      { taskId: 'P1', subtaskId: null, date: D, duration: 60 }, // plan → NO cuenta
      { taskId: 'X', subtaskId: null, date: D, duration: 30 },  // fuera
      { taskId: 'a', subtaskId: null, date: D, duration: 20 },  // fuera, hija de C
      { taskId: 'X', subtaskId: null, date: '2026-07-14', duration: 99 }, // otro día → NO
    ];
    const r = getOutOfPlanBreakdown(['P1'], te, mapOf(ts), D);
    expect(r.total).toBe(50); // 30 + 20
    const cont = r.groups.find(g => g.containerId === 'C');
    expect(cont?.rows).toEqual([{ id: 'a', title: 'a', minutes: 20 }]);
    expect(cont?.minutes).toBe(20);
    const suelta = r.groups.find(g => g.containerId === null);
    expect(suelta?.minutes).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.104 (pieza 6) · getFijadoVsHecho — plan (estimado) vs realidad (registrado), en tiempo
// ─────────────────────────────────────────────────────────────────────────────
import { getFijadoVsHecho } from './filters';

describe('getFijadoVsHecho — fijado vs hecho por bloque y etiqueta', () => {
  const D = '2026-07-15';
  it('§16.107 (#2): HECHO = SOLO tiempo del plan (lo de fuera no cuenta aquí)', () => {
    const ts = [
      task({ id: 'a', blockId: 'b1', tags: ['focus'], taskType: 'core', estimatedMinutes: 60 }), // plan, core
      task({ id: 'b', blockId: 'b2', tags: ['resto'], estimatedMinutes: 30 }),   // plan, no hecho, adhoc
      task({ id: 'X', blockId: 'b1', tags: ['focus'] }),                         // fuera del plan → NO cuenta en hecho
    ];
    const te = [
      { taskId: 'a', subtaskId: null, date: D, duration: 90 },
      { taskId: 'X', subtaskId: null, date: D, duration: 10 }, // fuera del plan → excluido
    ];
    const r = getFijadoVsHecho(['a', 'b'], te, mapOf(ts), D);
    expect(r.totalFijado).toBe(90);   // 60 + 30
    expect(r.totalHecho).toBe(90);    // solo 'a' (90); la X queda fuera
    expect(r.byBlock.find(x => x.key === 'b1')).toMatchObject({ fijado: 60, hecho: 90 });
    expect(r.byBlock.find(x => x.key === 'b2')).toMatchObject({ fijado: 30, hecho: 0 });
    expect(r.byType.find(x => x.key === 'core')).toMatchObject({ fijado: 60, hecho: 90 });
    expect(r.byType.find(x => x.key === 'adhoc')).toMatchObject({ fijado: 30, hecho: 0 });
  });

  it('§16.106: plan CONGELADO — fijado usa el estimado/bloque de la foto aunque la tarea cambie después', () => {
    // La tarea 'a' se fijó con estimado 60 en bloque b1; DESPUÉS se editó a 10 y se movió a b2.
    const ts = [
      task({ id: 'a', blockId: 'b2', tags: ['focus'], taskType: 'core', estimatedMinutes: 10 }),
    ];
    const encoded = ['a::60::b1::focus::core']; // lo que se guardó AL FIJAR
    const te = [{ taskId: 'a', subtaskId: null, date: D, duration: 45 }];
    const r = getFijadoVsHecho(encoded, te, mapOf(ts), D);
    // FIJADO sigue siendo 60 en b1 (congelado), NO 10 en b2 (estado actual)
    expect(r.totalFijado).toBe(60);
    expect(r.byBlock.find(x => x.key === 'b1')).toMatchObject({ fijado: 60, hecho: 45 });
    expect(r.byBlock.find(x => x.key === 'b2')).toBeUndefined();
  });
});
