/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, SubtaskTemplate, TagType, Attachment, Priority } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';

export function getTaskLevel(task: Task, tasks: Record<string, Task>, visited = new Set<string>()): number {
  if (visited.has(task.id)) return 1;
  visited.add(task.id);
  if (!task.parentTaskId) return 1;
  const parent = tasks[task.parentTaskId];
  if (!parent) return 1;
  return getTaskLevel(parent, tasks, visited) + 1;
}

export function isTaskCompleted(taskId: string, tasks: Record<string, Task>, instanceDate?: string, visited = new Set<string>()): boolean {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const task = tasks[taskId];
  if (!task) return false;
  
  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.every(subId => isTaskCompleted(subId, tasks, instanceDate, visited));
  }
  
  return task.status === 'completed';
}

/**
 * Comprueba si una recurrencia aplica para una fecha concreta.
 * Soporta: daily, weekdays, weekly, monthly, yearly.
 * Respeta endDate.
 */
function matchesRecurrence(recurrence: any, date: Date): boolean {
  if (!recurrence) return false;
  
  const dateStr = formatLocalISO(date);
  if (dateStr < (recurrence.startDate || '')) return false;
  
  // Respetar endDate
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;

  const jsDay = date.getDay();
  const specDay = (jsDay + 6) % 7; // 0=lunes...6=domingo
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12

  switch (recurrence.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return specDay >= 0 && specDay <= 4;
    case 'weekly':
      return recurrence.weekDays?.includes(specDay) || false;
    case 'monthly':
      return recurrence.monthDay === dayOfMonth;
    case 'yearly':
      // yearMonth: 1-12, yearDay: 1-31
      return recurrence.yearMonth === month && recurrence.yearDay === dayOfMonth;
    default:
      return false;
  }
}

/**
 * Indica si una tarea es repetitiva (tiene recurrencia propia o alguna subtarea la tiene).
 */
export function isTaskRepetitive(taskId: string, allTasks: Record<string, Task>, visited = new Set<string>()): boolean {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const task = allTasks[taskId];
  if (!task) return false;
  if (task.recurrence) return true;
  if (!task.subtasks || task.subtasks.length === 0) return false;
  return task.subtasks.some(id => isTaskRepetitive(id, allTasks, visited));
}

/**
 * ─────────────────────────────────────────────────────────────────
 * GENERACIÓN DE INSTANCIAS — arquitectura correcta
 * ─────────────────────────────────────────────────────────────────
 *
 * REGLAS:
 *
 * 1. Solo se procesan templates originales (isTemplate=true, sin templateId, sin parentTaskId).
 *
 * 2. TAREA RECURRENTE SOLA (isTemplate, recurrence propia, sin subtareas recurrentes):
 *    → Genera una instancia por cada día en que su recurrencia aplica.
 *    → La instancia tiene templateId = template.id, dueDate = dateStr.
 *
 * 3. CONTENEDOR CON SUBTAREAS (isTemplate, sin recurrencia propia, con subtareas):
 *    → Aparece los días en que AL MENOS UNA subtarea recurrente aplica ese día.
 *    → Ese día se generan instancias de:
 *        a) Las subtareas recurrentes que aplican ese día.
 *        b) Las subtareas NO recurrentes (siempre acompañan al padre cuando es visible).
 *    → El padre instancia agrupa a todos ellos.
 *
 * 4. EXCEPCIONES: nunca se regenera una instancia si ya existe en allTasks
 *    (sea instancia normal o excepción guardada). Esto preserva los cambios del usuario.
 *
 * 5. Las instancias viven en memoria. Solo se persisten en Supabase los templates
 *    y las excepciones (isException=true).
 * ─────────────────────────────────────────────────────────────────
 */
