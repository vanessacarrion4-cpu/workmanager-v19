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
import { isTaskCompleted, isExpiredTemplate, formatMinutes, getTaskRegisteredSelf } from './utils';
import { belongsToDay, materializeDay } from './instanceEngine'; // FASE 3: única definición de "pertenece a un día"
import { reconcileDay } from './fase3Contracts'; // §16.98 CÁLCULO CANÓNICO: única fuente del día (reconcileDay = materializeDay + overlay)

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
  byTag: Array<{ tag: string; minutes: number }>; // por ETIQUETA (tags[0]) — resume lo que Mi Día tiene agrupado debajo
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
// Hojas del día (tareas simples de hoy + subtareas hoja de los contenedores). Única definición, compartida por
// getStatsForDay (cabecera) y getReportBreakdown (reporte) para que midan sobre el MISMO conjunto.
export function collectLeafTasks(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): Task[] {
  const leafTasks: Task[] = [];
  const seenIds = new Set<string>();
  const addLeaf = (task: Task) => {
    if (seenIds.has(task.id)) return;
    seenIds.add(task.id);
    leafTasks.push(task);
  };
  dayTasks.forEach((t: Task) => {
    if (!t.subtasks || t.subtasks.length === 0) {
      if (t.dueDate === activeDate) addLeaf(t); // tarea simple: solo si es de hoy
    } else {
      const visibleSubs = getVisibleSubtasksForDay(t, allTasksMap, activeDate, { hideDelegatedNoTag: true });
      visibleSubs.forEach((sub: Task) => {
        if (!sub.subtasks || sub.subtasks.length === 0) addLeaf(sub);
      });
    }
  });
  return leafTasks;
}

// FASE 6 (cierre del día): hojas PENDIENTES del día (para el "Repaso de lo no hecho"). Mismo conjunto que la cabecera.
export function getPendingLeavesForDay(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): Task[] {
  return collectLeafTasks(dayTasks, allTasksMap, activeDate).filter(t => !isTaskCompleted(t.id, allTasksMap));
}

// FASE 6 (cierre del día): carga PENDIENTE estimada de un día CUALQUIERA (para el impacto de "pasar a otro día" — ver lo que
// ya hay ese día antes de soltar). Materializa el día al vuelo (no hace falta que sea el activeDate).
export function getDayLoad(dayISO: string, allTasks: Record<string, Task>): { minutes: number; count: number } {
  const instances = materializeDay(dayISO, allTasks);
  const manual = (Object.values(allTasks) as Task[]).filter(
    t => t && !t.isTemplate && !t.templateId && !t.parentTaskId && t.dueDate === dayISO && !t.isDeleted
  );
  const dayList = [...instances, ...manual];
  const map: Record<string, Task> = {};
  dayList.forEach(t => { map[t.id] = t; });
  let minutes = 0, count = 0;
  const seen = new Set<string>();
  const addLeaf = (t: Task) => {
    if (!t || seen.has(t.id) || t.status === 'completed') return;
    seen.add(t.id); minutes += t.estimatedMinutes || 0; count++;
  };
  dayList.filter(t => !t.parentTaskId).forEach(t => {
    if (!t.subtasks || t.subtasks.length === 0) addLeaf(t);
    else t.subtasks.forEach(sid => { const s = map[sid]; if (s && !s.isDeleted && (!s.subtasks || s.subtasks.length === 0)) addLeaf(s); });
  });
  return { minutes, count };
}

