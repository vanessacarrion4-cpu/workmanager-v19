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
  // CRÍTICO: Solo procesar templates REALES (isTemplate:true, sin templateId propio)
  // Excluir instancias generadas (tienen templateId) para evitar inst-inst-... y bucles
  const templates = Object.values(allTasks).filter(t => 
    t && 
    !t.parentTaskId && 
    t.isActive !== false && 
    t.isTemplate === true &&      // Solo templates reales
    !t.templateId &&              // Nunca instancias
    !t.isDeleted &&               // Nunca borrados
    isTaskRepetitive(t.id, allTasks)
  );
  
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
      
      // Detectar si hay excepciones de subtareas movidas a este día
      // (instanceDate diferente de dateStr, pero due_date === dateStr)
      const hasMovedExceptionsToday = children.some(c =>
        Object.values(allTasks).some(t =>
          t.templateId === c.id &&
          t.isException &&
          t.dueDate === dateStr &&
          !t.isDeleted
        )
      );
      
      const shouldAppear = parentMatchesToday || recurringChildrenToday.length > 0 || nonRecurringForceToday.length > 0 || hasMovedExceptionsToday;
      
      if (shouldAppear) {
        const parentInstanceId = `inst-${parentTemplate.id}-${dateStr}`;
        
        // No regenerar si ya existe (incluyendo excepciones con fecha cambiada)
        if (allTasks[parentInstanceId]) {
          // Si el contenedor ya existe (excepción guardada) pero sin subtareas,
          // generar las subtareas que faltan y vincularlas
          const existingContainer = allTasks[parentInstanceId];
          if (existingContainer && (!existingContainer.subtasks || existingContainer.subtasks.length === 0)) {
            children.forEach(childTemplate => {
              if (childTemplate.recurrence && !matchesRecurrence(childTemplate.recurrence, current)) return;
              if (!childTemplate.recurrence && childTemplate.dueDate && childTemplate.dueDate !== dateStr) return;
              if (!childTemplate.recurrence && childTemplate.status === 'completed') return;

              const childInstanceId = `inst-${childTemplate.id}-${dateStr}`;
              if (allTasks[childInstanceId]) return; // Ya existe

              const childInstance: Task = {
                ...childTemplate,
                id: childInstanceId,
                templateId: childTemplate.id,
                parentTaskId: parentInstanceId,
                dueDate: dateStr,
                instanceDate: dateStr,
                isTemplate: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                status: 'pending',
                subtasks: []
              };
              newInstances.push(childInstance);
            });
          }
          return;
        }
        
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
          const existingChild = allTasks[childInstanceId];
          
          if (existingChild) {
            // Si la instancia existe pero fue movida a otro día (excepción con due_date diferente),
            // NO incluirla en el contenedor de este día - ella aparecerá en su nuevo día
            if (existingChild.isException && existingChild.dueDate !== dateStr) return;
            subtaskInstanceIds.push(childInstanceId);
            return;
          }
          
          // Buscar si hay una excepción de este hijo que fue movida a este día (dateStr)
          // (instanceDate diferente, pero due_date === dateStr)
          const movedExceptionToday = Object.values(allTasks).find(t =>
            t.templateId === childTemplate.id &&
            t.isException &&
            t.dueDate === dateStr &&
            !t.isDeleted
          );
          if (movedExceptionToday) {
            subtaskInstanceIds.push(movedExceptionToday.id);
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

        // Si el contenedor padre tiene subtareas definidas pero ninguna aplica para hoy
        // (todas fueron movidas a otro día), no crear el contenedor vacío
        if (children.length > 0 && subtaskInstanceIds.length === 0 && subtasksToCreate.length === 0) return;

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

/**
 * Calcula la carga de un día usando las instancias ya generadas en el estado.
 * CORREGIDO: usa instancias del día, no plantillas.
 */
export function projectLoadForDay(
  dateStr: string,
  allTasks: Record<string, Task>
): number {
  // IMPORTANTE: solo usar plantillas para generar instancias del día
  // Evita que instancias editadas de otros días contaminen el cálculo
  const templatesOnly = Object.fromEntries(
    Object.entries(allTasks).filter(([, t]) => !t.templateId)
  );

  // Tareas manuales (no plantillas, no instancias recurrentes) del día
  const manualTasks = Object.values(allTasks).filter(t =>
    t.dueDate === dateStr &&
    !t.parentTaskId &&
    !t.isTemplate &&
    !t.templateId &&
    !t.isDeleted
  );

  // Generar instancias limpias del día con solo plantillas
  const generatedInstances = generateInstances(templatesOnly, dateStr, 1);
  const generatedParents = generatedInstances.filter(t => !t.parentTaskId);

  // Mapa solo con instancias generadas (limpias)
  const combinedMap: Record<string, Task> = {};
  generatedInstances.forEach(t => { combinedMap[t.id] = t; });

  let totalTime = 0;

  // Sumar instancias generadas
  generatedParents.forEach(parent => {
    totalTime += getEstimatedForInstance(parent.id, combinedMap);
  });

  // Sumar tareas manuales del día
  manualTasks.forEach(task => {
    totalTime += task.estimatedMinutes || 0;
  });

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

    const dayTasks = Object.values(allTasks).filter(t => 
      t.dueDate === dateStr && !t.parentTaskId && !t.isTemplate && !t.isDeleted
    );
    const instances = generateInstances(allTasks, dateStr, 1);
    const uniqueParents = new Set([
      ...dayTasks.map(t => t.id),
      ...instances.filter(t => !t.parentTaskId).map(t => t.id)
    ]);

    projection[dateStr] = { totalTime, totalTasks: uniqueParents.size };
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

export function getTaskEstimatedPending(taskId: string, tasks: Record<string, Task>, visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);
  const task = tasks[taskId];
  if (!task) return 0;
  
  // Si está completada, no suma
  if (task.status === 'completed') return 0;
  
  if (task.subtasks && task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subId) => acc + getTaskEstimatedPending(subId, tasks, visited), 0);
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

export function formatMinutes(mins: number): string {
  if (mins === 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
