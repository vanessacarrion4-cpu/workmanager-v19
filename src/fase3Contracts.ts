// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — CONTRATOS DEL MODELO (§16.16). Funciones puras que fijan el comportamiento
// correcto (contenedor vs regla, totales/completado por día, degradación, invariante).
// La mayoría YA están implementadas y cableadas en la app (TaskCard/useTaskCRUD).
// EXCEPCIÓN: `reconcileDay` sigue en STUB a propósito (su test está ROJO) hasta (c).
// ─────────────────────────────────────────────────────────────────────────────
import { Task } from './types';
import { getTaskRegisteredSelf } from './utils';
import { materializeDay, belongsToDay } from './instanceEngine';

/**
 * Principio (a): el estimado de un contenedor en un día = suma del estimado de sus hijas
 * PENDIENTES DE ESE DÍA (no de todas sus hijas de cualquier día). Recorre hojas; una hija
 * que a su vez es contenedor se recurre. Nunca cuenta estimado propio del contenedor.
 */
export function containerEstimatedForDay(containerId: string, allTasks: Record<string, Task>, day: string): number {
  const c = allTasks[containerId];
  if (!c) return 0;
  let total = 0;
  for (const sid of c.subtasks || []) {
    const s = allTasks[sid];
    if (!s || s.isDeleted) continue;
    if (s.subtasks && s.subtasks.length > 0) total += containerEstimatedForDay(sid, allTasks, day);
    else if (belongsToDay(s, day) && s.status !== 'completed') total += s.estimatedMinutes || 0;
  }
  return total;
}

/**
 * Principio (a): el registrado de un contenedor = suma del registrado de sus hijas DEL DÍA,
 * y NUNCA cuenta tiempo registrado sobre el propio contenedor (no se recorre la raíz).
 */
export function containerRegisteredForDay(
  containerId: string, allTasks: Record<string, Task>, timeEntries: any[], day: string,
): number {
  const c = allTasks[containerId];
  if (!c) return 0;
  let total = 0;
  for (const sid of c.subtasks || []) {
    const s = allTasks[sid];
    if (!s || s.isDeleted) continue;
    if (s.subtasks && s.subtasks.length > 0) total += containerRegisteredForDay(sid, allTasks, timeEntries, day);
    else if (belongsToDay(s, day)) total += getTaskRegisteredSelf(sid, timeEntries, day);
  }
  return total;
}

/**
 * Principio (b): un contenedor está completo cuando tiene ≥1 hija DEL DÍA y TODAS sus hijas del día
 * lo están. NO se lee el `status` guardado del contenedor (los 92 "completados" guardados quedan
 * huérfanos, no se limpian). Una hija que a su vez es contenedor se evalúa por derivación.
 */
export function isContainerCompleteOnDay(containerId: string, allTasks: Record<string, Task>, day: string): boolean {
  const c = allTasks[containerId];
  if (!c) return false;
  let hasDayChild = false;
  for (const sid of c.subtasks || []) {
    const s = allTasks[sid];
    if (!s || s.isDeleted) continue;
    if (s.subtasks && s.subtasks.length > 0) {
      // Hija-contenedor: solo cuenta si ella tiene hijas del día; si las tiene, debe estar completa.
      if (childrenToToggleOnDay(sid, allTasks, day).length > 0) {
        hasDayChild = true;
        if (!isContainerCompleteOnDay(sid, allTasks, day)) return false;
      }
    } else if (belongsToDay(s, day)) {
      hasDayChild = true;
      if (s.status !== 'completed') return false;
    }
  }
  return hasDayChild;
}

/**
 * Principio (b): al clicar la casilla de un contenedor se completan SOLO sus hijas del día
 * (nunca las de otros días/meses). Devuelve los ids de las hojas del día (recursivo).
 */
export function childrenToToggleOnDay(containerId: string, allTasks: Record<string, Task>, day: string): string[] {
  const c = allTasks[containerId];
  if (!c) return [];
  const out: string[] = [];
  for (const sid of c.subtasks || []) {
    const s = allTasks[sid];
    if (!s || s.isDeleted) continue;
    if (s.subtasks && s.subtasks.length > 0) out.push(...childrenToToggleOnDay(sid, allTasks, day));
    else if (belongsToDay(s, day)) out.push(sid);
  }
  return out;
}

/**
 * §16.12 (C3, opción B) — Mapa del día SIN FUGA. El STUB anterior overlayaba TODO `tasks` (fuga inerte de
 * otros días). Semántica precisa: se CONSERVA una fila si —
 *   1. es una instancia materializada del día (`materializeDay`),
 *   2. PERTENECE al día (`belongsToDay`: `dueDate`/`instanceDate` === day),
 *   3. es un CONTENEDOR (tiene ≥1 hija viva), aunque no tenga fecha propia — `belongsToDay` da false para
 *      un contenedor sin fecha, así que un filtro ingenuo los borraría y ESCONDERÍA contenedores del día,
 *   4. es una PLANTILLA (`isTemplate`) — `filterTasksForDay` hace `allTasksMap[templateId]` para decidir si
 *      una instancia se muestra; sin la plantilla en el mapa esa búsqueda fallaría.
 * Se DESCARTA solo lo realmente sobrante: HOJAS DATADAS de otro día, sin hijas y sin ser plantilla.
 *
 * ✅ CABLEADO en `activeDayMap` (App.tsx:166) desde la sesión 19. (El comentario previo decía "no cableado";
 * quedó stale.) Ver §16.12.
 */
