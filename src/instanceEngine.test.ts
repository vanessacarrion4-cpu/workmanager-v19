/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { occursOn, materializeDay, resolveTaskId, materializeInstanceById, templateIdFromInstanceId, resolveActionTarget } from './instanceEngine';
import { Task } from './types';

// Fechas ancla (verificadas): 2026-07-15 es MIÉRCOLES.
// 07-13 Lun · 07-14 Mar · 07-15 Mié · 07-16 Jue · 07-17 Vie · 07-18 Sáb · 07-19 Dom
const MON = '2026-07-13';
const WED = '2026-07-15';
const THU = '2026-07-16';
const SAT = '2026-07-18';

/** Factoría mínima de Task para reducir ruido en los tests. */
function task(partial: Partial<Task> & { id: string }): Task {
  return {
    blockId: 'b1',
    title: partial.id,
    status: 'pending',
    dueDate: null,
    estimatedMinutes: 30,
    tags: [],
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Task;
}

function byId(tasks: Task[]): Record<string, Task> {
  return Object.fromEntries(tasks.map(t => [t.id, t]));
}

// =========================================================================
// occursOn
// =========================================================================

describe('occursOn', () => {
  it('daily: ocurre cualquier día dentro del rango', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'daily', startDate: '2026-01-01' } });
    expect(occursOn(t, WED)).toBe(true);
    expect(occursOn(t, SAT)).toBe(true);
  });

  it('weekdays: lunes a viernes sí, fin de semana no', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'weekdays', startDate: '2026-01-01' } });
    expect(occursOn(t, WED)).toBe(true);
    expect(occursOn(t, SAT)).toBe(false);
  });

  it('weekly: solo los weekDays indicados (0=lunes ... 2=miércoles)', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'weekly', weekDays: [2], startDate: '2026-01-01' } });
    expect(occursOn(t, WED)).toBe(true);   // miércoles
    expect(occursOn(t, THU)).toBe(false);  // jueves
    expect(occursOn(t, MON)).toBe(false);  // lunes
  });

  it('monthly: solo el día del mes configurado', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'monthly', monthDay: 15, startDate: '2026-01-01' } });
    expect(occursOn(t, WED)).toBe(true);   // día 15
    expect(occursOn(t, THU)).toBe(false);  // día 16
  });

  it('yearly: día y mes exactos (yearDay/yearMonth)', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'yearly', yearDay: 15, yearMonth: 7, startDate: '2020-01-01' } });
    expect(occursOn(t, WED)).toBe(true);         // 15 de julio
    expect(occursOn(t, THU)).toBe(false);        // 16 de julio
    expect(occursOn(t, '2026-08-15')).toBe(false); // 15 de agosto
    expect(occursOn(t, '2027-07-15')).toBe(true);  // otro año, mismo día
  });

  it('yearly: usa startDate como fallback si faltan yearDay/yearMonth', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'yearly', startDate: '2020-07-15' } });
    expect(occursOn(t, WED)).toBe(true);
    expect(occursOn(t, THU)).toBe(false);
  });

  it('respeta startDate y endDate', () => {
    const t = task({ id: 'c', recurrence: { frequency: 'daily', startDate: '2026-07-16', endDate: '2026-07-20' } });
    expect(occursOn(t, WED)).toBe(false); // antes de startDate
    expect(occursOn(t, THU)).toBe(true);  // dentro
    expect(occursOn(t, '2026-07-21')).toBe(false); // después de endDate
  });

  it('sin recurrencia: ocurre solo el día de su dueDate', () => {
    const t = task({ id: 'm', dueDate: WED });
    expect(occursOn(t, WED)).toBe(true);
    expect(occursOn(t, THU)).toBe(false);
  });

  it('sin recurrencia ni dueDate: nunca; y null/undefined tolerados', () => {
    expect(occursOn(task({ id: 'x' }), WED)).toBe(false);
    expect(occursOn(null, WED)).toBe(false);
    expect(occursOn(undefined, WED)).toBe(false);
  });
});

// =========================================================================
// materializeDay
// =========================================================================

