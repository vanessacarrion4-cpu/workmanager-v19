// ─────────────────────────────────────────────────────────────────────────────
// collectDeletableTasks — el CONJUNTO real que borra handleDeleteTask (camino real
// extraído, item 4 / TIER 1 #3). Comportamiento idéntico al inline anterior.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { collectDeletableTasks } from './useTaskCRUD';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const byId = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));
const ids = (ts: Task[]) => ts.map(t => t.id).sort();

describe('collectDeletableTasks', () => {
  it('hoja simple → solo ella', () => {
    const tasks = byId([task({ id: 'A' }), task({ id: 'B' })]);
    expect(ids(collectDeletableTasks('A', tasks))).toEqual(['A']);
  });

  it('contenedor → él + todas sus hijas (recursivo/anidado)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['a', 'b'] }),
      task({ id: 'a', parentTaskId: 'C', subtasks: ['a1'] }),
      task({ id: 'a1', parentTaskId: 'a' }),
      task({ id: 'b', parentTaskId: 'C' }),
      task({ id: 'otra' }),
    ]);
    expect(ids(collectDeletableTasks('C', tasks))).toEqual(['C', 'a', 'a1', 'b']);
  });

  it('plantilla de nivel superior → + instancias propias + ocurrencias de sus hijas-plantilla', () => {
    const tasks = byId([
      task({ id: 'T', isTemplate: true, subtasks: ['rule'] }),
      task({ id: 'rule', isTemplate: true, parentTaskId: 'T' }),
      task({ id: 'inst-T-2026-07-15', templateId: 'T' }),               // instancia de la plantilla borrada
      task({ id: 'inst-rule-2026-07-15', templateId: 'rule' }),          // ocurrencia de hija-plantilla
      task({ id: 'ajena', templateId: 'otra-plantilla' }),              // no relacionada
      task({ id: 'otra-plantilla', isTemplate: true }),
    ]);
    expect(ids(collectDeletableTasks('T', tasks))).toEqual(
      ['T', 'inst-T-2026-07-15', 'inst-rule-2026-07-15', 'rule'].sort()
    );
  });

  it('una tarea normal (no plantilla) NO arrastra instancias ajenas por templateId', () => {
    const tasks = byId([
      task({ id: 'N', subtasks: [] }),
      task({ id: 'inst-N-2026-07-15', templateId: 'N' }), // N no es isTemplate → no se arrastra
    ]);
    expect(ids(collectDeletableTasks('N', tasks))).toEqual(['N']);
  });

  it('no duplica en jerarquía con id repetido en subtasks', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['a', 'a'] }), // a listado dos veces
      task({ id: 'a', parentTaskId: 'C' }),
    ]);
    expect(collectDeletableTasks('C', tasks).map(t => t.id)).toEqual(['C', 'a']);
  });
});