export function reconcileDay(day: string, allTasks: Record<string, Task>): Record<string, Task> {
  const map: Record<string, Task> = {};
  for (const inst of materializeDay(day, allTasks)) map[inst.id] = inst; // 1
  for (const t of Object.values(allTasks)) {
    if (!t || t.isDeleted) continue;
    const hasLiveChild = (t.subtasks || []).some((sid) => allTasks[sid] && !allTasks[sid]!.isDeleted);
    if (belongsToDay(t, day) || hasLiveChild || t.isTemplate) map[t.id] = t; // 2, 3, 4
  }
  return map;
}

/**
 * §16.16 (modelo corregido) — "Ser contenedor" NO es un estado: se DERIVA de tener hijas. `isTemplate:true`
 * marca una REGLA recurrente (genera instancias de sí misma) o, como LLAVE DEL MOTOR, un contenedor que
 * ALOJA reglas recurrentes (son sus hijas las que tienen pauta). Un contenedor que aloja reglas es VÁLIDO
 * — eso es lo que hacían mal el texto y los tests anteriores (asumían contenedor XOR regla).
 * Devuelve un MOTIVO (string) si la MARCA es incoherente, o null si es coherente o no es plantilla.
 * `hasOwnPauta` mira la pauta PROPIA de la tarea, no la de sus hijas. NO bloquea; el llamador avisa.
 *  - pauta propia + hijas          → inválido: una regla genera instancias de sí misma; con hijas no se
 *                                     sabe qué son (las instancias serían las tareas reales, no un contenedor).
 *  - ni pauta propia ni hijas      → inválido: plantilla inerte (la marca no genera ni agrupa nada).
 *                                     Es el "cabo" de vaciar un contenedor que alojaba reglas.
 *  - solo pauta propia / solo hijas → válido (regla pura / contenedor, aloje o no reglas recurrentes).
 */
/**
 * §16.16 (b3) — Completado de una tarea EN UN DÍA: un CONTENEDOR (tiene hijas reales) se deriva por las
 * hijas de ESE día (`isContainerCompleteOnDay`); una HOJA por su propio `status`. Es el ÚNICO criterio de
 * completado para filtros y contadores en vistas CON día (Mi Día). Antes Mi Día usaba `isTaskCompleted`
 * (TODAS las hijas de cualquier día) → un contenedor con las hijas de hoy hechas pero con hijas pendientes
 * de otro día NO se ocultaba al "ocultar completadas". Ignora ids `inst-…` (instancias generadas).
 */
export function isCompletedForDay(taskId: string, allTasks: Record<string, Task>, day: string): boolean {
  const t = allTasks[taskId];
  if (!t) return false;
  const realChildren = (t.subtasks || []).filter((id) => !id.startsWith('inst-') && allTasks[id] && !allTasks[id]!.isDeleted);
  return realChildren.length > 0
    ? isContainerCompleteOnDay(taskId, allTasks, day)
    : t.status === 'completed';
}

/**
 * §16.16 — Al togglear el completado, SOLO las HOJAS escriben su propio `status`. Un CONTENEDOR (tarea con
 * hijas) NUNCA escribe el suyo: su completado se DERIVA de las hijas (mismo principio que `isContainerCompleteOnDay`
 * / `isTaskCompleted`). Sin esto, al vaciar el contenedor se pinta como hoja y arrastra un `status:'completed'`
 * viejo → salía TACHADO (caso a, sesión 18). Se ignoran los ids `inst-…` (instancias generadas, no hijas reales).
 */
export function writesOwnStatusOnToggle(task: Task): boolean {
  if (!task) return false;
  const realChildren = (task.subtasks || []).filter((id) => !id.startsWith('inst-'));
  return realChildren.length === 0; // hoja → escribe su status; contenedor → no
}

/**
 * §16.16 (C1) — SELECCIÓN día-scoped al clicar un CONTENEDOR: qué hijas se togglean ese día y en qué
 * dirección. Es el CAMINO REAL: `handleToggleStatus` llama a esta función (no es un helper aislado). Los 2
 * bugs de C1 vivían aquí, por eso se extrae y se testea directamente.
 *  - Devuelve null si no procede la rama C1 (no hay día de vista, o `task` no es contenedor) → el llamador
 *    usa el camino de hoja / Bloques (todas las hijas).
 *  - Tipo de contenedor por su PLANTILLA (`allTasks[templateId||id].isTemplate`), NO por `task.isTemplate`:
 *    en Mi Día un contenedor recurrente se renderiza como su INSTANCIA (isTemplate:false).
 *      · isTemplate:true  → `materializeDay(D)` (cubre manual + recurrente del día), filtrado por relación de plantilla.
 *      · isTemplate:false → `childrenToToggleOnDay(D)` (hijas manuales reales del día).
 *  - Dirección: si TODAS las hijas del día están completas → 'pending' (desmarcar); si no → 'completed'.
 * NO incluye el contenedor (su completado se DERIVA). Nunca toca hijas de otro día (materializeDay/childrenToToggleOnDay son día-scoped).
 */