describe('materializeDay', () => {
  it('contenedor con hijo recurrente diario → genera contenedor + hijo pending', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
    ]);

    const day = materializeDay(WED, allTasks);
    const container = day.find(t => t.templateId === 't-cont');
    const child = day.find(t => t.templateId === 't-child');

    expect(container).toBeDefined();
    expect(child).toBeDefined();
    expect(container!.id).toBe('inst-t-cont-2026-07-15');
    expect(child!.id).toBe('inst-t-child-2026-07-15');
    expect(child!.parentTaskId).toBe(container!.id);
    expect(container!.subtasks).toEqual(['inst-t-child-2026-07-15']);
    expect(child!.status).toBe('pending');
    expect(child!.instanceDate).toBe(WED);
  });

  it('hijo recurrente que NO toca hoy → contenedor no aparece', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'weekly', weekDays: [0], startDate: '2026-01-01' } }), // solo lunes
    ]);
    expect(materializeDay(WED, allTasks)).toEqual([]);
  });

  it('hijo manual: aparece el día de su fecha, no otros días', () => {
    const build = (dateStr: string) => byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['manual-1'] }),
      task({ id: 'manual-1', isTemplate: false, dueDate: WED }),
    ]);
    const onDay = materializeDay(WED, build(WED));
    expect(onDay.find(t => t.id === 'manual-1')).toBeDefined();
    expect(materializeDay(THU, build(THU))).toEqual([]);
  });

  it('excepción movida (instanceDate=WED, dueDate=THU) → no en WED, sí en THU', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      // Instancia del miércoles movida al jueves:
      task({
        id: 'inst-t-child-moved', templateId: 't-child', isException: true,
        instanceDate: WED, dueDate: THU,
      }),
    ]);

    const wed = materializeDay(WED, allTasks);
    // En miércoles NO debe regenerarse la instancia normal (fue movida).
    expect(wed.find(t => t.templateId === 't-child')).toBeUndefined();

    const thu = materializeDay(THU, allTasks);
    const movedChild = thu.find(t => t.id === 'inst-t-child-moved');
    expect(movedChild).toBeDefined();
    expect(movedChild!.dueDate).toBe(THU);
  });

  it('CONTENEDOR movido (instanceDate=WED, dueDate=THU) con hija que SÍ ocurre WED → día viejo VACÍO, THU lo muestra', () => {
    // findVacated en la rama CON-hijas (bug de los 3 contenedores movidos): antes el contenedor aparecía en WED
    // (la hija sigue occursOn) Y en THU = doble render. Con el fix, el día viejo se vacía.
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      // El CONTENEDOR (no la hija) se movió de WED a THU:
      task({ id: 'inst-t-cont-moved', templateId: 't-cont', isException: true, instanceDate: WED, dueDate: THU }),
    ]);
    const wed = materializeDay(WED, allTasks);
    expect(wed.find(t => t.templateId === 't-cont')).toBeUndefined();   // contenedor NO en el día viejo
    expect(wed.find(t => t.templateId === 't-child')).toBeUndefined();  // ni sus hijas
    const thu = materializeDay(THU, allTasks);
    expect(thu.find(t => t.id === 'inst-t-cont-moved')).toBeDefined();  // aterriza en el destino
  });

  it('NO-REGRESIÓN: contenedor con excepción que ATERRIZA el mismo día (landed) sigue apareciendo (guard !containerLanded)', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-cont-landed', templateId: 't-cont', isException: true, instanceDate: WED, dueDate: WED, status: 'completed' }),
    ]);
    expect(materializeDay(WED, allTasks).find(t => t.id === 'inst-t-cont-landed')).toBeDefined();
  });

  it('NO-REGRESIÓN: contenedor con excepción BORRADA el día → oculto', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-cont-del', templateId: 't-cont', isException: true, isDeleted: true, instanceDate: WED, dueDate: WED }),
    ]);
    expect(materializeDay(WED, allTasks)).toEqual([]);
  });

  it('excepción borrada → suprime la ocurrencia de ese día', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-child-del', templateId: 't-child', isException: true, isDeleted: true,
        instanceDate: WED, dueDate: WED,
      }),
    ]);
    // El hijo estaba borrado ese día → contenedor sin hijos → no aparece.
    expect(materializeDay(WED, allTasks)).toEqual([]);
  });

  it('REGLA CLAVE: excepción completada persiste y gana sobre la regeneración', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      // El miércoles ya se completó y se guardó como excepción:
      task({
        id: 'inst-t-child-2026-07-15', templateId: 't-child', isException: true,
        instanceDate: WED, dueDate: WED, status: 'completed', completedAt: '2026-07-15T10:00:00.000Z',
      }),
    ]);

    const day = materializeDay(WED, allTasks);
    const child = day.find(t => t.templateId === 't-child');

    expect(child).toBeDefined();
    // Debe devolver la versión COMPLETADA persistida, no una nueva 'pending'.
    expect(child!.id).toBe('inst-t-child-2026-07-15');
    expect(child!.status).toBe('completed');
    expect(child!.completedAt).toBe('2026-07-15T10:00:00.000Z');
    // Y solo una versión del hijo (no duplicada).
    expect(day.filter(t => t.templateId === 't-child')).toHaveLength(1);
  });

  it('no muta allTasks ni inyecta las instancias generadas en él', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
    ]);
    const snapshot = JSON.stringify(allTasks);
    const keysBefore = Object.keys(allTasks).length;

    materializeDay(WED, allTasks);

    expect(JSON.stringify(allTasks)).toBe(snapshot); // sin mutación
    expect(Object.keys(allTasks).length).toBe(keysBefore); // sin filas nuevas
    expect(allTasks['inst-t-child-2026-07-15']).toBeUndefined();
  });

  // TAPÓN B (§16.16, sesión 18) — forma REAL de un contenedor con hijas recurrentes (isTemplate:true, la
  // única forma que materializeDay procesa; los 75 manuales no pasan por aquí). El bug de "Verduras vivas":
  // "borrar → este día" deja una excepción-borrada de CONTENEDOR que enterraba el subárbol aunque hubiera
  // hijas pendientes vivas ese día.
  it('TAPÓN B: excepción-BORRADA del contenedor para el día PERO con hija pendiente ese día → el contenedor SIGUE apareciendo', () => {
    const tasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', parentTaskId: 't-cont', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      // "borrar → este día" del contenedor: excepción-BORRADA a nivel de contenedor para WED
      task({ id: 'inst-t-cont-2026-07-15', templateId: 't-cont', parentTaskId: null, dueDate: WED, instanceDate: WED, isDeleted: true, isException: true }),
      // hija PENDIENTE persistida ese día (huérfana, parent_task_id=null) → trabajo vivo que NO enterrar
      task({ id: 'inst-t-child-2026-07-15', templateId: 't-child', parentTaskId: null, dueDate: WED, instanceDate: WED, status: 'pending', isException: true }),
    ]);
    const day = materializeDay(WED, tasks);
    expect(day.some(t => t.id === 'inst-t-cont-2026-07-15')).toBe(true);                       // contenedor reaparece
    expect(day.some(t => t.templateId === 't-child' && t.status !== 'completed')).toBe(true);  // con su hija pendiente
  });

  it('TAPÓN B (control): excepción-borrada del contenedor + hija COMPLETADA (sin pendientes) → el contenedor SÍ se suprime (borrado respetado)', () => {
    const tasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', parentTaskId: 't-cont', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-cont-2026-07-15', templateId: 't-cont', parentTaskId: null, dueDate: WED, instanceDate: WED, isDeleted: true, isException: true }),
      task({ id: 'inst-t-child-2026-07-15', templateId: 't-child', parentTaskId: null, dueDate: WED, instanceDate: WED, status: 'completed', isException: true }),
    ]);
    const day = materializeDay(WED, tasks);
    expect(day.some(t => t.id === 'inst-t-cont-2026-07-15')).toBe(false); // sin trabajo vivo → borrado respetado
  });
});

