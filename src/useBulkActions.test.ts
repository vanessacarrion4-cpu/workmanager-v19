// ─────────────────────────────────────────────────────────────────────────────
// bulkEffectiveIds — selección real de una acción masiva (camino puro extraído).
// Fija el FIX del item 6 (mismo bug que b1): la hija MANUAL de un contenedor
// recurrente/plantilla, cuyo parentTaskId apunta a la PLANTILLA (no a la instancia),
// se perdía en la acción masiva. Y comprueba que NO se regresa el caso recurrente.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { bulkEffectiveIds, bulkUpdatesForTask, bulkUpsertStatusFields, bulkCompletedDirectIds } from './useBulkActions';

const WED = '2026-07-15';
const THU = '2026-07-16';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const byId = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));
const run = (tasks: Record<string, Task>, sel: string[], day = WED) =>
  bulkEffectiveIds(sel, tasks, day, (id) => tasks[id]).ids.sort();

describe('bulkEffectiveIds', () => {
  it('hoja seleccionada → se incluye tal cual', () => {
    const tasks = byId([task({ id: 'A', dueDate: WED })]);
    expect(run(tasks, ['A'])).toEqual(['A']);
  });

  it('FIX item 6: hija MANUAL que apunta a la PLANTILLA del contenedor (no a la instancia) se incluye', () => {
    const tasks = byId([
      // contenedor recurrente renderizado como instancia (lo que se selecciona)
      task({ id: 'inst-CT-2026-07-15', templateId: 'CT', dueDate: WED, subtasks: ['man'] }),
      task({ id: 'CT', isTemplate: true, subtasks: ['man'] }),
      // hija MANUAL cuyo parentTaskId es la PLANTILLA CT, no la instancia inst-CT-…
      task({ id: 'man', parentTaskId: 'CT', dueDate: WED }),
    ]);
    expect(run(tasks, ['inst-CT-2026-07-15'])).toContain('man');
  });

  it('sin regresión: la instancia recurrente del día sigue entrando', () => {
    const tasks = byId([
      task({ id: 'inst-CT-2026-07-15', templateId: 'CT', dueDate: WED, subtasks: ['inst-rule-2026-07-15'] }),
      task({ id: 'CT', isTemplate: true, subtasks: ['rule'] }),
      task({ id: 'rule', isTemplate: true, parentTaskId: 'CT' }),
      task({ id: 'inst-rule-2026-07-15', templateId: 'rule', dueDate: WED }),
    ]);
    expect(run(tasks, ['inst-CT-2026-07-15'])).toContain('inst-rule-2026-07-15');
  });

  it('mixto: manual (a plantilla) + recurrente del día → ambas', () => {
    const tasks = byId([
      task({ id: 'inst-CT-2026-07-15', templateId: 'CT', dueDate: WED, subtasks: ['man'] }),
      task({ id: 'CT', isTemplate: true, subtasks: ['man', 'rule'] }),
      task({ id: 'man', parentTaskId: 'CT', dueDate: WED }),
      task({ id: 'rule', isTemplate: true, parentTaskId: 'CT' }),
      task({ id: 'inst-rule-2026-07-15', templateId: 'rule', dueDate: WED }),
    ]);
    expect(run(tasks, ['inst-CT-2026-07-15'])).toEqual(['inst-rule-2026-07-15', 'man']);
  });

  it('nunca incluye completadas ni de otro día', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['a', 'b', 'c'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),               // pendiente WED → sí
      task({ id: 'b', parentTaskId: 'C', dueDate: WED, status: 'completed' }), // completada → no
      task({ id: 'c', parentTaskId: 'C', dueDate: THU }),               // otro día → no
    ]);
    expect(run(tasks, ['C'])).toEqual(['a']);
  });

  // §16.34 (a)/(b): `toggleTaskSelection` mete en la selección el contenedor Y TODAS sus hijas renderizadas.
  // Esas hijas caen por la rama HOJA; antes entraban sin filtro (movían/tocaban completadas y de otros días).
  it('§16.34 (a)/(b): contenedor + hijas sueltas → completada y de otro día NO entran (solo la pendiente del día)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['a', 'b', 'c'] }),
      task({ id: 'a', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'b', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'c', parentTaskId: 'C', dueDate: THU }),
    ]);
    // como en la app: se selecciona el contenedor Y sus hijas renderizadas
    expect(run(tasks, ['C', 'a', 'b', 'c'])).toEqual(['a']);
  });

  it('§16.34 (b): hoja COMPLETADA seleccionada suelta → no entra', () => {
    const tasks = byId([task({ id: 'b', dueDate: WED, status: 'completed' })]);
    expect(run(tasks, ['b'])).toEqual([]);
  });

  it('§16.34 (b): hoja de OTRO día seleccionada suelta → no entra', () => {
    const tasks = byId([task({ id: 'c', dueDate: THU })]);
    expect(run(tasks, ['c'])).toEqual([]); // activeDate = WED
  });
});

