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
 * Reconciliación sin fuga: el mapa del día X NO debe incluir filas cuyo día ≠ X.
 * STUB actual: el "estado gana" leaky de activeDayMap — materializeDay + overlay de TODO `tasks`.
 */
export function reconcileDay(day: string, allTasks: Record<string, Task>): Record<string, Task> {
  const map: Record<string, Task> = {};
  for (const inst of materializeDay(day, allTasks)) map[inst.id] = inst;
  for (const t of Object.values(allTasks)) if (!t.isDeleted) map[t.id] = t; // STUB: fuga de otros días
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
export function validateTemplate(task: Task, allTasks: Record<string, Task>): string | null {
  if (!task || !task.isTemplate) return null;
  const hasOwnPauta = !!(task.recurrence && (task.recurrence as any).frequency);
  const hasChildren = Object.values(allTasks).some((t) => t && !t.isDeleted && t.parentTaskId === task.id);
  if (hasOwnPauta && hasChildren) return 'una tarea con pauta propia no puede además tener hijas: sus instancias serían las tareas reales, no un contenedor';
  if (!hasOwnPauta && !hasChildren) return 'plantilla inerte: marcada como plantilla pero sin pauta propia ni hijas (no genera ni agrupa nada)';
  return null;
}