// =========================================================================
// resolveTaskId  (id de instancia virtual → id de la tarea REAL)
// =========================================================================

describe('resolveTaskId', () => {
  it('id que no es instancia (manual/plantilla) → se devuelve tal cual', () => {
    expect(resolveTaskId('t-123', {})).toBe('t-123');
    expect(resolveTaskId('tpl-abc', {})).toBe('tpl-abc');
  });

  it('SIN excepción → devuelve la PLANTILLA', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
    ]);
    expect(resolveTaskId('inst-t-5-2026-07-15', allTasks)).toBe('t-5');
  });

  it('templateId con letras y guiones → el regex lo extrae bien (no /^inst-(t-\\d+)/)', () => {
    expect(resolveTaskId('inst-tpl-abc-9-2026-07-15', {})).toBe('tpl-abc-9');
  });

  it('CON excepción completada (en su sitio) → devuelve la EXCEPCIÓN', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true,
        instanceDate: WED, dueDate: WED, status: 'completed', completedAt: '2026-07-15T10:00:00.000Z',
      }),
    ]);
    // La excepción persistida gana sobre la plantilla.
    expect(resolveTaskId('inst-t-5-2026-07-15', allTasks)).toBe('inst-t-5-2026-07-15');
  });

  it('CON excepción MOVIDA de día → al consultar el día destino, devuelve la EXCEPCIÓN', () => {
    // Instancia del miércoles movida al jueves: el id conserva la fecha original,
    // pero dueDate apunta al día nuevo.
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true,
        instanceDate: WED, dueDate: THU,
      }),
    ]);
    // En el día destino (jueves) aterriza la excepción → gana.
    expect(resolveTaskId('inst-t-5-2026-07-16', allTasks)).toBe('inst-t-5-2026-07-15');
    // En el día original (miércoles) ya no aterriza nada → vuelve a la plantilla.
    expect(resolveTaskId('inst-t-5-2026-07-15', allTasks)).toBe('t-5');
  });

  it('excepción BORRADA de ese día → se ignora (vuelve a la plantilla)', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true, isDeleted: true,
        instanceDate: WED, dueDate: WED,
      }),
    ]);
    expect(resolveTaskId('inst-t-5-2026-07-15', allTasks)).toBe('t-5');
  });

  it('id con formato inesperado (sin fecha) → se devuelve tal cual', () => {
    expect(resolveTaskId('inst-cosa-rara', {})).toBe('inst-cosa-rara');
  });

  it('no muta allTasks', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true, instanceDate: WED, dueDate: WED, status: 'completed' }),
    ]);
    const snapshot = JSON.stringify(allTasks);
    resolveTaskId('inst-t-5-2026-07-15', allTasks);
    expect(JSON.stringify(allTasks)).toBe(snapshot);
  });
});

