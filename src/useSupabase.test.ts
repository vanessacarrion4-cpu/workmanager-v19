// ─────────────────────────────────────────────────────────────────────────────
// sortInstanceContainerSubtasks — arreglo bug #21: el reorden de subtareas de un
// contenedor RECURRENTE debe sobrevivir a la recarga. La CLAVE es el `order` de la
// PLANTILLA de cada hija (no el de la instancia, que suele venir 0) — esa es la trampa.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { sortInstanceContainerSubtasks, mapDbTaskToTask } from './useSupabase';

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

describe('mapDbTaskToTask (fuente única del mapeo DB→Task; usado en carga y restore)', () => {
  it('mapea snake_case → camelCase, incluida la columna nueva deleted_with_block', () => {
    const t = mapDbTaskToTask({
      id: 't-1', block_id: 'b1', title: 'X', status: 'pending',
      due_date: '2026-07-15', is_template: true, is_exception: false, is_deleted: false,
      parent_task_id: 'p1', template_id: 'tpl1', instance_date: '2026-07-15',
      deleted_at: null, deleted_with_block: 'blk-9',
    });
    expect(t).toMatchObject({
      id: 't-1', blockId: 'b1', title: 'X', status: 'pending', dueDate: '2026-07-15',
      isTemplate: true, isException: false, isDeleted: false, parentTaskId: 'p1',
      templateId: 'tpl1', instanceDate: '2026-07-15', deletedWithBlock: 'blk-9',
    });
  });

  it('defaults: tags→[], subtasks→[], existsInSupabase→true, onHold→false, isActive por !==false', () => {
    const t = mapDbTaskToTask({ id: 't-2', block_id: 'b1', title: 'Y', status: 'pending' });
    expect(t.tags).toEqual([]);
    expect(t.subtasks).toEqual([]);
    expect((t as any).existsInSupabase).toBe(true);
    expect(t.onHold).toBe(false);
    expect(t.isActive).toBe(true);      // is_active undefined → !== false → true
    expect(t.deletedWithBlock).toBe(null); // deleted_with_block ausente → null
  });

  it('is_active:false → isActive:false', () => {
    expect(mapDbTaskToTask({ id: 't-3', is_active: false }).isActive).toBe(false);
  });
});
