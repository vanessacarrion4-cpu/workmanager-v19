// ─────────────────────────────────────────────────────────────────────────────
// sortInstanceContainerSubtasks — arreglo bug #21: el reorden de subtareas de un
// contenedor RECURRENTE debe sobrevivir a la recarga. La CLAVE es el `order` de la
// PLANTILLA de cada hija (no el de la instancia, que suele venir 0) — esa es la trampa.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { sortInstanceContainerSubtasks } from './useSupabase';

const WED = '2026-07-15';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const byId = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));

describe('sortInstanceContainerSubtasks (bug #21)', () => {
  it('ordena las hijas recurrentes por el order de la PLANTILLA, no de la instancia', () => {
    // subtasks vienen al revés (b antes que a); las INSTANCIAS tienen order 0 (la trampa);
    // las PLANTILLAS marcan el orden real (a=0, b=1).
    const map = byId([
      task({ id: 'inst-P-2026-07-15', templateId: 'P', dueDate: WED, subtasks: ['inst-b-2026-07-15', 'inst-a-2026-07-15'] }),
      task({ id: 'P', isTemplate: true, subtasks: ['a', 'b'] }),
      task({ id: 'a', isTemplate: true, parentTaskId: 'P', order: 0 }),
      task({ id: 'b', isTemplate: true, parentTaskId: 'P', order: 1 }),
      task({ id: 'inst-a-2026-07-15', templateId: 'a', order: 0 }),
      task({ id: 'inst-b-2026-07-15', templateId: 'b', order: 0 }),
    ]);
    sortInstanceContainerSubtasks(map);
    expect(map['inst-P-2026-07-15'].subtasks).toEqual(['inst-a-2026-07-15', 'inst-b-2026-07-15']);
  });

  it('contenedor MIXTO: recurrente (order plantilla) + manual (order propio) se unifican', () => {
    const map = byId([
      task({ id: 'inst-P-2026-07-15', templateId: 'P', dueDate: WED, subtasks: ['man', 'inst-r-2026-07-15'] }),
      task({ id: 'P', isTemplate: true, subtasks: ['r'] }),
      task({ id: 'r', isTemplate: true, parentTaskId: 'P', order: 1 }),
      task({ id: 'inst-r-2026-07-15', templateId: 'r', order: 0 }),
      task({ id: 'man', parentTaskId: 'inst-P-2026-07-15', dueDate: WED, order: 0 }), // manual, order propio 0 → primero
    ]);
    sortInstanceContainerSubtasks(map);
    expect(map['inst-P-2026-07-15'].subtasks).toEqual(['man', 'inst-r-2026-07-15']);
  });

  it('instancia con <2 subtareas → sin cambios', () => {
    const map = byId([
      task({ id: 'inst-P-2026-07-15', templateId: 'P', subtasks: ['x'] }),
      task({ id: 'x', templateId: 'a' }),
    ]);
    sortInstanceContainerSubtasks(map);
    expect(map['inst-P-2026-07-15'].subtasks).toEqual(['x']);
  });

  it('contenedor NO instancia (sin templateId) → no se toca', () => {
    const map = byId([
      task({ id: 'C', subtasks: ['b', 'a'] }),
      task({ id: 'a', parentTaskId: 'C', order: 0 }),
      task({ id: 'b', parentTaskId: 'C', order: 1 }),
    ]);
    sortInstanceContainerSubtasks(map);
    expect(map['C'].subtasks).toEqual(['b', 'a']); // intacto: este path lo cubre reconstructHierarchy
  });
});