// =========================================================================
// resolveActionTarget — rescate centralizado (sesión 15): resuelve el objetivo de
// una acción, materializando la instancia virtual si solo existe en memoria.
// =========================================================================
describe('resolveActionTarget', () => {
  const daily = () => byId([
    task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
  ]);

  it('fila real en el estado → se devuelve tal cual', () => {
    const allTasks = byId([task({ id: 't-9', dueDate: WED })]);
    expect(resolveActionTarget('t-9', allTasks)?.id).toBe('t-9');
  });

  it('instancia SOLO virtual (la recurrencia toca) → la MATERIALIZA (la ocurrencia, no la plantilla)', () => {
    const r = resolveActionTarget('inst-t-5-2026-07-15', daily());
    expect(r).not.toBeNull();
    expect(r!.id).toBe('inst-t-5-2026-07-15');
    expect(r!.templateId).toBe('t-5');
    expect(r!.isException).toBe(false);
    expect(r!.status).toBe('pending');
  });

  it('NUNCA devuelve la plantilla', () => {
    const r = resolveActionTarget('inst-t-5-2026-07-15', daily());
    expect(r!.isTemplate).not.toBe(true);
    expect(r!.id).not.toBe('t-5');
  });

  it('excepción persistida en su sitio → la devuelve (hit directo, con su estado real)', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true, instanceDate: WED, dueDate: WED, status: 'completed' }),
    ]);
    const r = resolveActionTarget('inst-t-5-2026-07-15', allTasks);
    expect(r!.id).toBe('inst-t-5-2026-07-15');
    expect(r!.status).toBe('completed');
  });

  it('excepción MOVIDA → al pedir el id del día destino, resuelve a la EXCEPCIÓN (no la plantilla)', () => {
    const allTasks = byId([
      task({ id: 't-5', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({ id: 'inst-t-5-2026-07-15', templateId: 't-5', isException: true, instanceDate: WED, dueDate: THU }),
    ]);
    const r = resolveActionTarget('inst-t-5-2026-07-16', allTasks);
    expect(r!.id).toBe('inst-t-5-2026-07-15');
  });

  it('no encontrado → null', () => {
    expect(resolveActionTarget('t-inexistente', {})).toBeNull();
    expect(resolveActionTarget('inst-t-5-2026-07-15', {})).toBeNull(); // sin plantilla
  });

  it('no muta allTasks', () => {
    const allTasks = daily();
    const snapshot = JSON.stringify(allTasks);
    resolveActionTarget('inst-t-5-2026-07-15', allTasks);
    expect(JSON.stringify(allTasks)).toBe(snapshot);
  });
});

