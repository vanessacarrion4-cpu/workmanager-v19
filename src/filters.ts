/**
 * filters.ts
 * 
 * ÚNICA fuente de verdad para el filtrado de tareas.
 * Dashboard, Calendario y cualquier vista futura usan estas funciones.
 * 
 * REGLAS DE FILTRADO (acordadas con Vanessa):
 * - Templates (isTemplate:true) NUNCA aparecen en vistas de día
 * - Subtareas NUNCA aparecen solas (siempre bajo su contenedor padre)
 * - Tareas borradas (isDeleted:true) NUNCA aparecen
 * - Bloques inactivos: sus tareas no aparecen
 * - Delegadas sin tag real (solo 'resto' o sin tags): no aparecen en Dashboard ni Calendario
 * - Contenedor aparece si tiene ≥1 subtarea pendiente ese día
 * - Contenedor desaparece si TODAS sus subtareas están completadas (salvo que hideCompleted=false)
 */

import { Task } from './types';
import { isTaskCompleted } from './utils';

// ─────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────

export type TagType = 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto';

export interface FilterOptions {
  hideCompleted?: boolean;       // Default: true
  hideDelegatedNoTag?: boolean;  // Default: true (Dashboard y Calendario)
}

export interface GroupedTask {
  task: Task;
  subtasksForGroup: string[] | null; // null = tarea simple, array = contenedor con subtareas
}

export interface DayStats {
  total: number;
  completed: number;
  pending: number;
  estimatedPending: number;
  estimatedCompleted: number;
  estimatedTotal: number;
  registered: number;
}

// ─────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────

/**
 * Determina si una subtarea debe mostrarse para un día concreto.
 * Aplica filtros de borrado, fecha, y delegación.
 */
function isSubtaskVisibleForDay(
  sub: Task | undefined,
  activeDate: string,
  options: FilterOptions
): boolean {
  if (!sub) return false;
  if (sub.isDeleted) return false;
  if (sub.dueDate !== activeDate) return false;

  // Filtro delegación: excluir delegadas sin tag real
  if (options.hideDelegatedNoTag && sub.delegation) {
    const tags = sub.tags || [];
    const hasRealTag = tags.some((tag: string) => tag !== 'resto');
    if (!hasRealTag) return false;
  }

  return true;
}

/**
 * Obtiene las subtareas visibles de un contenedor para un día concreto.
 * Maneja tanto contenedores manuales como recurrentes.
 */
function getVisibleSubtasksForDay(
  container: Task,
  allTasksMap: Record<string, Task>,
  activeDate: string,
  options: FilterOptions
): Task[] {
  const containerTemplateId = container.templateId || container.id;

  const seen = new Set<string>();
  return Object.values(allTasksMap).filter((task: Task) => {
    if (task.isDeleted) return false;
    if (task.dueDate !== activeDate) return false;

    // CASO 1: Instancia recurrente - buscar por template
    if (task.templateId) {
      const subtaskTemplate = allTasksMap[task.templateId];
      if (!subtaskTemplate) return false;
      const isChildOfContainer = subtaskTemplate.parentTaskId === containerTemplateId;
      if (!isChildOfContainer) return false;
    } else {
      // CASO 2: Subtarea manual - parentTaskId apunta al contenedor o a su template
      const isDirectChild = task.parentTaskId === container.id || task.parentTaskId === containerTemplateId;
      if (!isDirectChild) return false;
    }

    // Filtro delegación
    if (options.hideDelegatedNoTag && task.delegation) {
      const tags = task.tags || [];
      const hasRealTag = tags.some((tag: string) => tag !== 'resto');
      if (!hasRealTag) return false;
    }

    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  }).sort((a: Task, b: Task) => (a.order ?? 999) - (b.order ?? 999));
}

// ─────────────────────────────────────────────
// FUNCIÓN PRINCIPAL: filterTasksForDay
// ─────────────────────────────────────────────

/**
 * Devuelve las tareas raíz que deben mostrarse para un día concreto.
 * 
 * Una tarea aparece si:
 * - Es una tarea/instancia con dueDate === activeDate
 * - Es un contenedor sin dueDate con ≥1 subtarea pendiente ese día
 * 
 * Nunca aparecen: templates, subtareas solas, borradas, bloques inactivos,
 * delegadas sin tag real (si hideDelegatedNoTag=true)
 */