describe('bulkUpsertStatusFields (§16.34 c — no escribir status que no se cambia a propósito)', () => {
  it('op que NO cambia status (mover fecha) → {} (upsert omite status → conflicto preserva BD)', () => {
    expect(bulkUpsertStatusFields({ dueDate: THU }, task({ id: 'x', status: 'pending' }))).toEqual({});
  });

  it('op que NO cambia status (tags) → {}', () => {
    expect(bulkUpsertStatusFields({ tags: ['focus'] }, task({ id: 'x', status: 'completed' }))).toEqual({});
  });

  it('op que SÍ cambia status a completed → escribe status + completed_at', () => {
    const t = task({ id: 'x', status: 'completed', completedAt: '2026-07-15T10:00:00.000Z' } as any);
    expect(bulkUpsertStatusFields({ status: 'completed' } as any, t)).toEqual({ status: 'completed', completed_at: '2026-07-15T10:00:00.000Z' });
  });

  it('op que cambia status a pending → completed_at null', () => {
    expect(bulkUpsertStatusFields({ status: 'pending' } as any, task({ id: 'x', status: 'pending' }))).toEqual({ status: 'pending', completed_at: null });
  });
});

describe('bulkUpdatesForTask (guard "mover a fecha")', () => {
  const pend = task({ id: 'p', status: 'pending', dueDate: WED });
  const done = task({ id: 'd', status: 'completed', dueDate: WED });

  it('pendiente + mover a fecha → se re-fecha (sin cambios)', () => {
    expect(bulkUpdatesForTask({ dueDate: THU }, pend)).toEqual({ dueDate: THU });
  });

  it('completada + mover a fecha → se ELIMINA dueDate del update (no se re-fecha)', () => {
    expect(bulkUpdatesForTask({ dueDate: THU }, done)).toEqual({});
  });

  it('completada + otros campos (sin dueDate) → intactos', () => {
    expect(bulkUpdatesForTask({ tags: ['focus'] }, done)).toEqual({ tags: ['focus'] });
  });

  it('completada + mover a fecha + tags → solo se quita dueDate, los tags quedan', () => {
    expect(bulkUpdatesForTask({ dueDate: THU, tags: ['focus'] }, done)).toEqual({ tags: ['focus'] });
  });

  it('no muta el objeto updates original', () => {
    const upd: Partial<Task> = { dueDate: THU, tags: ['focus'] };
    bulkUpdatesForTask(upd, done);
    expect(upd).toEqual({ dueDate: THU, tags: ['focus'] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkCompletedDirectIds — Parte 2 (sesión 26). Fija el bug que BORRÓ 2 completadas
// reales: una hija recurrente completada tiene parentTaskId=null, y la heurística
// vieja (isRootSel) la trataba como "marcada directamente" aunque entrara por CASCADA
// de su contenedor. Ahora la cascada protege; solo se borra la marcada SOLA.
// ─────────────────────────────────────────────────────────────────────────────
describe('bulkCompletedDirectIds (Parte 2: la cascada protege las completadas)', () => {
  const runC = (tasks: Record<string, Task>, sel: string[], day = WED) =>
    bulkCompletedDirectIds(sel, tasks, day, (id) => tasks[id]).sort();

  // Escenario EXACTO del daño: contenedor recurrente con hija recurrente COMPLETADA cuya
  // instancia persistida tiene parentTaskId=null (como las 2 víctimas reales).
  const bugTasks = () => byId([
    task({ id: 'inst-CONT-2026-07-15', templateId: 'CONT', dueDate: WED, subtasks: ['inst-CH-2026-07-15'] }), // contenedor renderizado
    task({ id: 'CONT', isTemplate: true, subtasks: ['CH'] }),                                                  // plantilla contenedor
    task({ id: 'CH', isTemplate: true, parentTaskId: 'CONT', recurrence: { frequency: 'daily', startDate: '2026-01-01' } as any }), // plantilla hija
    task({ id: 'inst-CH-2026-07-15', templateId: 'CH', parentTaskId: null as any, dueDate: WED, status: 'completed', isException: true }), // ⚠️ completada, parent NULL
  ]);

  it('CASCADA: contenedor seleccionado (arrastra la hija) → la completada NO se borra', () => {
    // toggleTaskSelection mete contenedor + hijas renderizadas en la selección
    expect(runC(bugTasks(), ['inst-CONT-2026-07-15', 'inst-CH-2026-07-15'])).toEqual([]);
  });

  it('DIRECTA: la completada marcada SOLA (sin su contenedor) → se borra', () => {
    expect(runC(bugTasks(), ['inst-CH-2026-07-15'])).toEqual(['inst-CH-2026-07-15']);
  });

  it('hija MANUAL completada bajo contenedor seleccionado → protegida (parentTaskId a la plantilla)', () => {
    const tasks = byId([
      task({ id: 'inst-CONT-2026-07-15', templateId: 'CONT', dueDate: WED, subtasks: ['man'] }),
      task({ id: 'CONT', isTemplate: true, subtasks: ['man'] }),
      task({ id: 'man', parentTaskId: 'CONT', dueDate: WED, status: 'completed' }),
    ]);
    expect(runC(tasks, ['inst-CONT-2026-07-15', 'man'])).toEqual([]);
  });

  it('las pendientes no entran aquí (esto es SOLO completadas)', () => {
    const tasks = byId([task({ id: 'P', dueDate: WED, status: 'pending' })]);
    expect(runC(tasks, ['P'])).toEqual([]);
  });
});
