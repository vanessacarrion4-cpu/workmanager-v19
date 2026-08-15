// ─────────────────────────────────────────────────────────────────────────────
// tasksInBlock — el conjunto que se borra al eliminar un bloque (item 1, sesión 19).
// Toda tarea del bloque (contenedor, hija, instancia) lleva blockId → un filtro plano
// las captura todas → ninguna hija queda huérfana. = lo que borra el FK ON DELETE CASCADE.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import { tasksInBlock } from './useBlockHandlers';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1', title: partial.id, status: 'pending', dueDate: null,
    estimatedMinutes: 0, tags: [], order: 0, subtasks: [],
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}
const byId = (ts: Task[]) => Object.fromEntries(ts.map(t => [t.id, t]));

describe('tasksInBlock', () => {
  it('incluye contenedor + hijas + instancia del bloque (toda la jerarquía)', () => {
    const tasks = byId([
      task({ id: 'C', blockId: 'b1', subtasks: ['a', 'inst-r-2026-07-15'] }),
      task({ id: 'a', blockId: 'b1', parentTaskId: 'C' }),
      task({ id: 'inst-r-2026-07-15', blockId: 'b1', templateId: 'r' }),
      task({ id: 'suelta', blockId: 'b1' }),
    ]);
    expect(tasksInBlock('b1', tasks).sort()).toEqual(['C', 'a', 'inst-r-2026-07-15', 'suelta'].sort());
  });

  it('excluye tareas de otros bloques (nada ajeno se borra)', () => {
    const tasks = byId([
      task({ id: 'x', blockId: 'b1' }),
      task({ id: 'y', blockId: 'b2' }),
      task({ id: 'z', blockId: 'b2' }),
    ]);
    expect(tasksInBlock('b1', tasks)).toEqual(['x']);
    expect(tasksInBlock('b2', tasks).sort()).toEqual(['y', 'z']);
  });

  it('bloque sin tareas → []', () => {
    const tasks = byId([task({ id: 'x', blockId: 'b1' })]);
    expect(tasksInBlock('vacio', tasks)).toEqual([]);
  });
});