export function filterTasksForDay(
  tasks: Task[],
  allTasksMap: Record<string, Task>,
  activeBlockIds: Set<string>,
  activeDate: string,
  options: FilterOptions = {}
): Task[] {
  const { hideCompleted = true, hideDelegatedNoTag = true } = options;

  return tasks
    .filter((t: Task) => {
      if (!t) return false;
      if (t.isDeleted) return false;
      if (!activeBlockIds.has(t.blockId)) return false;
      if (t.isTemplate) return false;

      // Subtareas nunca aparecen solas
      if (t.parentTaskId) return false;
      if (t.templateId) {
        const template = allTasksMap[t.templateId];
        if (template && template.parentTaskId) return false;
      }

      // Delegadas sin tag real
      if (hideDelegatedNoTag && t.delegation) {
        const tags = t.tags || [];
        const hasRealTag = tags.some((tag: string) => tag !== 'resto');
        if (!hasRealTag) return false;
      }

      // Tarea con fecha
      if (t.dueDate === activeDate) {
        if (hideCompleted && isTaskCompleted(t.id, allTasksMap)) return false;
        return true;
      }

      // Contenedor sin dueDate propio
      if (!t.dueDate && t.subtasks && t.subtasks.length > 0) {
        const visibleSubs = getVisibleSubtasksForDay(t, allTasksMap, activeDate, { hideDelegatedNoTag });
        if (visibleSubs.length === 0) return false;

        // Si hideCompleted, el contenedor solo aparece si ≥1 subtarea está pendiente
        if (hideCompleted) {
          const hasPending = visibleSubs.some(sub => !isTaskCompleted(sub.id, allTasksMap));
          return hasPending;
        }

        return true;
      }

      return false;
    })
    .sort((a: Task, b: Task) => (a.order || 0) - (b.order || 0));
}

// ─────────────────────────────────────────────
// FUNCIÓN: groupTasksByTag
// ─────────────────────────────────────────────

/**
 * Agrupa las tareas del día por etiqueta (con_hora, focus, dirección, espera, resto).
 * Los contenedores se agrupan según la etiqueta de sus subtareas.
 * Devuelve un Record<TagType, GroupedTask[]>
 */
export function groupTasksByTag(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  activeDate: string,
  options: FilterOptions = {}
): Record<TagType, GroupedTask[]> {
  const { hideCompleted = true, hideDelegatedNoTag = true } = options;

  const groups: Record<TagType, GroupedTask[]> = {
    con_hora: [],
    focus: [],
    dirección: [],
    espera: [],
    resto: []
  };

  dayTasks.forEach((t: Task) => {
    const isContainer = !!(t.subtasks && t.subtasks.length > 0);

    if (isContainer) {
      // Obtener subtareas visibles del día
      const allVisibleSubs = getVisibleSubtasksForDay(t, allTasksMap, activeDate, { hideDelegatedNoTag });

      // Filtrar completadas si hideCompleted
      const subsToShow = hideCompleted
        ? allVisibleSubs.filter(sub => !isTaskCompleted(sub.id, allTasksMap))
        : allVisibleSubs;

      if (subsToShow.length === 0) return; // Contenedor sin subtareas visibles → no mostrar

      // Agrupar subtareas por tag
      const subtasksByTag: Record<string, string[]> = {};
      subsToShow.forEach((sub: Task) => {
        const subTag = (sub.tags && sub.tags[0]) || 'resto';
        if (!subtasksByTag[subTag]) subtasksByTag[subTag] = [];
        subtasksByTag[subTag].push(sub.id);
      });

      // Añadir el contenedor a cada grupo donde tenga subtareas
      Object.entries(subtasksByTag).forEach(([tag, subIds]) => {
        const targetTag = (tag as TagType) in groups ? (tag as TagType) : 'resto';
        groups[targetTag].push({ task: t, subtasksForGroup: subIds });
      });

    } else {
      // Tarea simple
      const primaryTag = (t.tags && t.tags[0]) || 'resto';
      const targetTag = (primaryTag as TagType) in groups ? (primaryTag as TagType) : 'resto';
      groups[targetTag].push({ task: t, subtasksForGroup: null });
    }
  });

  return groups;
}

// ─────────────────────────────────────────────
// FUNCIÓN: getStatsForDay
// ─────────────────────────────────────────────

/**
 * Calcula las estadísticas del día (tareas, tiempo estimado, registrado).
 * Usa dayTasks (ya filtradas) y cuenta las subtareas hoja.
 */
export function getStatsForDay(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  timeEntries: any[],
  activeDate: string
): DayStats {
  const leafTasks: Task[] = [];

  dayTasks.forEach((t: Task) => {
    if (!t.subtasks || t.subtasks.length === 0) {
      leafTasks.push(t);
    } else {
      // Contenedor: contar subtareas del día
      const containerTemplateId = t.templateId || t.id;
      Object.values(allTasksMap).forEach((sub: Task) => {
        if (sub.isDeleted) return;
        if (sub.dueDate !== activeDate) return;

        if (sub.templateId) {
          const subTemplate = allTasksMap[sub.templateId];
          if (!subTemplate || subTemplate.parentTaskId !== containerTemplateId) return;
        } else {
          if (sub.parentTaskId !== t.id && sub.parentTaskId !== containerTemplateId) return;
        }

        leafTasks.push(sub);
      });
    }
  });

  const completedTasks = leafTasks.filter(t => isTaskCompleted(t.id, allTasksMap));
  const pendingTasks = leafTasks.filter(t => !isTaskCompleted(t.id, allTasksMap));

  const estimatedTotal = leafTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const estimatedCompleted = completedTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const estimatedPending = pendingTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);

  const registered = timeEntries
    .filter(e => e && e.date === activeDate)
    .reduce((acc, e) => acc + (e.duration || 0), 0);

  return {
    total: leafTasks.length,
    completed: completedTasks.length,
    pending: pendingTasks.length,
    estimatedTotal,
    estimatedCompleted,
    estimatedPending,
    registered
  };
}