export function generateInstances(
  allTasks: Record<string, Task> = {},
  startDateStr: string,
  daysToProject: number
): Task[] {
  if (!allTasks) return [];

  const newInstances: Task[] = [];
  const timestamp = new Date().toISOString();

  // Solo templates raíz originales
  const rootTemplates = Object.values(allTasks).filter(t =>
    t &&
    t.isTemplate &&
    !t.templateId &&
    !t.parentTaskId &&
    t.isActive !== false &&
    !t.isDeleted &&
    isTaskRepetitive(t.id, allTasks)
  );

  const startDate = parseLocalISO(startDateStr);

  for (let d = 0; d < daysToProject; d++) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + d);
    const dateStr = formatLocalISO(current);

    rootTemplates.forEach(template => {
      if (!template) return;

      const children = (template.subtasks || [])
        .map(id => allTasks[id])
        .filter(Boolean) as Task[];

      // ── Determinar si el template debe aparecer este día ──────────
      const isSoloRecurring = !!template.recurrence && children.filter(c => c.recurrence).length === 0;

      let shouldAppear = false;

      if (isSoloRecurring) {
        // Tarea recurrente sola: aplica si su propia recurrencia coincide
        shouldAppear = matchesRecurrence(template.recurrence, current);
      } else {
        // Contenedor: aplica si al menos una subtarea recurrente coincide
        shouldAppear = children.some(c => c.recurrence && matchesRecurrence(c.recurrence, current));
      }

      if (!shouldAppear) return;

      const parentInstanceId = `inst-${template.id}-${dateStr}`;

      // No regenerar si ya existe en estado (instancia normal o excepción)
      if (allTasks[parentInstanceId]) return;

      // No regenerar si existe una excepción para este template en este día
      const hasException = Object.values(allTasks).some(t =>
        t &&
        t.templateId === template.id &&
        t.instanceDate === dateStr &&
        t.isException
      );
      if (hasException) return;

      // ── Caso A: tarea recurrente sola ─────────────────────────────
      if (isSoloRecurring) {
        const instance: Task = {
          ...template,
          id: parentInstanceId,
          templateId: template.id,
          dueDate: dateStr,
          instanceDate: dateStr,
          isTemplate: false,
          isException: false,
          recurrence: undefined, // ✅ Instancias NO tienen recurrencia
          taskType: template.taskType || 'core', // ✅ Preservar taskType del template
          status: 'pending',
          completedAt: undefined,
          createdAt: timestamp,
          modifiedAt: timestamp,
          subtasks: [],
        };
        newInstances.push(instance);
        return;
      }

      // ── Caso B: contenedor con subtareas ──────────────────────────
      const subtaskInstanceIds: string[] = [];
      const subtasksToCreate: Task[] = [];

      children.forEach(childTemplate => {
        // Subtarea recurrente: solo si aplica hoy
        if (childTemplate.recurrence) {
          if (!matchesRecurrence(childTemplate.recurrence, current)) return;
        }
        // Subtarea NO recurrente: siempre acompaña al padre cuando es visible
        // (a menos que tenga dueDate fijada en otro día concreto)
        else if (childTemplate.dueDate && childTemplate.dueDate !== dateStr) {
          return;
        }

        const childInstanceId = `inst-${childTemplate.id}-${dateStr}`;

        // Si ya existe (excepción guardada), reutilizar su ID
        if (allTasks[childInstanceId]) {
          subtaskInstanceIds.push(childInstanceId);
          return;
        }

        // Comprobar excepción para esta subtarea en este día
        const childHasException = Object.values(allTasks).some(t =>
          t &&
          t.templateId === childTemplate.id &&
          t.instanceDate === dateStr &&
          t.isException
        );
        if (childHasException) {
          // La excepción ya existe con otro ID — no crear duplicado
          // pero sí incluirla en el padre si la encontramos
          const exceptionTask = Object.values(allTasks).find(t =>
            t &&
            t.templateId === childTemplate.id &&
            t.instanceDate === dateStr &&
            t.isException
          );
          if (exceptionTask) subtaskInstanceIds.push(exceptionTask.id);
          return;
        }

        const childInstance: Task = {
          ...childTemplate,
          id: childInstanceId,
          templateId: childTemplate.id,
          parentTaskId: parentInstanceId,
          dueDate: dateStr,
          instanceDate: dateStr,
          isTemplate: false,
          isException: false,
          recurrence: undefined, // ✅ Instancias NO tienen recurrencia
          taskType: childTemplate.taskType || 'core', // ✅ Preservar taskType del template
          status: 'pending',
          completedAt: undefined,
          createdAt: timestamp,
          modifiedAt: timestamp,
          subtasks: [],
        };

        subtasksToCreate.push(childInstance);
        subtaskInstanceIds.push(childInstanceId);
      });

      // El padre instancia agrupa todas las subtareas de este día
      const parentInstance: Task = {
        ...template,
        id: parentInstanceId,
        templateId: template.id,
        dueDate: dateStr,
        instanceDate: dateStr,
        isTemplate: false,
        isException: false,
        status: 'pending',
        completedAt: undefined,
        createdAt: timestamp,
        modifiedAt: timestamp,
        subtasks: subtaskInstanceIds,
        // El padre contenedor no hereda tags ni recurrencia — es solo agrupador
        tags: [],
        recurrence: undefined,
        taskType: template.taskType || 'core', // ✅ Preservar taskType del template
      };

      newInstances.push(parentInstance, ...subtasksToCreate);
    });
  }

  return newInstances;
}

/**
 * Calcula el tiempo estimado total de un día sumando instancias raíz visibles.
 * No regenera — trabaja sobre allTasks que ya tiene las instancias en memoria.
 */
