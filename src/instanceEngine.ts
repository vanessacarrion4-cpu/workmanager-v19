/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Motor de instancias V20 — dos funciones puras.
 *
 * - occursOn(task, fecha): ¿toca este día? (predicado puro, NO genera nada,
 *   NO aplica excepciones — eso se hace en la capa que agrega Carga/Semana).
 * - materializeDay(fecha, allTasks): instancias reales de UN día para el Dashboard.
 *   Regla clave: una EXCEPCIÓN PERSISTIDA siempre gana sobre la regeneración
 *   (p.ej. una instancia ya completada se devuelve completada, no se regenera).
 *
 * Ninguna de las dos escribe en Supabase ni muta `allTasks`.
 */

import { Task } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';

// -------------------------------------------------------------------------
// occursOn — predicado puro de recurrencia
// -------------------------------------------------------------------------

/** Aplica la regla de recurrencia a una fecha concreta (semana lunes-base). */
function matchesRecurrence(recurrence: NonNullable<Task['recurrence']>, dateStr: string): boolean {
  if (!recurrence) return false;

  // Límites temporales
  if (dateStr < (recurrence.startDate || '')) return false;
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;

  const date = parseLocalISO(dateStr);
  const jsDay = date.getDay();
  const specDay = (jsDay + 6) % 7; // 0=lunes ... 6=domingo
  const dayOfMonth = date.getDate();

  switch (recurrence.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return specDay >= 0 && specDay <= 4;
    case 'weekly':
      return recurrence.weekDays?.includes(specDay) || false;
    case 'monthly':
      return recurrence.monthDay === dayOfMonth;
    case 'yearly': {
      // yearDay / yearMonth los fija el usuario; si faltan, se leen de startDate.
      const targetDay = recurrence.yearDay ?? (recurrence.startDate ? parseLocalISO(recurrence.startDate).getDate() : null);
      const targetMonth = recurrence.yearMonth ?? (recurrence.startDate ? parseLocalISO(recurrence.startDate).getMonth() + 1 : null);
      if (targetDay === null || targetMonth === null) return false;
      return date.getDate() === targetDay && (date.getMonth() + 1) === targetMonth;
    }
    default:
      return false;
  }
}

/**
 * ¿La tarea `task` ocurre en `dateStr` (YYYY-MM-DD)?
 *
 * - Con `recurrence`: aplica la regla de recurrencia.
 * - Sin recurrencia, con `dueDate`: ocurre solo el día de su fecha.
 * - Sin recurrencia ni fecha: nunca.
 *
 * Función PURA: no mira excepciones, no muta nada, no crea objetos.
 */
export function occursOn(task: Task | null | undefined, dateStr: string): boolean {
  if (!task || !dateStr) return false;
  if (task.recurrence) return matchesRecurrence(task.recurrence, dateStr);
  if (task.dueDate) return task.dueDate === dateStr;
  return false;
}

// -------------------------------------------------------------------------
// materializeDay — instancias reales de un día
// -------------------------------------------------------------------------

/**
 * Índice de excepciones persistidas por templateId (una sola pasada).
 * Incluye borradas: se necesitan para suprimir un día concreto.
 */
function indexExceptionsByTemplate(allTasks: Record<string, Task>): Map<string, Task[]> {
  const byTemplate = new Map<string, Task[]>();
  for (const t of Object.values(allTasks)) {
    if (t && t.templateId && t.isException) {
      const arr = byTemplate.get(t.templateId);
      if (arr) arr.push(t);
      else byTemplate.set(t.templateId, [t]);
    }
  }
  return byTemplate;
}

/** Excepción (no borrada) que "aterriza" en este día: se muestra aquí (dueDate === día). */
function findLanded(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => !e.isDeleted && e.dueDate === dateStr);
}

/** Excepción borrada que afecta a este día: suprime la ocurrencia. */
function findDeletedForDay(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => e.isDeleted && (e.dueDate === dateStr || e.instanceDate === dateStr));
}

/** Excepción (no borrada) que "abandona" este día: su día original era `dateStr` pero se movió. */
function findVacated(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => !e.isDeleted && e.instanceDate === dateStr && e.dueDate !== dateStr);
}

/**
 * Resuelve qué objeto Task representa a un hijo (`childTemplate`) en `dateStr`.
 * Devuelve `null` si el hijo no aparece ese día.
 *
 * Precedencia (la excepción persistida SIEMPRE gana):
 *   1. Excepción borrada para este día → no aparece.
 *   2. Excepción persistida que aterriza aquí → se devuelve TAL CUAL (puede estar
 *      completada). Solo se ajusta el parentTaskId sin mutar el original.
 *   3. Excepción que abandona este día → no aparece (se verá en su nuevo día).
 *   4. Hijo manual (isTemplate:false) cuya fecha es hoy → tarea real por referencia.
 *   5. La recurrencia toca hoy → se genera una instancia nueva en 'pending'.
 *   6. En otro caso → no aparece.
 */
