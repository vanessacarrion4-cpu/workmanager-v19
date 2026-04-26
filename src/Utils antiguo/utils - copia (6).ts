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

function matchesRecurrence(recurrence: any, date: Date): boolean {
  if (!recurrence) return false;
  
  const dateStr = formatLocalISO(date);
  if (dateStr < (recurrence.startDate || '')) return false;
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;

  const jsDay = date.getDay();
  const specDay = (jsDay + 6) % 7; // 0=lunes...6=domingo
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
    default:
      return false;
  }
}

export function isTaskRepetitive(taskId: string, allTasks: Record<string, Task>, visited = new Set<string>()): boolean {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const task = allTasks[taskId];
  if (!task) return false;
  if (task.recurrence) return true;
  if (task.isTemplate) return true;
  if (!task.subtasks || task.subtasks.length === 0) return false;
  return task.subtasks.some(id => isTaskRepetitive(id, allTasks, visited));
}

/**
 * Generates tasks for a given date range based on the new "Subtask Recurrence" architecture.
 */
export function generateInstances(
  allTasks: Record<string, Task> = {},
  startDateStr: string,
  daysToProject: number
): Task[] {
  if (!allTasks) return [];
  const newInstances: Task[] = [];
  // Solo templates originales: nunca instancias (templateId presente) ni excepciones
  const templates = Object.values(allTasks).filter(t => t && !t.parentTaskId && !t.templateId && t.isActive !== false && isTaskRepetitive(t.id, allTasks));
  
  const startDate = parseLocalISO(startDateStr);
  
  for (let d = 0; d < daysToProject; d++) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + d);
    const dateStr = formatLocalISO(current);
    const timestamp = new Date().toISOString();

    templates.forEach(parentTemplate => {
      if (!parentTemplate) return;
      const children = (parentTemplate.subtasks || [])
        .map(id => allTasks[id])
        .filter(Boolean);

      const recurringChildrenToday = children.filter(c => c.recurrence && matchesRecurrence(c.recurrence, current));
      const parentMatchesToday = parentTemplate.recurrence && matchesRecurrence(parentTemplate.recurrence, current);
      const nonRecurringForceToday = children.filter(c => !c.recurrence && c.dueDate === dateStr);
      
      const shouldAppear = parentMatchesToday || recurringChildrenToday.length > 0 || nonRecurringForceToday.length > 0;
      
      if (shouldAppear) {
        const parentInstanceId = `inst-${parentTemplate.id}-${dateStr}`;
        
        // No regenerar si ya existe (incluyendo excepciones con fecha cambiada)
        if (allTasks[parentInstanceId]) return;
        
        // No regenerar si ya hay una excepción para este template en este día
        const hasException = Object.values(allTasks).some(t => 
          t && t.templateId === parentTemplate.id && 
          t.instanceDate === dateStr && 
          t.isException
        );
        if (hasException) return;

        const subtaskInstanceIds: string[] = [];
        const subtasksToCreate: Task[] = [];

        children.forEach(childTemplate => {
          if (childTemplate.recurrence && !matchesRecurrence(childTemplate.recurrence, current)) return;
          if (!childTemplate.recurrence && childTemplate.dueDate && childTemplate.dueDate !== dateStr) return;
          if (!childTemplate.recurrence && childTemplate.status === 'completed') return;

          const childInstanceId = `inst-${childTemplate.id}-${dateStr}`;
          if (allTasks[childInstanceId]) {
            subtaskInstanceIds.push(childInstanceId);
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
            createdAt: timestamp,
            modifiedAt: timestamp,
            status: 'pending',
            subtasks: []
          };
          
          subtasksToCreate.push(childInstance);
          subtaskInstanceIds.push(childInstanceId);
        });

        const parentInstance: Task = {
          ...parentTemplate,
          id: parentInstanceId,
          templateId: parentTemplate.id,
          dueDate: dateStr,
          instanceDate: dateStr,
          isTemplate: false,
          createdAt: timestamp,
          modifiedAt: timestamp,
          subtasks: subtaskInstanceIds,
          status: 'pending',
          tags: [] // El padre contenedor nunca tiene tags propias, las tags son de las subtareas
        };

        newInstances.push(parentInstance, ...subtasksToCreate);
      }
    });
  }

  return newInstances;
}

/**
 * Calcula la carga de un día usando las instancias ya en estado + recalculando
 * desde templates solo para tareas simples recurrentes (sin subtareas).
 * 
 * Estrategia:
 * - Instancias ya generadas en allTasks (templateId presente): usar directamente
 * - Tareas manuales del día (sin templateId, sin isTemplate): sumar directamente
 * - NO regenerar desde templates para evitar doble conteo
 */
export function projectLoadForDay(
  dateStr: string,
  allTasks: Record<string, Task>
): number {
  let totalTime = 0;
  const counted = new Set<string>();

  const tasksArray = Object.values(allTasks);

  for (const t of tasksArray) {
    if (!t || t.isDeleted) continue;
    if (t.parentTaskId) continue;       // subtareas: se suman via su padre
    if (t.dueDate !== dateStr) continue; // solo del día

    // Templates originales nunca cuentan directamente (isTemplate=true o recurrence sin templateId)
    if (t.isTemplate) continue;
    if (!t.templateId && t.recurrence) continue; // template de recurrencia, no instancia

    const id = t.id;
    if (counted.has(id)) continue;
    counted.add(id);

    // Instancia generada o tarea manual: sumar su tiempo estimado
    totalTime += getEstimatedForInstance(id, allTasks);
  }

  return totalTime;
}

/**
 * Calcula el tiempo estimado de una instancia (ya generada, no plantilla).
 * Solo suma subtareas instanciadas del mismo día.
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

  // Si tiene subtareas instanciadas, sumar solo las que existen en el mapa
  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => {
      return acc + getEstimatedForInstance(subId, allTasks, visited);
    }, 0);
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

    // Contar tareas raíz visibles del día: instancias generadas + manuales, sin templates
    const totalTasks = Object.values(allTasks).filter(t =>
      t &&
      !t.isDeleted &&
      !t.parentTaskId &&
      !t.isTemplate &&
      !((!t.templateId) && t.recurrence) && // excluir templates de recurrencia
      t.dueDate === dateStr
    ).length;

    projection[dateStr] = { totalTime, totalTasks };
  }

  return projection;
}

// --- Time Combo Logic ---

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
