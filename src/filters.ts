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
import { isTaskCompleted, isExpiredTemplate } from './utils';
import { belongsToDay } from './instanceEngine'; // FASE 3: única definición de "pertenece a un día"

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
  // TRAMO 1 (cabecera): desglose del ESTIMADO PENDIENTE (lo que queda) — por tipo y por bloque.
  byType: { core: number; adhoc: number };
  byBlock: Array<{ blockId: string; minutes: number }>;
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
    if (!belongsToDay(task, activeDate)) return false; // FASE 3: función compartida (antes: task.dueDate !== activeDate)

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
      
      // Si el contenedor es una instancia (tiene templateId), excluir subtareas manuales
      // que apuntan al template EXCEPTO si tienen dueDate (son subtareas creadas manualmente ese día)
      if (container.templateId && task.parentTaskId === containerTemplateId && !task.templateId) {
        if (!task.dueDate) return false; // sin fecha → pertenece al template, no a esta instancia
        // con fecha === activeDate → subtarea manual creada desde el Dashboard, sí mostrar
      }
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

/**
 * getVisibleSubtasksForBloques — hijas a PINTAR de un contenedor en la vista BLOQUES (regla canónica §16.13,
 * fijada por la usuaria, sesión 19). Deja de pintar `task.subtasks` crudo (que traía TODAS las instancias).
 *
 * - **Contenedor NORMAL:** subtareas PENDIENTES; las COMPLETADAS solo si `showCompleted` (a petición, por contenedor).
 * - **Contenedor RECURRENTE** (es plantilla o aloja reglas): la PLANTILLA/regla (hijas `isTemplate`) + las instancias
 *   MODIFICADAS que sigan PENDIENTES (`templateId + isException + !completed`) + hijas MANUALES pendientes. Las
 *   ocurrencias completadas históricas NO (se consultan por el icono de información).
 *
 * Ordena por `order`. Puro. `hiddenCompletedCount` (abajo) da el nº para el "ver completadas (N)".
 */
export function getVisibleSubtasksForBloques(
  container: Task,
  allTasksMap: Record<string, Task>,
  showCompleted: boolean = false
): string[] {
  const childIds = container.subtasks || [];
  const isRecurring = !!container.isTemplate || childIds.some((id) => {
    const c = allTasksMap[id];
    return !!c && (c.isTemplate || !!c.recurrence);
  });
  const out: string[] = [];
  for (const id of childIds) {
    const c = allTasksMap[id];
    if (!c || c.isDeleted) continue;
    if (isRecurring) {
      if (c.isTemplate) { out.push(id); continue; }                 // la regla/plantilla hija
      if (c.templateId) {                                            // instancia
        if (c.isException && c.status !== 'completed') out.push(id); // modificada + pendiente
        continue;                                                    // completada histórica / virgen → fuera
      }
      // hija MANUAL de un contenedor recurrente (mixto): pendiente sí; completada a petición
      if (c.status !== 'completed') out.push(id);
      else if (showCompleted) out.push(id);
    } else {
      if (c.status !== 'completed') out.push(id);                    // normal: pendiente
      else if (showCompleted) out.push(id);                         // completada a petición
    }
  }
  return out.sort((a, b) => ((allTasksMap[a]?.order ?? 999) - (allTasksMap[b]?.order ?? 999)));
}

/**
 * #1 (sesión 26): estimado de un CONTENEDOR en BLOQUES = suma del estimado de las hijas que la LISTA MUESTRA
 * (`getVisibleSubtasksForBloques` + sin finalizadas), recursivo. Antes se usaba `getTaskEstimatedCombo` (TODO el
 * subárbol, incluidas las hijas FINALIZADAS/expiradas que la lista OCULTA) → el total no cuadraba con las filas
 * visibles (el "2h10m con las hijas a 0m" de la propietaria). Un contenedor mide lo que muestra debajo. F6-x3: en
 * Bloques (DEFINICIÓN) el conjunto es COMPLETO (todas las hijas visibles, no un día), no acotado a una fecha.
 */
export function containerEstimatedForBloques(
  container: Task, allTasksMap: Record<string, Task>, showCompleted: boolean, todayISO: string,
): number {
  let total = 0;
  for (const id of getVisibleSubtasksForBloques(container, allTasksMap, showCompleted)) {
    const c = allTasksMap[id];
    if (!c || isExpiredTemplate(c, todayISO)) continue; // dropExpired (igual que renderChildIds)
    if (c.subtasks && c.subtasks.length > 0) total += containerEstimatedForBloques(c, allTasksMap, showCompleted, todayISO);
    else total += c.estimatedMinutes || 0;
  }
  return total;
}

/**
 * Nº de hijas COMPLETADAS ocultas de un contenedor en Bloques (para el "ver completadas (N)"). Solo cuenta las
 * que el "ver completadas" REVELARÍA: en normal, las completadas; en recurrente, las MANUALES completadas (las
 * ocurrencias históricas van por el icono de info, no por este toggle).
 */
export function hiddenCompletedCountForBloques(container: Task, allTasksMap: Record<string, Task>): number {
  const visible = new Set(getVisibleSubtasksForBloques(container, allTasksMap, true));
  const shown = new Set(getVisibleSubtasksForBloques(container, allTasksMap, false));
  let n = 0;
  for (const id of visible) if (!shown.has(id)) n++;
  return n;
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

        // Siempre verificar que haya ≥1 subtarea pendiente HOY (independiente de hideCompleted)
        // Los contenedores con todas subtareas completadas no cuentan en stats
        const hasPending = visibleSubs.some(sub => !isTaskCompleted(sub.id, allTasksMap));
        if (hideCompleted && !hasPending) return false;

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
  const seenIds = new Set<string>();

  const addLeaf = (task: Task) => {
    if (seenIds.has(task.id)) return;
    seenIds.add(task.id);
    leafTasks.push(task);
  };

  dayTasks.forEach((t: Task) => {
    if (!t.subtasks || t.subtasks.length === 0) {
      // Tarea simple: solo contar si es de hoy
      if (t.dueDate === activeDate) addLeaf(t);
    } else {
      // Contenedor: solo contar sus subtareas hoja de hoy
      const visibleSubs = getVisibleSubtasksForDay(t, allTasksMap, activeDate, { hideDelegatedNoTag: true });
      visibleSubs.forEach((sub: Task) => {
        if (!sub.subtasks || sub.subtasks.length === 0) {
          addLeaf(sub);
        }
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

  // Desglose del ESTIMADO PENDIENTE (mismo conjunto que estimatedPending): por tipo (core/ad-hoc) y por bloque.
  const byType = { core: 0, adhoc: 0 };
  const blockMap = new Map<string, number>();
  pendingTasks.forEach(t => {
    const est = t.estimatedMinutes || 0;
    if (est <= 0) return;
    if (t.taskType === 'adhoc') byType.adhoc += est; else byType.core += est;
    blockMap.set(t.blockId, (blockMap.get(t.blockId) || 0) + est);
  });
  const byBlock = Array.from(blockMap.entries())
    .map(([blockId, minutes]) => ({ blockId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    total: leafTasks.length,
    completed: completedTasks.length,
    pending: pendingTasks.length,
    estimatedTotal,
    estimatedCompleted,
    estimatedPending,
    registered,
    byType,
    byBlock,
  };
}