function resolveChildForDay(
  childTemplate: Task,
  dateStr: string,
  parentInstanceId: string,
  exceptionsByTemplate: Map<string, Task[]>,
  timestamp: string
): Task | null {
  const exceptions = exceptionsByTemplate.get(childTemplate.id);

  // 1. Borrada para este día → suprimida.
  if (findDeletedForDay(exceptions, dateStr)) return null;

  // 2. Excepción persistida que aterriza hoy → GANA sobre la regeneración.
  const landed = findLanded(exceptions, dateStr);
  if (landed) {
    // Copia superficial para cablear el padre correcto sin mutar el original.
    return { ...landed, parentTaskId: parentInstanceId };
  }

  // 3. Se movió a otro día → no aparece hoy.
  if (findVacated(exceptions, dateStr)) return null;

  // 4. Hijo manual (tarea real, no plantilla): aparece el día de su fecha.
  if (childTemplate.isTemplate === false) {
    if (!childTemplate.isDeleted && childTemplate.dueDate === dateStr) {
      return { ...childTemplate, parentTaskId: parentInstanceId };
    }
    return null;
  }

  // 5. La recurrencia toca hoy → instancia nueva en 'pending'.
  if (occursOn(childTemplate, dateStr)) {
    return {
      ...childTemplate,
      id: `inst-${childTemplate.id}-${dateStr}`,
      templateId: childTemplate.id,
      parentTaskId: parentInstanceId,
      dueDate: dateStr,
      instanceDate: dateStr,
      isTemplate: false,
      isException: false,
      status: 'pending',
      completedAt: null,
      subtasks: [],
      createdAt: timestamp,
      modifiedAt: timestamp,
    };
  }

  // 6. No aparece.
  return null;
}

/**
 * Materializa las instancias de UN solo día a partir de las plantillas y
 * excepciones que hay en `allTasks`.
 *
 * Devuelve un array plano: por cada contenedor que aparece ese día, el
 * contenedor seguido de sus hijos. Las instancias recurrentes se generan al
 * vuelo; las excepciones persistidas y las tareas manuales se incluyen (con su
 * id y estado reales). NO escribe en Supabase ni muta `allTasks`.
 */
export function materializeDay(dateStr: string, allTasks: Record<string, Task>): Task[] {
  if (!dateStr || !allTasks) return [];

  const exceptionsByTemplate = indexExceptionsByTemplate(allTasks);
  const timestamp = new Date().toISOString();
  const result: Task[] = [];

  // Ids referenciados como subtarea de cualquier tarea: NO son contenedores de nivel 1.
  // (Evita que un template hijo sin parentTaskId se materialice dos veces.)
  const childIds = new Set<string>();
  for (const t of Object.values(allTasks)) {
    if (t?.subtasks) for (const id of t.subtasks) childIds.add(id);
  }

  // Plantillas-contenedor reales (nivel 1): isTemplate, sin templateId ni padre,
  // activas, y que no son subtarea de nadie.
  const containers = Object.values(allTasks).filter(t =>
    t &&
    t.isTemplate === true &&
    !t.templateId &&
    !t.parentTaskId &&
    !childIds.has(t.id) &&
    t.isActive !== false &&
    !t.isDeleted
  );

  for (const container of containers) {
    const containerExceptions = exceptionsByTemplate.get(container.id);

    // Contenedor-día borrado por completo → nada.
    if (findDeletedForDay(containerExceptions, dateStr)) continue;

    // ¿El contenedor viene de una excepción persistida que aterriza hoy?
    const containerLanded = findLanded(containerExceptions, dateStr);
    const parentInstanceId = containerLanded ? containerLanded.id : `inst-${container.id}-${dateStr}`;

    const childTemplates = (container.subtasks || [])
      .map(id => allTasks[id])
      .filter(Boolean) as Task[];

    // --- Caso contenedor SIN hijos: plantilla recurrente autónoma ---
    if (childTemplates.length === 0) {
      if (findVacated(containerExceptions, dateStr)) continue;
      if (containerLanded) {
        result.push({ ...containerLanded, subtasks: [] });
        continue;
      }
      if (occursOn(container, dateStr)) {
        result.push(buildContainerInstance(container, parentInstanceId, dateStr, [], timestamp));
      }
      continue;
    }

    // --- Caso contenedor CON hijos ---
    const resolvedChildren: Task[] = [];
    const subtaskIds: string[] = [];
    for (const child of childTemplates) {
      const resolved = resolveChildForDay(child, dateStr, parentInstanceId, exceptionsByTemplate, timestamp);
      if (resolved) {
        resolvedChildren.push(resolved);
        subtaskIds.push(resolved.id);
      }
    }

    // Si el contenedor tiene hijos pero ninguno aplica hoy (todos movidos/borrados),
    // no se crea un contenedor vacío... salvo que exista una excepción de contenedor.
    if (subtaskIds.length === 0 && !containerLanded) continue;

    const containerInstance = containerLanded
      ? { ...containerLanded, subtasks: subtaskIds }
      : buildContainerInstance(container, parentInstanceId, dateStr, subtaskIds, timestamp);

    result.push(containerInstance, ...resolvedChildren);
  }

  return result;
}

/** Construye una instancia de contenedor nueva en 'pending' a partir de su plantilla. */
function buildContainerInstance(
  container: Task,
  instanceId: string,
  dateStr: string,
  subtaskIds: string[],
  timestamp: string
): Task {
  return {
    ...container,
    id: instanceId,
    templateId: container.id,
    parentTaskId: null,
    dueDate: dateStr,
    instanceDate: dateStr,
    isTemplate: false,
    isException: false,
    status: 'pending',
    completedAt: null,
    subtasks: subtaskIds,
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}
