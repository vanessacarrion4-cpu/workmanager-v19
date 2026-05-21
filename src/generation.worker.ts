/**
 * generation.worker.ts
 * 
 * Web Worker que ejecuta generateInstances en un hilo separado.
 * Nunca bloquea la UI principal.
 * 
 * Recibe: { tasks, startDateStr, daysToProject }
 * Devuelve: { instances: Task[] }
 */

// ─────────────────────────────────────────────
// Tipos mínimos necesarios (sin imports de React)
// ─────────────────────────────────────────────

interface Task {
  id: string;
  blockId: string;
  templateId?: string;
  instanceDate?: string;
  title: string;
  notes?: string;
  priority: string;
  parentTaskId?: string | null;
  subtasks?: string[];
  status: string;
  completedAt?: string | null;
  dueDate: string | null;
  dueTime?: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  totalEstimatedCombo?: number;
  totalRegisteredCombo?: number;
  tags: string[];
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string | null;
  isTemplate?: boolean;
  isActive?: boolean;
  isException?: boolean;
  isDeleted?: boolean;
  wasRecurring?: boolean;
  recurrence?: {
    frequency: string;
    weekDays?: number[];
    monthDay?: number;
    startDate: string;
    endDate?: string | null;
  };
  attachments?: any[];
  isExpanded?: boolean;
  taskType?: string;
  delegation?: any;
}

// ─────────────────────────────────────────────
// dateUtils (copiado para no depender de imports)
// ─────────────────────────────────────────────

function formatLocalISO(date: Date): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalISO(dateStr: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

// ─────────────────────────────────────────────
// matchesRecurrence (copiado de utils.ts)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// isTaskRepetitive (copiado de utils.ts)
// ─────────────────────────────────────────────

function isTaskRepetitive(taskId: string, allTasks: Record<string, Task>, visited = new Set<string>()): boolean {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const task = allTasks[taskId];
  if (!task) return false;
  if (task.recurrence) return true;
  if (task.isTemplate) return true;
  if (!task.subtasks || task.subtasks.length === 0) return false;
  return task.subtasks.some(id => isTaskRepetitive(id, allTasks, visited));
}

// ─────────────────────────────────────────────
// generateInstances (copiado de utils.ts)
// ─────────────────────────────────────────────

function generateInstances(
  allTasks: Record<string, Task> = {},
  startDateStr: string,
  daysToProject: number
): Task[] {
  if (!allTasks) return [];
  const newInstances: Task[] = [];

  const templates = Object.values(allTasks).filter(t =>
    t &&
    !t.parentTaskId &&
    t.isActive !== false &&
    t.isTemplate === true &&
    !t.templateId &&
    !t.isDeleted &&
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
        .filter(Boolean) as Task[];

      const recurringChildrenToday = children.filter(c => c.recurrence && matchesRecurrence(c.recurrence, current));
      const parentMatchesToday = parentTemplate.recurrence && matchesRecurrence(parentTemplate.recurrence, current);
      const nonRecurringForceToday = children.filter(c => !c.recurrence && c.dueDate === dateStr);

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

        if (allTasks[parentInstanceId]) {
          const existingContainer = allTasks[parentInstanceId];
          if (existingContainer && (!existingContainer.subtasks || existingContainer.subtasks.length === 0)) {
            children.forEach(childTemplate => {
              if (childTemplate.recurrence && !matchesRecurrence(childTemplate.recurrence, current)) return;
              if (!childTemplate.recurrence && childTemplate.dueDate && childTemplate.dueDate !== dateStr) return;
              if (!childTemplate.recurrence && childTemplate.status === 'completed') return;

              const childInstanceId = `inst-${childTemplate.id}-${dateStr}`;
              if (allTasks[childInstanceId]) return;

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
            if (existingChild.isException && existingChild.dueDate !== dateStr) return;
            subtaskInstanceIds.push(childInstanceId);
            return;
          }

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

// ─────────────────────────────────────────────
// Handler del Worker
// ─────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const { tasks, startDateStr, daysToProject } = e.data;
  try {
    const instances = generateInstances(tasks, startDateStr, daysToProject);
    self.postMessage({ instances, error: null });
  } catch (err: any) {
    self.postMessage({ instances: [], error: err.message });
  }
};
