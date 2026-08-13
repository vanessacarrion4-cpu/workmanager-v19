// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — contratos del modelo (§16.16). La mayoría YA están implementados y cableados;
// `reconcileDay` sigue en STUB (rojo a propósito) hasta (c). Estos tests fijan el
// comportamiento correcto y se ponen ROJOS si alguien regresa (p.ej. si el código vuelve a
// leer el status/estimado/etiquetas propios de un contenedor).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Task } from './types';
import {
  containerEstimatedForDay,
  containerRegisteredForDay,
  isContainerCompleteOnDay,
  childrenToToggleOnDay,
  reconcileDay,
  shouldDegradeToNormal,
} from './fase3Contracts';

// 2026-07-13 Lun · 07-15 Mié · 07-16 Jue
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

// =========================================================================
// Principio (a): el tiempo/estimado del contenedor = suma de sus hijas DEL DÍA;
// nunca cuenta tiempo registrado sobre el propio contenedor.
// =========================================================================
describe('FASE 3 · principio (a) — totales del contenedor por día', () => {
  it('estimado del contenedor = suma SOLO de las hijas del día (no de otros días)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, estimatedMinutes: 15 }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, estimatedMinutes: 20 }),
    ]);
    // Mié: solo A (15). Hoy el stub suma A+B = 35.
    expect(containerEstimatedForDay('C', tasks, WED)).toBe(15);
  });

  it('registrado del contenedor NO cuenta el tiempo registrado sobre el propio contenedor', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
    ]);
    const entries = [
      { taskId: 'C', subtaskId: null, date: WED, duration: 90 }, // sobre el contenedor: NO debe contar
      { taskId: 'A', subtaskId: null, date: WED, duration: 10 }, // sobre la hija: sí
    ];
    expect(containerRegisteredForDay('C', tasks, entries, WED)).toBe(10);
  });
});

// =========================================================================
// Principio (b): completado DERIVADO de las hijas del día; el status guardado NO se lee.
// =========================================================================
describe('FASE 3 · principio (b) — completado derivado del contenedor', () => {
  it('completo cuando TODAS las hijas del día están completas', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }), // sin status guardado
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(true);
  });

  it('TRAMPA: status guardado "completed" pero una hija del día pendiente → NO completo (no se lee el campo)', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'], status: 'completed' }), // guardado engañoso
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: WED, status: 'pending' }),
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('solo cuentan las hijas DEL DÍA: hija de otro día pendiente no impide completar hoy', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED, status: 'completed' }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'pending' }), // otro día
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(true);
  });

  it('CASO REAL 30-jul: 8 hijas del día completas + 2 pendientes → NO completo (aunque status guardado engañe)', () => {
    const subs: Task[] = [];
    for (let i = 0; i < 8; i++) subs.push(task({ id: `done${i}`, parentTaskId: 'C', dueDate: WED, status: 'completed' }));
    subs.push(task({ id: 'ngd', parentTaskId: 'C', dueDate: WED, status: 'pending' }));
    subs.push(task({ id: 'ngdbot', parentTaskId: 'C', dueDate: WED, status: 'pending' }));
    const tasks = byId([
      task({ id: 'C', subtasks: subs.map(s => s.id), status: 'completed' }), // status guardado engañoso
      ...subs,
    ]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('sin NINGUNA hija del día → NO completo (no "verdadero por vacío")', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: THU, status: 'completed' }), // otro día
      task({ id: 'B', parentTaskId: 'C', dueDate: THU, status: 'completed' }), // otro día
    ]);
    // Miércoles no tiene ninguna hija → aunque todas las de otros días estén hechas, NO completo hoy.
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('contenedor sin subtareas → NO completo (no cuenta como derivado-completo)', () => {
    const tasks = byId([task({ id: 'C', subtasks: [] })]);
    expect(isContainerCompleteOnDay('C', tasks, WED)).toBe(false);
  });

  it('clicar el contenedor completa SOLO las hijas del día', () => {
    const tasks = byId([
      task({ id: 'C', subtasks: ['A', 'B'] }),
      task({ id: 'A', parentTaskId: 'C', dueDate: WED }),
      task({ id: 'B', parentTaskId: 'C', dueDate: THU }),
    ]);
    expect(childrenToToggleOnDay('C', tasks, WED)).toEqual(['A']);
  });
});

// =========================================================================
// Reconciliación sin fuga: el mapa del día X no incluye filas de otro día.
// =========================================================================
describe('FASE 3 · reconciliación del día sin fuga', () => {
  it('el mapa del día X excluye una fila cuyo día es distinto', () => {
    const tasks = byId([
      task({ id: 'X', dueDate: WED }),
      task({ id: 'Y', dueDate: THU }),
    ]);
    const map = reconcileDay(WED, tasks);
    expect(map['X']).toBeDefined();
    expect(map['Y']).toBeUndefined();
  });
});

// =========================================================================
// (b2) Degradación: contenedor vaciado vuelve a tarea normal (§16.16)
// =========================================================================
describe('FASE 3 · degradación de contenedor vaciado (§16.16)', () => {
  it('contenedor (isTemplate, sin pauta) sin hijas → degradar', () => {
    const tasks = byId([task({ id: 'C', isTemplate: true, subtasks: [] })]);
    expect(shouldDegradeToNormal('C', tasks)).toBe(true);
  });

  it('con hija borrada como única hija → degradar (las borradas no cuentan)', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C', isDeleted: true }),
    ]);
    expect(shouldDegradeToNormal('C', tasks)).toBe(true);
  });

  it('con al menos una hija viva → NO degradar', () => {
    const tasks = byId([
      task({ id: 'C', isTemplate: true, subtasks: ['A'] }),
      task({ id: 'A', parentTaskId: 'C' }),
    ]);
    expect(shouldDegradeToNormal('C', tasks)).toBe(false);
  });

  it('regla recurrente (con pauta) → NO degradar aunque no tenga hijas', () => {
    const tasks = byId([task({ id: 'C', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } })]);
    expect(shouldDegradeToNormal('C', tasks)).toBe(false);
  });

  it('tarea normal (no template) → NO degradar', () => {
    const tasks = byId([task({ id: 'C' })]);
    expect(shouldDegradeToNormal('C', tasks)).toBe(false);
  });
});
