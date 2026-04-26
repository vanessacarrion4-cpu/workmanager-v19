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
  const templates = Object.values(allTasks).filter(t => t && !t.parentTaskId && t.isActive !== false && isTaskRepetitive(t.id, allTasks));
  
  // Predictable parsing of YYYY-MM-DD as local
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

      // Determine if parent should appear today
      const recurringChildrenToday = children.filter(c => c.recurrence && matchesRecurrence(c.recurrence, current));
      const parentMatchesToday = parentTemplate.recurrence && matchesRecurrence(parentTemplate.recurrence, current);
      const nonRecurringForceToday = children.filter(c => !c.recurrence && c.dueDate === dateStr);
      
      const shouldAppear = parentMatchesToday || recurringChildrenToday.length > 0 || nonRecurringForceToday.length > 0;
      
      if (shouldAppear) {
        const parentInstanceId = `inst-${parentTemplate.id}-${dateStr}`;
        if (allTasks[parentInstanceId]) return;

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
          status: 'pending' 
        };

        newInstances.push(parentInstance, ...subtasksToCreate);
      }
    });
  }

  return newInstances;
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

    // Get instances for this day (already in state or virtual)
    // For simplicity, we'll re-run generateInstances for just this day
    const instances = generateInstances(allTasks, dateStr, 1);
    
    // Combine with real tasks in state for that day
    const dayTasks = Object.values(allTasks).filter(t => t.dueDate === dateStr && !t.parentTaskId && !t.isTemplate);
    
    // Count unique parents
    const uniqueParents = new Set([
      ...dayTasks.map(t => t.id),
      ...instances.filter(t => !t.parentTaskId).map(t => t.id)
    ]);

    let totalTime = 0;
    uniqueParents.forEach(pid => {
      // Find the task (either from state or freshly generated)
      const task = allTasks[pid] || instances.find(inst => inst.id === pid);
      if (task) {
        // We need a helper that calculates estimated time specifically for a day's visible subtasks
        totalTime += getTaskEstimatedComboForDay(task.id, allTasks, instances, dateStr);
      }
    });

    projection[dateStr] = { totalTime, totalTasks: uniqueParents.size };
  }

  return projection;
}

export function projectLoadForDay(
  dateStr: string,
  allTasks: Record<string, Task>
): number {
  const result = projectLoad(allTasks, dateStr, 1);
  return result[dateStr]?.totalTime || 0;
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

/**
 * Calculates estimated time for a specific day instance
 */
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