// =========================================================================
// materializeInstanceById  (id de instancia virtual → objeto Task materializado)
// =========================================================================

describe('materializeInstanceById', () => {
  const contWithDailyChild = () => byId([
    task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
    task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
  ]);

  it('id que NO es instancia y existe → devuelve la fila real tal cual', () => {
    const allTasks = byId([task({ id: 'm-1', isTemplate: false, dueDate: WED })]);
    expect(materializeInstanceById('m-1', allTasks)).toBe(allTasks['m-1']);
  });

  it('id que NO es instancia y no existe → null', () => {
    expect(materializeInstanceById('no-existe', {})).toBeNull();
  });

  it('instancia recurrente VIRGEN que toca hoy → objeto materializado (pending, no excepción)', () => {
    const child = materializeInstanceById('inst-t-child-2026-07-15', contWithDailyChild());
    expect(child).not.toBeNull();
    expect(child!.id).toBe('inst-t-child-2026-07-15');
    expect(child!.templateId).toBe('t-child');
    expect(child!.status).toBe('pending');
    expect(child!.isException).toBe(false);
    expect(child!.dueDate).toBe(WED);
    expect(child!.instanceDate).toBe(WED);
    expect(child!.parentTaskId).toBe('inst-t-cont-2026-07-15');
  });

  it('contenedor VIRGEN que toca hoy → instancia de contenedor con sus hijas', () => {
    const cont = materializeInstanceById('inst-t-cont-2026-07-15', contWithDailyChild());
    expect(cont).not.toBeNull();
    expect(cont!.templateId).toBe('t-cont');
    expect(cont!.subtasks).toEqual(['inst-t-child-2026-07-15']);
  });

  it('día en el que la recurrencia NO toca → null', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'weekly', weekDays: [0], startDate: '2026-01-01' } }), // solo lunes
    ]);
    expect(materializeInstanceById('inst-t-child-2026-07-15', allTasks)).toBeNull(); // miércoles
  });

  it('excepción persistida que aterriza CON ese mismo id → la devuelve (completada gana)', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-child-2026-07-15', templateId: 't-child', isException: true,
        instanceDate: WED, dueDate: WED, status: 'completed', completedAt: '2026-07-15T10:00:00.000Z',
      }),
    ]);
    const child = materializeInstanceById('inst-t-child-2026-07-15', allTasks);
    expect(child).not.toBeNull();
    expect(child!.status).toBe('completed');
  });

  it('excepción MOVIDA: id virtual del día destino → null (lo cubre resolveTaskId); el del origen → null (vacated)', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-child-2026-07-15', templateId: 't-child', isException: true,
        instanceDate: WED, dueDate: THU, // movida miércoles → jueves
      }),
    ]);
    expect(materializeInstanceById('inst-t-child-2026-07-16', allTasks)).toBeNull(); // destino
    expect(materializeInstanceById('inst-t-child-2026-07-15', allTasks)).toBeNull(); // origen (vacated)
  });

  it('id inst- con formato inesperado (sin fecha) → allTasks[id] o null', () => {
    expect(materializeInstanceById('inst-cosa-rara', {})).toBeNull();
  });

  it('templateId realista con guiones (UUID) → devuelve la instancia, NO null (evita fallo silencioso)', () => {
    // Si el parseo reconstruyera el templateId con un split ingenuo, un UUID con guiones
    // daría null → el handler caería en console.error y "parecería que no pasa nada".
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: [uuid] }),
      task({ id: uuid, isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
    ]);
    const instId = `inst-${uuid}-2026-07-15`;
    const child = materializeInstanceById(instId, allTasks);
    expect(child).not.toBeNull();
    expect(child!.id).toBe(instId);
    expect(child!.templateId).toBe(uuid);
    expect(child!.status).toBe('pending');
  });

  it('instancia con excepción isDeleted:true ese día → null (no-materializable; no resucita al togglear)', () => {
    const allTasks = byId([
      task({ id: 't-cont', isTemplate: true, subtasks: ['t-child'] }),
      task({ id: 't-child', isTemplate: true, recurrence: { frequency: 'daily', startDate: '2026-01-01' } }),
      task({
        id: 'inst-t-child-2026-07-15', templateId: 't-child', isException: true, isDeleted: true,
        instanceDate: WED, dueDate: WED,
      }),
    ]);
    // materializeDay suprime el día borrado → el helper lo devuelve como no-materializable.
    expect(materializeInstanceById('inst-t-child-2026-07-15', allTasks)).toBeNull();
  });

  it('no muta allTasks ni inyecta la instancia generada', () => {
    const allTasks = contWithDailyChild();
    const snapshot = JSON.stringify(allTasks);
    const keysBefore = Object.keys(allTasks).length;
    materializeInstanceById('inst-t-child-2026-07-15', allTasks);
    expect(JSON.stringify(allTasks)).toBe(snapshot);
    expect(Object.keys(allTasks).length).toBe(keysBefore);
    expect(allTasks['inst-t-child-2026-07-15']).toBeUndefined();
  });
});