export function getStatsForDay(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  timeEntries: any[],
  activeDate: string
): DayStats {
  const leafTasks = collectLeafTasks(dayTasks, allTasksMap, activeDate);

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
  const tagMap = new Map<string, number>();
  pendingTasks.forEach(t => {
    const est = t.estimatedMinutes || 0;
    if (est <= 0) return;
    if (t.taskType === 'core') byType.core += est; else byType.adhoc += est; // #6: sin tipo → adhoc (regla única)
    blockMap.set(t.blockId, (blockMap.get(t.blockId) || 0) + est);
    // etiqueta primaria = misma que usa groupTasksByTag para colocar la tarea en Mi Día
    const tag = (t.tags && t.tags[0]) || 'resto';
    tagMap.set(tag, (tagMap.get(tag) || 0) + est);
  });
  const byBlock = Array.from(blockMap.entries())
    .map(([blockId, minutes]) => ({ blockId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  const byTag = Array.from(tagMap.entries())
    .map(([tag, minutes]) => ({ tag, minutes }))
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
    byTag,
  };
}

// ─────────────────────────────────────────────
// FUNCIÓN: getCanonicalDayView — §16.98 CÁLCULO CANÓNICO
// ─────────────────────────────────────────────
// ÚNICA función que calcula "el día" (tareas + tiempo). Ninguna vista calcula por su cuenta — mismo principio que
// bulkEffectiveIds para el alcance. Fuente = reconcileDay (materializeDay + OVERLAY de estado) → ve TODO: recurrentes,
// excepciones, manuales, y las subtareas de contenedores MANUALES (§16.94, que materializeDay solo no veía). Acepta la
// FECHA como parámetro (no asume hoy) — lo necesita el cierre en diferido. Mi Día ya usaba exactamente este pipeline;
// aquí se extrae para que Semana, Carga, reporte y repaso midan LO MISMO. Devuelve el mapa del día + las hojas filtradas
// + los stats (getStatsForDay), para que cada consumidor tome lo que necesite sin recalcular.
// §16.99: ENRIQUECER el mapa del día con las subtareas MANUALES (creadas desde el Dashboard, con dueDate===date).
// getVisibleSubtasksForDay ESCANEA el mapa entero buscando hijas del contenedor (no lee container.subtasks), así que
// esas subtareas deben ESTAR en el mapa o no se cuentan. Mi Día ya lo hacía inline (dashboardTasksMap); se extrae aquí
// para que Mi Día Y el canónico usen LA MISMA construcción (era el desfase Semana 8h6m vs Mi Día 12h6m). Lógica idéntica
// a la de App.tsx para que Mi Día quede byte a byte igual.
export function enrichMapWithManualSubtasks(
  baseMap: Record<string, Task>,
  dayTasks: Task[],
  allTasks: Record<string, Task>,
  date: string
): Record<string, Task> {
  const map: Record<string, Task> = { ...baseMap };
  dayTasks.forEach(t => {
    map[t.id] = t;
    // subtareas de este contenedor/instancia con dueDate===date
    if (t.subtasks && t.subtasks.length > 0) {
      t.subtasks.forEach(subId => {
        const sub = allTasks[subId];
        if (sub && sub.dueDate === date) {
          if (sub.delegation) {
            const hasRealTag = (sub.tags || []).some((tag: string) => tag !== 'resto');
            if (!hasRealTag) return;
          }
          map[subId] = sub;
        }
      });
    }
    // subtareas manuales del TEMPLATE con dueDate===date (no instancias recurrentes)
    const templateId = t.templateId || (t.id.startsWith('inst-') ? t.id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') : t.id);
    const tmpl = templateId ? allTasks[templateId] : null;
    if (tmpl?.subtasks) {
      tmpl.subtasks.forEach((subId: string) => {
        const sub = allTasks[subId];
        if (sub && !sub.isDeleted && sub.dueDate === date && !sub.templateId && !subId.startsWith('inst-')) {
          map[subId] = sub;
        }
      });
    }
  });
  return map;
}

export function getCanonicalDayView(
  date: string,
  allTasks: Record<string, Task>,
  activeBlockIds: Set<string>,
  timeEntries: any[] = [],
  opts: { hideCompleted?: boolean } = {}
): { dayMap: Record<string, Task>; dayTasks: Task[]; stats: DayStats } {
  const baseMap = reconcileDay(date, allTasks);
  const candidates = Object.values(baseMap).filter(t => t && !t.isDeleted && !t.isTemplate) as Task[];
  const dayTasks = filterTasksForDay(candidates, baseMap, activeBlockIds, date, {
    hideCompleted: opts.hideCompleted ?? false,
    hideDelegatedNoTag: true,
  });
  // §16.99: mismo mapa enriquecido que Mi Día (si no, getStatsForDay no ve las subtareas manuales → cuenta de menos).
  const dayMap = enrichMapWithManualSubtasks(baseMap, dayTasks, allTasks, date);
  const stats = getStatsForDay(dayTasks, dayMap, timeEntries, date);
  return { dayMap, dayTasks, stats };
}

// ─────────────────────────────────────────────
// TRAMO 2 · ENTRADA DEL DÍA — "qué entró el día que miro"
// ─────────────────────────────────────────────
// Cuenta cada tarea REAL (no template, no borrada, no instancia recurrente) cuya fecha de CREACIÓN local coincide con el
// día visto. Fuente = mapa COMPLETO de tareas (no el day-scoped), porque algo creado hoy puede vencer en otra fecha.
// DECISIONES (aprobadas por la propietaria, §16.39 tramo 2):
//  · El día es el que MIRO (activeDate): el texto lo nombra ("Entró el jueves 21") para que no haya ambigüedad al mirar
//    un día pasado.
//  · Una REGLA NUEVA (template, is_template) NO cuenta como entrada — opción (a). Ya excluida por `!isTemplate`.
//  · "para hoy" = dueDate === día;  "más adelante" = el resto (fechas futuras y sin fecha).
//  · Se cuenta CADA fila que entró (contenedores e hijas por igual): son ítems de trabajo distintos que llegaron ese día.
export interface EntradaItem {
  id: string;
  title: string;
  blockId: string;
  dueDate: string | null;
  estimatedMinutes: number;
  taskType?: 'core' | 'adhoc';
  forToday: boolean; // dueDate === día visto
  parentTaskId: string | null; // §16.104 (pieza 8): para agrupar hijas bajo su contenedor
  isContainer: boolean;
}
// §16.104 (pieza 8): entrada agrupada por contenedor, en dos secciones (para hoy / para otro día).
export interface EntradaGroup {
  containerId: string | null;   // null = tarea suelta
  title: string;                // título del contenedor (o de la tarea suelta)
  isContainer: boolean;
  rows: EntradaItem[];          // filas de ESTA sección (hijas del contenedor, o la propia tarea suelta)
  minutes: number;              // suma estimada de rows
  otherCount: number;           // hijas del MISMO contenedor que caen en la OTRA sección (para la nota)
}
export interface EntradaSection { count: number; minutes: number; groups: EntradaGroup[]; }
export interface EntradaForDay {
  day: string;
  total: number;
  forToday: number;
  later: number;
  items: EntradaItem[]; // ordenadas: primero "para hoy", luego por hora de creación
  hoy: EntradaSection;   // §16.104 (pieza 8): PLANIFICADAS PARA HOY
  otro: EntradaSection;  // §16.104 (pieza 8): PARA OTRO DÍA
}

function createdLocalISO(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getEntradaForDay(dayISO: string, allTasks: Record<string, Task>): EntradaForDay {
  const items: EntradaItem[] = [];
  Object.values(allTasks).forEach((t: any) => {
    if (!t || t.isTemplate || t.isDeleted) return;          // regla nueva (template) NO cuenta — decisión (a)
    if (String(t.id).startsWith('inst-')) return;           // instancias recurrentes no son "entradas"
    if (!t.createdAt || createdLocalISO(t.createdAt) !== dayISO) return;
    const forToday = t.dueDate === dayISO;
    items.push({
      id: t.id,
      title: t.title || '',
      blockId: t.blockId,
      dueDate: t.dueDate ?? null,
      estimatedMinutes: t.estimatedMinutes || 0,
      taskType: t.taskType,
      forToday,
      parentTaskId: t.parentTaskId ?? null,
      isContainer: (t.subtasks || []).length > 0,
    });
  });
  items.sort((a, b) => {
    if (a.forToday !== b.forToday) return a.forToday ? -1 : 1; // "para hoy" primero
    return String(allTasks[a.id]?.createdAt || '').localeCompare(String(allTasks[b.id]?.createdAt || ''));
  });
  const forToday = items.filter(i => i.forToday).length;

  // §16.104 (pieza 8): agrupar por contenedor y partir en dos secciones. Una hija va bajo su contenedor; una tarea sin
  // padre es su propio grupo. Un contenedor con hijas en las DOS secciones aparece en ambas, con la cuenta de la otra (nota).
  const childrenOf: Record<string, EntradaItem[]> = {};
  const roots: EntradaItem[] = [];
  items.forEach(i => { if (i.parentTaskId) (childrenOf[i.parentTaskId] ||= []).push(i); else roots.push(i); });
  const byId: Record<string, EntradaItem> = Object.fromEntries(items.map(i => [i.id, i]));
  const containerIds = new Set<string>([...roots.filter(r => childrenOf[r.id]).map(r => r.id), ...Object.keys(childrenOf)]);
  const buildSection = (wantToday: boolean): EntradaSection => {
    const groups: EntradaGroup[] = [];
    // tareas sueltas (sin padre y sin hijas-entrada) de esta sección
    roots.filter(r => !childrenOf[r.id] && r.forToday === wantToday)
      .forEach(r => groups.push({ containerId: null, title: r.title, isContainer: r.isContainer, rows: [r], minutes: r.estimatedMinutes, otherCount: 0 }));
    // contenedores con hijas en esta sección
    containerIds.forEach(cid => {
      const kids = childrenOf[cid] || [];
      const here = kids.filter(k => k.forToday === wantToday);
      if (here.length === 0) return;
      const there = kids.filter(k => k.forToday !== wantToday).length;
      const title = byId[cid]?.title || (allTasks[cid]?.title as string) || '(contenedor)';
      groups.push({ containerId: cid, title, isContainer: true, rows: here, minutes: here.reduce((a, k) => a + k.estimatedMinutes, 0), otherCount: there });
    });
    const count = groups.reduce((a, g) => a + g.rows.length, 0);
    const minutes = groups.reduce((a, g) => a + g.minutes, 0);
    return { count, minutes, groups };
  };

  return { day: dayISO, total: items.length, forToday, later: items.length - forToday, items, hoy: buildSection(true), otro: buildSection(false) };
}

// ─────────────────────────────────────────────
// TRAMO 4 · REPORTE — NOTA del día + etiqueta (§16.47, aprobado). La NOTA (0–10, un decimal) = tiempo registrado en las
// tareas QUE ESTABAN EN EL PLAN (foto.plan_task_ids) sobre el previsto de la foto. El tiempo en tareas que entraron
// DESPUÉS no suma a la nota (sí se muestra al lado). Razón: siempre se trabaja; lo que distingue un buen día es si se
// trabajó en LO QUE IBA a trabajarse. Sin foto → sin nota. Foto SIN lista (antiguas) → sin nota ('sin_nota').
export type VerdictKey = 'sin_fijar' | 'sin_nota' | 'sobreplanificado' | 'sin_arrancar' | 'a_medias' | 'cumplido' | 'completo';
export interface DayVerdict {
  key: VerdictKey;
  label: string;                  // etiqueta corta ("Día a medias")
  nota: number | null;            // 0–10, un decimal (null sin foto o sin lista)
  frase: string;                  // "4h 20m registradas de 6h previstas"
  hasFoto: boolean;
  hasPlan: boolean;               // la foto guardó plan_task_ids
  previsto: number | null;        // minutos fijados
  registrado: number;             // registrado total del día
  planRegistered: number;         // registrado en tareas DEL PLAN (numerador de la nota)
  outOfPlan: number;              // registrado FUERA del plan ("dedicaste Nh a cosas no previstas")
  anadido: number | null;         // estimatedTotal actual − previsto (desviación de estimado)
  hechas: number;                 // completadas: del PLAN congelado si hay foto; si no, cuántas hechas hoy (recuento, sin denominador)
  total: number | null;           // §16.102: denominador CONGELADO (tamaño del plan de la foto). null = sin foto → NO se inventa denominador
  hechasTrasFijar: number | null;
}

export function computeVerdict(
  stats: { completed: number; total: number; registered: number; estimatedTotal: number },
  foto: { estimated_minutes: number; completed_count: number; plan_task_ids?: string[] } | null,
  jornada: number,
  timeEntries: any[] = [],
  activeDate: string = '',
  // §16.102: conteo del PLAN CONGELADO (tamaño del plan de la foto + cuántas de ese plan están hechas AHORA). Lo calcula
  // quien tiene el mapa (DashboardView). null = no hay foto con plan → el reporte NO inventa denominador (hueco honesto).
  planCompletion: { total: number; hechas: number } | null = null
): DayVerdict {
  const registrado = stats.registered;
  // hechas: del plan congelado si lo hay; si no, cuántas hay hechas hoy (recuento honesto, sin afirmar denominador).
  const hechas = planCompletion ? planCompletion.hechas : stats.completed;
  const total = planCompletion ? planCompletion.total : null; // null → la vista no pinta "de M"
  const base = {
    hasFoto: !!foto, previsto: foto ? foto.estimated_minutes : null, registrado,
    anadido: foto ? stats.estimatedTotal - foto.estimated_minutes : null,
    hechas, total, hechasTrasFijar: foto ? hechas - foto.completed_count : null,
  };

  if (!foto) {
    return { key: 'sin_fijar', label: 'Día sin fijar', nota: null, frase: '', hasPlan: false, planRegistered: 0, outOfPlan: 0, ...base };
  }
  const plan = foto.plan_task_ids || [];
  if (plan.length === 0) {
    // Foto ANTERIOR a esta función (sin lista): no hay contra qué medir la nota → sin nota (no revienta; las medidas siguen).
    return { key: 'sin_nota', label: 'Sin nota', nota: null, frase: 'Fijación anterior a la nota (sin lista del plan)', hasPlan: false, planRegistered: 0, outOfPlan: 0, ...base };
  }

  const previsto = foto.estimated_minutes;
  // §16.106: las entradas del plan pueden venir codificadas ("id::est::bloque::etiqueta::tipo") → usar solo el id.
  const planRegistered = plan.reduce((acc, e) => acc + getTaskRegisteredSelf(planEntryId(e), timeEntries, activeDate), 0);
  const outOfPlan = Math.max(0, registrado - planRegistered); // total − plan (tiempo en cosas que entraron después)
  // §16.88 (decisión propietaria): la NOTA usa el registrado TOTAL del día (`registrado`), NO `planRegistered`. Antes
  // (§16.47) medía solo el tiempo en tareas del plan → excluía el trabajo real en tareas que entraron después (era la
  // "cifra equivocada de las dos", e infra-contaba si el tiempo se fichaba en el contenedor y no en la hoja del plan).
  // planRegistered/outOfPlan se conservan solo como DATO informativo ("Nh fuera de lo previsto").
  const nota = previsto > 0
    ? Math.max(0, Math.min(10, Math.round((registrado / previsto) * 100) / 10))
    : (registrado > 0 ? 10 : 0);

  let key: VerdictKey;
  let label: string;
  if (previsto > jornada) { key = 'sobreplanificado'; label = 'Día sobreplanificado'; }
  else if (registrado < 15) { key = 'sin_arrancar'; label = 'Día sin arrancar'; }
  else if (nota < 8.0) { key = 'a_medias'; label = 'Día a medias'; }
  else if (nota < 9.5) { key = 'cumplido'; label = 'Día cumplido'; }
  else { key = 'completo'; label = 'Día completo'; }

  const frase = `${formatMinutes(registrado)} registradas de ${formatMinutes(previsto)} previstas`;
  return { key, label, nota, frase, hasPlan: true, planRegistered, outOfPlan, ...base };
}

// §16.104 (pieza 7): DESGLOSE del tiempo NO PREVISTO ("dedicaste 2h10m a cosas no previstas"). Lista las tareas con
// tiempo fichado ESE DÍA que NO están en el plan de la foto, agrupando las hijas bajo su contenedor con la suma. La suma
// total cuadra EXACTA con outOfPlan (= registrado del día − registrado en tareas del plan).
const resolveInstId = (id: string | null | undefined): string =>
  !id ? '' : (id.startsWith('inst-') ? id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') : id);

// §16.106 (FIJADO congelado, sin columna nueva): cada entrada de `plan_task_ids` guarda el estado del plan AL FIJAR,
// codificado en la propia cadena del array text[]: "id::estimadoMin::bloque::etiqueta::tipo". Fotos antiguas (sin "::")
// se leen como id pelado (meta=null → los lectores caen a la tarea en vivo). Así FIJADO no se mueve aunque después edites
// el estimado o muevas la tarea de bloque.
export interface PlanEntryMeta { estMin: number; blockId: string; tag: string; type: 'core' | 'adhoc'; }
export function planEntryId(entry: string): string {
  const i = entry.indexOf('::');
  return i === -1 ? entry : entry.slice(0, i);
}
export function planEntryMeta(entry: string): PlanEntryMeta | null {
  const parts = entry.split('::');
  if (parts.length < 5) return null;
  return { estMin: Number(parts[1]) || 0, blockId: parts[2] || '', tag: parts[3] || 'resto', type: parts[4] === 'core' ? 'core' : 'adhoc' };
}
function climbBlockIdF(task: any, allTasksMap: Record<string, Task>): string {
  let t = task, guard = 0;
  while (t && !t.blockId && t.parentTaskId && guard++ < 10) t = allTasksMap[t.parentTaskId];
  return (t && t.blockId) || '';
}
// Codifica una tarea del plan en el momento de fijar (congela estimado + bloque + etiqueta + tipo).
export function encodePlanEntry(task: any, allTasksMap: Record<string, Task>): string {
  const blk = climbBlockIdF(task, allTasksMap);
  const tag = (task.tags && task.tags[0]) || 'resto';
  const type = task.taskType === 'core' ? 'core' : 'adhoc';
  return `${task.id}::${task.estimatedMinutes || 0}::${blk}::${tag}::${type}`;
}

export interface OutOfPlanRow { id: string; title: string; minutes: number; }
export interface OutOfPlanGroup { containerId: string | null; title: string; isContainer: boolean; rows: OutOfPlanRow[]; minutes: number; }
export function getOutOfPlanBreakdown(
  planTaskIds: string[],
  timeEntries: any[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): { total: number; groups: OutOfPlanGroup[] } {
  const planSet = new Set((planTaskIds || []).map(e => resolveInstId(planEntryId(e)))); // §16.106: entradas codificadas
  // minutos por tarea concreta (subtaskId o taskId), SOLO del día y SOLO fuera del plan
  const minsByTask: Record<string, number> = {};
  (timeEntries || []).forEach((e: any) => {
    if (!e || e.date !== activeDate || !(e.duration > 0)) return;
    const key = e.subtaskId || e.taskId;
    if (!key) return;
    const inPlan = planSet.has(resolveInstId(e.taskId)) || planSet.has(resolveInstId(e.subtaskId));
    if (inPlan) return;
    minsByTask[key] = (minsByTask[key] || 0) + e.duration;
  });
  // agrupar por contenedor
  const groupsMap: Record<string, OutOfPlanGroup> = {};
  const standalone: OutOfPlanGroup[] = [];
  Object.entries(minsByTask).forEach(([taskId, minutes]) => {
    const t = allTasksMap[taskId] || allTasksMap[resolveInstId(taskId)];
    const title = t?.title || '(tarea)';
    const parentId = t?.parentTaskId || null;
    const row: OutOfPlanRow = { id: taskId, title, minutes };
    if (parentId) {
      const cont = allTasksMap[parentId];
      const g = groupsMap[parentId] || (groupsMap[parentId] = { containerId: parentId, title: cont?.title || '(contenedor)', isContainer: true, rows: [], minutes: 0 });
      g.rows.push(row); g.minutes += minutes;
    } else {
      standalone.push({ containerId: null, title, isContainer: false, rows: [row], minutes });
    }
  });
  const groups = [...Object.values(groupsMap), ...standalone].sort((a, b) => b.minutes - a.minutes);
  const total = groups.reduce((a, g) => a + g.minutes, 0);
  return { total, groups };
}

// §16.104 (pieza 6): FIJADO vs HECHO, EN TIEMPO, por bloque y etiqueta. Lo que más se quiere del cierre. Necesita foto.
//  · FIJADO = estimado del PLAN congelado (plan_task_ids), por bloque/etiqueta.
//  · HECHO  = tiempo REALMENTE fichado ese día, por bloque/etiqueta (TODO el registrado, dentro y fuera del plan — es la
//    realidad de dónde fue tu tiempo). Compara plan contra realidad; distinto de "¿estimo bien?" (estimado vs real por tarea).
export interface FijadoHechoRow { key: string; fijado: number; hecho: number; }
export interface FijadoVsHecho { byType: FijadoHechoRow[]; byBlock: FijadoHechoRow[]; byTag: FijadoHechoRow[]; totalFijado: number; totalHecho: number; }
function climbBlockId(task: any, allTasksMap: Record<string, Task>): string {
  let t = task, guard = 0;
  while (t && !t.blockId && t.parentTaskId && guard++ < 10) t = allTasksMap[t.parentTaskId];
  return (t && t.blockId) || '';
}
export function getFijadoVsHecho(
  planTaskIds: string[],
  timeEntries: any[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): FijadoVsHecho {
  const block: Record<string, FijadoHechoRow> = {};
  const tag: Record<string, FijadoHechoRow> = {};
  const type: Record<string, FijadoHechoRow> = {};
  const tType = (t: any): 'core' | 'adhoc' => (t.taskType === 'core' ? 'core' : 'adhoc'); // #6: sin tipo → adhoc
  const bumpFijado = (bk: string, tg: string, ty: string, min: number) => {
    (block[bk] ||= { key: bk, fijado: 0, hecho: 0 }).fijado += min;
    (tag[tg] ||= { key: tg, fijado: 0, hecho: 0 }).fijado += min;
    (type[ty] ||= { key: ty, fijado: 0, hecho: 0 }).fijado += min;
  };
  const bumpHecho = (bk: string, tg: string, ty: string, min: number) => {
    (block[bk] ||= { key: bk, fijado: 0, hecho: 0 }).hecho += min;
    (tag[tg] ||= { key: tg, fijado: 0, hecho: 0 }).hecho += min;
    (type[ty] ||= { key: ty, fijado: 0, hecho: 0 }).hecho += min;
  };
  // §16.106: grupo CONGELADO de cada tarea del plan (bloque/etiqueta/tipo AL FIJAR). Frozen si la foto es nueva (meta),
  // si no, en vivo (foto antigua). Clave = id resuelto, para casar con las time_entries.
  const planGroup: Record<string, { blockId: string; tag: string; type: 'core' | 'adhoc' }> = {};
  (planTaskIds || []).forEach(entry => {
    const meta = planEntryMeta(entry);
    const rid = resolveInstId(planEntryId(entry));
    if (meta) {
      bumpFijado(meta.blockId, meta.tag, meta.type, meta.estMin);           // FIJADO congelado
      planGroup[rid] = { blockId: meta.blockId, tag: meta.tag, type: meta.type };
    } else {
      const t = allTasksMap[planEntryId(entry)] || allTasksMap[rid];
      if (!t) return;
      const g = { blockId: climbBlockId(t, allTasksMap), tag: (t.tags && t.tags[0]) || 'resto', type: tType(t) };
      bumpFijado(g.blockId, g.tag, g.type, t.estimatedMinutes || 0);
      planGroup[rid] = g;
    }
  });
  // HECHO (§16.107, decisión #2): SOLO el tiempo de tareas DEL PLAN, agrupado por su grupo CONGELADO (así fijado y hecho
  // caen en el mismo bloque aunque la tarea se haya movido). Lo no previsto ya tiene su línea aparte.
  (timeEntries || []).forEach((e: any) => {
    if (!e || e.date !== activeDate || !(e.duration > 0)) return;
    const rid = resolveInstId(e.subtaskId || e.taskId);
    const g = planGroup[rid] || planGroup[resolveInstId(e.taskId)];
    if (!g) return; // no es del plan → fuera
    bumpHecho(g.blockId, g.tag, g.type, e.duration);
  });
  const rows = (m: Record<string, FijadoHechoRow>) =>
    Object.values(m).filter(r => r.fijado > 0 || r.hecho > 0).sort((a, b) => (b.fijado + b.hecho) - (a.fijado + a.hecho));
  const byBlock = rows(block), byTag = rows(tag), byType = rows(type);
  return {
    byType, byBlock, byTag,
    totalFijado: byBlock.reduce((a, r) => a + r.fijado, 0),
    totalHecho: byBlock.reduce((a, r) => a + r.hecho, 0),
  };
}

// §16.107 (#b): ENTRARON / SALIERON respecto al plan. El "añadido neto" (estimatedTotal−previsto) podía salir negativo y no
// significaba nada claro. Se parte en dos: lo que ENTRÓ al día después de fijar (hojas de hoy que no estaban en el plan) y
// lo que SALIÓ (tareas del plan que ya no cuelgan del día: movidas o borradas). Las que salieron usan su estimado CONGELADO.
export interface EntradasSalidas {
  entraron: { count: number; mins: number };
  salieron: { count: number; mins: number };
}
export function getEntradasSalidas(
  planTaskIds: string[],
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): EntradasSalidas {
  const planIdSet = new Set((planTaskIds || []).map(planEntryId));
  const leaves = collectLeafTasks(dayTasks, allTasksMap, activeDate);
  const leafIdSet = new Set(leaves.map(l => l.id));
  let entN = 0, entMin = 0;
  leaves.forEach(l => { if (!planIdSet.has(l.id)) { entN++; entMin += l.estimatedMinutes || 0; } }); // hoja de hoy que NO estaba en el plan
  let salN = 0, salMin = 0;
  (planTaskIds || []).forEach(e => {
    const id = planEntryId(e);
    if (leafIdSet.has(id)) return; // sigue en el día
    salN++;
    const m = planEntryMeta(e);
    salMin += m ? m.estMin : (allTasksMap[id]?.estimatedMinutes || 0); // estimado CONGELADO si lo hay
  });
  return { entraron: { count: entN, mins: entMin }, salieron: { count: salN, mins: salMin } };
}

// Desglose del REPORTE = el DÍA COMPLETO (hechas + pendientes), por tipo/bloque/etiqueta. Misma forma que el desglose de
// la cabecera (byType/byBlock/byTag) pero sobre TODAS las hojas, no solo las pendientes (§16.42, confirmado: el reporte es
// "cómo ha ido", no "qué queda"). Suma estimatedMinutes.
export interface DayBreakdown {
  byType: { core: number; adhoc: number };
  byBlock: Array<{ blockId: string; minutes: number }>;
  byTag: Array<{ tag: string; minutes: number }>;
}
export function getReportBreakdown(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  activeDate: string
): DayBreakdown {
  const leaves = collectLeafTasks(dayTasks, allTasksMap, activeDate);
  const byType = { core: 0, adhoc: 0 };
  const blockMap = new Map<string, number>();
  const tagMap = new Map<string, number>();
  leaves.forEach(t => {
    const est = t.estimatedMinutes || 0;
    if (est <= 0) return;
    if (t.taskType === 'core') byType.core += est; else byType.adhoc += est; // #6: sin tipo → adhoc (regla única)
    blockMap.set(t.blockId, (blockMap.get(t.blockId) || 0) + est);
    const tag = (t.tags && t.tags[0]) || 'resto';
    tagMap.set(tag, (tagMap.get(tag) || 0) + est);
  });
  const byBlock = Array.from(blockMap.entries()).map(([blockId, minutes]) => ({ blockId, minutes })).sort((a, b) => b.minutes - a.minutes);
  const byTag = Array.from(tagMap.entries()).map(([tag, minutes]) => ({ tag, minutes })).sort((a, b) => b.minutes - a.minutes);
  return { byType, byBlock, byTag };
}

// §16.109 · CLASIFICACIÓN POR DESTINO de las tareas del plan congelado. Sustituye "entraron/salieron" (roto: al COMPLETAR una
// recurrente se crea una excepción con OTRO id, y el conteo por-id creía que "salió" y otra "entró"). Aquí se clasifica por
// lo que le PASÓ a cada tarea, mirando la excepción recurrente por templateId+instanceDate (no por id). Necesita el mapa COMPLETO.
export type PlanFateKind = 'cumplida' | 'pendiente' | 'movida' | 'borrada';
export interface PlanFate { id: string; estMin: number; blockId: string; tag: string; type: 'core' | 'adhoc'; kind: PlanFateKind; onHold: boolean; rolledOverCount: number; title: string; }
export function getPlanFates(allTasks: Record<string, Task>, planTaskIds: string[], date: string): PlanFate[] {
  const excByKey: Record<string, any> = {};
  Object.values(allTasks).forEach((t: any) => { if (t && t.templateId && t.instanceDate) excByKey[`${t.templateId}__${t.instanceDate}`] = t; });
  return (planTaskIds || []).map(entry => {
    const id = planEntryId(entry);
    const meta = planEntryMeta(entry) || { estMin: 0, blockId: '', tag: 'resto', type: 'adhoc' as const };
    const isInst = id.startsWith('inst-');
    const tid = isInst ? id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') : '';
    const cur: any = isInst ? (excByKey[`${tid}__${date}`] || null) : (allTasks[id] || null);
    let kind: PlanFateKind; let onHold = false; let roll = 0; let title = '';
    if (!cur) {
      kind = isInst ? 'pendiente' : 'borrada'; // recurrente sin excepción → sigue pendiente; real sin fila → desaparecida
      if (isInst) { const tpl: any = allTasks[tid]; onHold = !!tpl?.onHold; title = tpl?.title || ''; }
    } else {
      title = cur.title || ''; roll = cur.rolledOverCount || cur.rolled_over_count || 0;
      if (cur.isDeleted) kind = 'borrada';
      else if (cur.status === 'completed') kind = 'cumplida';
      else if (cur.dueDate && cur.dueDate !== date) kind = 'movida';
      else { kind = 'pendiente'; onHold = !!cur.onHold; }
    }
    return { id, estMin: meta.estMin, blockId: meta.blockId, tag: meta.tag, type: meta.type, kind, onHold, rolledOverCount: roll, title };
  });
}

// §16.109 · cuenta por destino: 39 cumplidas · 13 pendientes · 10 movidas · 2 borradas (= plan) + N nuevas (hojas de hoy que
// NO estaban en el plan; una recurrente completada NO cuenta como nueva aunque su id de excepción cambie).
export interface FateAccounting { plan: number; cumplidas: number; pendientes: number; movidas: number; borradas: number; nuevas: number; nuevasMin: number; }
export function getFateAccounting(allTasks: Record<string, Task>, planTaskIds: string[], dayTasks: Task[], date: string): FateAccounting {
  const fates = getPlanFates(allTasks, planTaskIds, date);
  const c = (k: PlanFateKind) => fates.filter(f => f.kind === k).length;
  const planIdSet = new Set((planTaskIds || []).map(planEntryId));
  const leafFromPlan = (l: any) => planIdSet.has(l.id) || (l.templateId && l.instanceDate === date && planIdSet.has(`inst-${l.templateId}-${date}`));
  const leaves = collectLeafTasks(dayTasks, allTasks, date);
  const nuevasLeaves = leaves.filter(l => !leafFromPlan(l));
  return {
    plan: fates.length, cumplidas: c('cumplida'), pendientes: c('pendiente'), movidas: c('movida'), borradas: c('borrada'),
    nuevas: nuevasLeaves.length, nuevasMin: nuevasLeaves.reduce((a, l) => a + (l.estimatedMinutes || 0), 0),
  };
}

// §16.109 · DESCOMPOSICIÓN DEL DESVÍO en DOS BLOQUES que NO se solapan (dominios disjuntos → ningún minuto se cuenta dos veces).
//  A · "¿Por qué no cerré el plan?" = reparto del FIJADO no cumplido, por destino (en espera=onHold ESTADO / movidas / borradas
//      / no llegué). Sobreplanificación va como titular diagnóstico, NO como porción (serían las mismas tareas que no cupieron).
//  B · "¿En qué se fue el tiempo que no era del plan?" = fuera del plan + tardé más de lo estimado (solo en lo cumplido del plan)
//      + causas externas (tiempo que mete la usuaria). Denominadores distintos por bloque; cada uno con su 100%.
// §16.110 · SECUENCIA DEL DÍA que CIERRA (todo en ESTIMADO; `registrado` es OTRO eje, no se resta). El error de siempre era
// restar registrado (lo gastado) de estimado (lo planeado). Identidad: día = fijado − saqué + entraron; sinHacer = día − cumplido.
export interface DayReconciliation {
  fijado: number;                                   // estimado del plan congelado
  entraronMin: number; entraronCount: number;       // tareas NUEVAS para hoy (creadas tras fijar, con fecha hoy)
  saqueMin: number; saqueCount: number;             // plan movidas + borradas (salieron del día)
  diaMin: number;                                   // fijado − saqué + entraron (lo que el día pasó a ser)
  cumplidoMin: number; cumplidoCount: number;       // estimado de TODO lo completado (plan + nuevas)
  sinHacerMin: number; sinHacerCount: number;       // día − cumplido = pendiente al final (plan + nuevas sin hacer)
  registrado: number;                               // FICHÉ — tiempo real, eje aparte
}
export function getDayReconciliation(
  allTasks: Record<string, Task>, planTaskIds: string[], dayTasks: Task[], timeEntries: any[], date: string
): DayReconciliation {
  const fates = getPlanFates(allTasks, planTaskIds, date);
  const sumEst = (k: PlanFateKind) => fates.filter(f => f.kind === k).reduce((a, f) => a + f.estMin, 0);
  const cntF = (k: PlanFateKind) => fates.filter(f => f.kind === k).length;
  const fijado = fates.reduce((a, f) => a + f.estMin, 0);
  const planIdSet = new Set((planTaskIds || []).map(planEntryId));
  const leafFromPlan = (l: any) => planIdSet.has(l.id) || (l.templateId && l.instanceDate === date && planIdSet.has(`inst-${l.templateId}-${date}`));
  const nuevas = collectLeafTasks(dayTasks, allTasks, date).filter(l => !leafFromPlan(l));
  const nuevasCompl = nuevas.filter(l => isTaskCompleted(l.id, allTasks));
  const nuevasMin = nuevas.reduce((a, l) => a + (l.estimatedMinutes || 0), 0);
  const nuevasComplMin = nuevasCompl.reduce((a, l) => a + (l.estimatedMinutes || 0), 0);
  const saqueMin = sumEst('movida') + sumEst('borrada');
  const diaMin = fijado - saqueMin + nuevasMin;
  const cumplidoMin = sumEst('cumplida') + nuevasComplMin;
  const registrado = (timeEntries || []).filter((e: any) => e && e.date === date).reduce((a: number, e: any) => a + (e.duration || 0), 0);
  return {
    fijado, entraronMin: nuevasMin, entraronCount: nuevas.length,
    saqueMin, saqueCount: cntF('movida') + cntF('borrada'),
    diaMin, cumplidoMin, cumplidoCount: cntF('cumplida') + nuevasCompl.length,
    sinHacerMin: diaMin - cumplidoMin, sinHacerCount: cntF('pendiente') + (nuevas.length - nuevasCompl.length),
    registrado,
  };
}

// §16.110 · UNA SOLA TABLA de causas del desvío, PESO vs "sin hacer" (100% = lo que quedó sin hacer). Pueden pasar del 100%:
// es peso de impacto, no reparto de una tarta. Juntas las que calculo yo y las EXTERNAS que mete la usuaria (misma escala).
export interface DesvioCausa { key: string; label: string; mins: number; count?: number; pct: number; detail: { title: string; mins: number }[]; }
export interface DesvioTable { sinHacerMin: number; jornada: number; fijado: number; sobreplan: number; causas: DesvioCausa[]; }
export function getDesvioCauses(
  allTasks: Record<string, Task>, planTaskIds: string[], dayTasks: Task[], timeEntries: any[], date: string,
  jornada: number, outOfPlan: { total: number; groups: OutOfPlanGroup[] }, externalCauses: { label: string; minutes: number }[] = []
): DesvioTable {
  const rec = getDayReconciliation(allTasks, planTaskIds, dayTasks, timeEntries, date);
  const fates = getPlanFates(allTasks, planTaskIds, date);
  const sinHacer = rec.sinHacerMin;
  // Entraron nuevas (para hoy) — la causa más grande cuando engorda el día
  const planIdSet = new Set((planTaskIds || []).map(planEntryId));
  const leafFromPlan = (l: any) => planIdSet.has(l.id) || (l.templateId && l.instanceDate === date && planIdSet.has(`inst-${l.templateId}-${date}`));
  const nuevas = collectLeafTasks(dayTasks, allTasks, date).filter(l => !leafFromPlan(l));
  // Tardé más = minutos de MÁS (registrado − estimado) en lo cumplido del plan
  const tardeMasDetail: { title: string; mins: number }[] = [];
  fates.filter(f => f.kind === 'cumplida').forEach(f => {
    const over = getTaskRegisteredSelf(f.id, timeEntries, date) - f.estMin;
    if (over > 0) tardeMasDetail.push({ title: f.title || '(tarea)', mins: over });
  });
  const tardeMas = tardeMasDetail.reduce((a, d) => a + d.mins, 0);
  // En espera = estimado de pendientes en on_hold
  const enEsperaFates = fates.filter(f => f.kind === 'pendiente' && f.onHold);
  const enEspera = enEsperaFates.reduce((a, f) => a + f.estMin, 0);
  const fueraDetail = (outOfPlan?.groups || []).map(g => ({ title: g.title, mins: g.minutes }));
  const raw: DesvioCausa[] = [
    { key: 'entraron', label: 'Entraron cosas nuevas', mins: rec.entraronMin, count: rec.entraronCount, pct: 0, detail: nuevas.map((l: any) => ({ title: l.title || '(tarea)', mins: l.estimatedMinutes || 0 })) },
    { key: 'sobreplan', label: 'Sobreplanifiqué', mins: Math.max(0, rec.fijado - jornada), pct: 0, detail: [] },
    { key: 'tardeMas', label: 'Tardé más de lo estimado', mins: tardeMas, pct: 0, detail: tardeMasDetail.sort((a, b) => b.mins - a.mins) },
    { key: 'fuera', label: 'Fuera del plan', mins: outOfPlan?.total || 0, pct: 0, detail: fueraDetail },
    { key: 'espera', label: 'En espera', mins: enEspera, count: enEsperaFates.length, pct: 0, detail: enEsperaFates.map(f => ({ title: f.title || '(tarea)', mins: f.estMin })) },
    ...(externalCauses || []).map((c, i) => ({ key: `ext-${i}`, label: c.label, mins: c.minutes || 0, pct: 0, detail: [] as { title: string; mins: number }[] })),
  ];
  const causas = raw.filter(c => c.mins > 0)
    .map(c => ({ ...c, pct: sinHacer > 0 ? Math.round((c.mins / sinHacer) * 100) : 0 }))
    .sort((a, b) => b.mins - a.mins);
  return { sinHacerMin: sinHacer, jornada, fijado: rec.fijado, sobreplan: Math.max(0, rec.fijado - jornada), causas };
}

// §16.101 DESVIACIÓN ESTIMADO vs REGISTRADO (de lo COMPLETADO) — "¿estimo bien?". DISTINTO del FIJADO vs HECHO:
// aquello compara PLAN (foto) contra realidad; esto compara MI ESTIMACIÓN contra MI TIEMPO REAL en lo que sí hice.
//  · NO depende de la foto → funciona en días sin fijación.
//  · Solo tareas COMPLETADAS del día. Registrado = tiempo fichado ESE DÍA (día-scoped). NO el total histórico: una
//    recurrente diaria comparte template, y sumar todas las fechas agregaba TODO su histórico (CM11l 51m→47h → 1109%).
//    El estimado es por-ocurrencia (el de ese día), así que el registrado también debe ser el de ese día.
//  · Completadas SIN tiempo registrado ese día → FUERA de la desviación (no hay con qué comparar), en su contador aparte.
//  · Desglose por bloque y por etiqueta.
export interface DeviationRow { key: string; estimated: number; registered: number; deviation: number; count: number; }
export interface EstimationDeviation {
  count: number;              // completadas CON tiempo registrado (las que entran en la desviación)
  estimated: number;         // suma estimado de esas
  registered: number;        // suma registrado real de esas
  deviation: number;         // registered − estimated  (>0 = tardé MÁS de lo estimado)
  ratioPct: number | null;   // registered/estimated·100  (null si estimated=0)
  byType: DeviationRow[]; // §16.110 (#3): Core/Ad-hoc — ¿estimo peor lo puntual que lo de fondo?
  byBlock: DeviationRow[];
  byTag: DeviationRow[];
  sinTiempo: { count: number; estimated: number }; // completadas SIN registro, aparte
}
export function getEstimationDeviation(
  dayTasks: Task[],
  allTasksMap: Record<string, Task>,
  timeEntries: any[],
  activeDate: string
): EstimationDeviation {
  const done = collectLeafTasks(dayTasks, allTasksMap, activeDate).filter(t => isTaskCompleted(t.id, allTasksMap));
  let estimated = 0, registered = 0, count = 0;
  const sinTiempo = { count: 0, estimated: 0 };
  const blockMap = new Map<string, { est: number; reg: number; count: number }>();
  const tagMap = new Map<string, { est: number; reg: number; count: number }>();
  const typeMap = new Map<string, { est: number; reg: number; count: number }>();
  done.forEach(t => {
    const est = t.estimatedMinutes || 0;
    const reg = getTaskRegisteredSelf(t.id, timeEntries, activeDate); // día-scoped (evita agregar el histórico de recurrentes)
    if (reg <= 0) { sinTiempo.count++; sinTiempo.estimated += est; return; }
    estimated += est; registered += reg; count++;
    const b = blockMap.get(t.blockId) || { est: 0, reg: 0, count: 0 };
    b.est += est; b.reg += reg; b.count++; blockMap.set(t.blockId, b);
    const tag = (t.tags && t.tags[0]) || 'resto';
    const g = tagMap.get(tag) || { est: 0, reg: 0, count: 0 };
    g.est += est; g.reg += reg; g.count++; tagMap.set(tag, g);
    const ty = t.taskType === 'core' ? 'core' : 'adhoc';
    const y = typeMap.get(ty) || { est: 0, reg: 0, count: 0 };
    y.est += est; y.reg += reg; y.count++; typeMap.set(ty, y);
  });
  const toRows = (m: Map<string, { est: number; reg: number; count: number }>): DeviationRow[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({ key, estimated: v.est, registered: v.reg, deviation: v.reg - v.est, count: v.count }))
      .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  return {
    count, estimated, registered,
    deviation: registered - estimated,
    ratioPct: estimated > 0 ? Math.round((registered / estimated) * 100) : null,
    byType: toRows(typeMap),
    byBlock: toRows(blockMap),
    byTag: toRows(tagMap),
    sinTiempo,
  };
}