export function containerDayToggle(
  task: Task | null | undefined,
  allTasks: Record<string, Task>,
  viewDay: string | null | undefined,
): { children: Task[]; status: 'pending' | 'completed' } | null {
  if (!task || !viewDay) return null;
  const containerTmplId = task.templateId || task.id;
  const containerTmpl = allTasks[containerTmplId];
  const isContainerNode = ((task.subtasks || []).length > 0) || ((containerTmpl?.subtasks || []).length > 0);
  if (!isContainerNode) return null;

  let children: Task[] = [];
  if (containerTmpl && containerTmpl.isTemplate) {
    // materializeDay(D) pone `parentTaskId` = id de la instancia del contenedor a TODAS sus hijas del día
    // (manual por case-4 y recurrente por case-5/landed). Filtrar por ESO, no por `templateId` — las hijas
    // MANUALES no tienen templateId y el filtro viejo las excluía (bug del mixto, cazado por este test).
    const dmArr = materializeDay(viewDay, allTasks);
    const contInst = dmArr.find((c) => c.templateId === containerTmplId); // la instancia del contenedor
    const contInstId = contInst ? contInst.id : `inst-${containerTmplId}-${viewDay}`;
    children = dmArr.filter((c) => c.parentTaskId === contInstId);
  } else {
    children = childrenToToggleOnDay(task.id, allTasks, viewDay).map((id) => allTasks[id]).filter(Boolean) as Task[];
  }
  const currentlyComplete = children.length > 0 && children.every((c) => c.status === 'completed');
  return { children, status: currentlyComplete ? 'pending' : 'completed' };
}

/**
 * childrenToMoveWithContainer — opción A del movimiento de contenedores (FASE 3, bloque 2).
 *
 * Cuando un contenedor se mueve de `oldDate` a otro día, sus hijas de FILA REAL deben viajar con él;
 * si no, quedan varadas en `oldDate` (el padre en el día nuevo con 0 hijas visibles y las hijas
 * huérfanas sin padre en el día viejo → el bug "vacated"). belongsToDay() ancla cada hija por su
 * `dueDate||instanceDate`, así que mover = re-fechar esas filas.
 *
 * Devuelve SOLO ids de filas reales que están en `oldDate`:
 *  - Hijas MANUALES: `parentTaskId` apunta al contenedor (o a su plantilla).
 *  - Excepciones recurrentes ACTUADAS: fila real con `templateId` cuya plantilla cuelga del contenedor.
 * Las recurrentes NO actuadas NO son filas reales (no están en `allTasks`) → no salen aquí: se
 * regeneran solas en el destino vía materializeDay. Nunca incluye hijas de otro día ni borradas.
 */
export function childrenToMoveWithContainer(
  container: Task | null | undefined,
  allTasks: Record<string, Task>,
  oldDate: string | null | undefined,
): string[] {
  if (!container || !oldDate) return [];
  const containerId = container.id;
  const containerTid = container.templateId || container.id;
  const ids = new Set<string>();
  const onOldDay = (c: Task | undefined): boolean => !!c && !c.isDeleted && (c.dueDate || c.instanceDate) === oldDate;

  for (const c of Object.values(allTasks)) {
    if (!c) continue;
    const isManualChild = c.parentTaskId === containerId || c.parentTaskId === containerTid;
    const tmpl = c.templateId ? allTasks[c.templateId] : undefined;
    const isActedException = !!c.templateId && !!tmpl && tmpl.parentTaskId === containerTid && !!c.isException;
    if ((isManualChild || isActedException) && onOldDay(c)) ids.add(c.id);
  }
  // Refuerzo: lo que el contenedor lista en subtasks y sea fila real del día viejo.
  for (const sid of container.subtasks || []) {
    if (onOldDay(allTasks[sid])) ids.add(sid);
  }
  return Array.from(ids);
}

export function validateTemplate(task: Task, allTasks: Record<string, Task>): string | null {
  if (!task || !task.isTemplate) return null;
  const hasOwnPauta = !!(task.recurrence && (task.recurrence as any).frequency);
  const hasChildren = Object.values(allTasks).some((t) => t && !t.isDeleted && t.parentTaskId === task.id);
  if (hasOwnPauta && hasChildren) return 'una tarea con pauta propia no puede además tener hijas: sus instancias serían las tareas reales, no un contenedor';
  if (!hasOwnPauta && !hasChildren) return 'plantilla inerte: marcada como plantilla pero sin pauta propia ni hijas (no genera ni agrupa nada)';
  return null;
}

