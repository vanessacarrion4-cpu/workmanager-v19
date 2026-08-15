// ─────────────────────────────────────────────────────────────────────────────
// bulkEffectiveIds — selección real de una acción masiva (camino puro extraído).
// Fija el FIX del item 6 (mismo bug que b1): la hija MANUAL de un contenedor
// recurrente/plantilla, cuyo parentTaskId apunta a la PLANTILLA (no a la instancia),
// se perdía en la acción masiva. Y comprueba que NO se regresa el caso recurrente.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { bulkEffectiveIds } from './useBulkActions';

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
});