export function projectLoadForDay(
  dateStr: string,
  allTasks: Record<string, Task>
): number {
  let totalTime = 0;
  const counted = new Set<string>();

  for (const t of Object.values(allTasks)) {
    if (!t || t.isDeleted) continue;
    if (t.parentTaskId) continue;       // subtareas: se suman vía su padre
    if (t.isTemplate) continue;         // nunca contar templates originales

    // Caso 1: Tarea con dueDate = dateStr
    if (t.dueDate === dateStr) {
      const id = t.id;
      if (counted.has(id)) continue;
      counted.add(id);
      totalTime += getEstimatedForInstance(id, allTasks);
      continue;
    }

    // Caso 2: Contenedor SIN dueDate pero con subtareas del día
    if (!t.dueDate && t.subtasks && t.subtasks.length > 0) {
      // Sumar SOLO las subtareas que tienen dueDate = dateStr
      t.subtasks.forEach(subId => {
        const sub = allTasks[subId];
        if (sub && !sub.isDeleted && sub.dueDate === dateStr) {
          if (!counted.has(subId)) {
            counted.add(subId);
            totalTime += getEstimatedForInstance(subId, allTasks);
          }
        }
      });
    }
  }

  return totalTime;
}

/**
 * Tiempo estimado de una instancia (recursivo sobre subtareas).
 */
function getEstimatedForInstance(
  taskId: string,
  allTasks: Record<string, Task>,
  visited = new Set<string>()
): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  
  const task = allTasks[taskId];
  if (!task) return 0;

  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => acc + getEstimatedForInstance(subId, allTasks, visited), 0);
  }

  return task.estimatedMinutes || 0;
}

export function projectLoad(
  allTasks: Record<string, Task>,
  startDate: string,
  days: number
): Record<string, { totalTime: number, totalTasks: number }> {
  const projection: Record<string, { totalTime: number, totalTasks: number }> = {};
  const start = parseLocalISO(startDate);

  for (let i = 0; i < days; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const dateStr = formatLocalISO(current);
    const totalTime = projectLoadForDay(dateStr, allTasks);

    const totalTasks = Object.values(allTasks).filter(t =>
      t &&
      !t.isDeleted &&
      !t.parentTaskId &&
      !t.isTemplate &&
      t.dueDate === dateStr
    ).length;

    projection[dateStr] = { totalTime, totalTasks };
  }

  return projection;
}

// ─── Time Combo Logic ────────────────────────────────────────────

export function getTaskEstimatedCombo(taskId: string, tasks: Record<string, Task>, visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  const task = tasks[taskId];
  if (!task) return 0;
  
  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => acc + getTaskEstimatedCombo(subId, tasks, visited), 0);
  }
  
  return task.estimatedMinutes || 0;
}

/**
 * Calcula tiempo estimado solo de subtareas PENDIENTES (no completadas)
 */
export function getTaskEstimatedPending(taskId: string, tasks: Record<string, Task>, visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  const task = tasks[taskId];
  if (!task) return 0;
  
  // Si la tarea está completada, no cuenta
  if (task.status === 'completed') return 0;
  
  // Si tiene subtareas, sumar solo las pendientes
  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => acc + getTaskEstimatedPending(subId, tasks, visited), 0);
  }
  
  // Tarea hoja pendiente: devolver su tiempo estimado
  return task.estimatedMinutes || 0;
}

export function getTaskRegisteredSelf(taskId: string, timeEntries: any[]): number {
  if (!taskId || !timeEntries) return 0;
  return timeEntries
    .filter(e => e && ((e.subtaskId === taskId) || (!e.subtaskId && e.taskId === taskId)))
    .reduce((acc, e) => acc + (e.duration || 0), 0);
}

export function getTaskRegisteredCombo(taskId: string, tasks: Record<string, Task>, timeEntries: any[], visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  const task = tasks[taskId];
  if (!task) return 0;

  let total = getTaskRegisteredSelf(taskId, timeEntries);
  if (task.subtasks && task.subtasks.length > 0) {
    total += task.subtasks.reduce((acc, subId) => acc + getTaskRegisteredCombo(subId, tasks, timeEntries, visited), 0);
  }
  return total;
}

export function getTaskEstimatedComboForDay(
  taskId: string, 
  allTasks: Record<string, Task>, 
  generatedInstances: Task[],
  dateStr: string,
  visited = new Set<string>()
): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  const task = allTasks[taskId] || generatedInstances.find(t => t.id === taskId);
  if (!task) return 0;

  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => {
      return acc + getTaskEstimatedComboForDay(subId, allTasks, generatedInstances, dateStr, visited);
    }, 0);
  }

  return task.estimatedMinutes || 0;
}

/**
 * Formatea minutos a formato humano: "2h 30m" o "45m"
 */
export function formatMinutes(minutes: number | undefined): string {
  if (!minutes || minutes === 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Chequea si una tarea es visible (existe, no eliminada)
 * Safety check incluido para proteger contra undefined
 */
export function isTaskVisible(task: Task | undefined): boolean {
  return !!task && !task.isDeleted;
}

/**
 * Chequea si es una instancia visible (no template)
 * Para vistas y stats - NO cuenta templates originales
 */
export function isTaskInstance(task: Task | undefined): boolean {
  return isTaskVisible(task) && !task.isTemplate;
}