// =========================================================================
// templateIdFromInstanceId  (B0 — strip robusto a tmpl-/letras)
// =========================================================================

describe('templateIdFromInstanceId', () => {
  it('id que NO es inst- → se devuelve tal cual', () => {
    expect(templateIdFromInstanceId('t-123')).toBe('t-123');
    expect(templateIdFromInstanceId('tmpl-1785089440019')).toBe('tmpl-1785089440019');
  });

  it('templateId t-<dígitos> (el caso que el regex viejo SÍ acertaba)', () => {
    expect(templateIdFromInstanceId('inst-t-1785089440019-2028-01-15')).toBe('t-1785089440019');
  });

  it('templateId tmpl-<dígitos> → el caso que ROMPÍA /^inst-(t-\\d+)/ (B0)', () => {
    // Con el regex viejo daría null/parcial (tras inst- viene "tmpl", no "t-"); el strip lo resuelve.
    expect(templateIdFromInstanceId('inst-tmpl-1785089440019-2028-01-15')).toBe('tmpl-1785089440019');
  });

  it('templateId con letras/guiones intermedios (duplicado t-…-base36, UUID)', () => {
    expect(templateIdFromInstanceId('inst-t-1721984000000-a1b2c3d4e-2028-01-15')).toBe('t-1721984000000-a1b2c3d4e');
    expect(templateIdFromInstanceId('inst-a1b2c3d4-e5f6-7890-abcd-ef1234567890-2028-01-15'))
      .toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('inst- sin fecha final → se devuelve tal cual (formato inesperado)', () => {
    expect(templateIdFromInstanceId('inst-cosa-rara')).toBe('inst-cosa-rara');
  });
});
