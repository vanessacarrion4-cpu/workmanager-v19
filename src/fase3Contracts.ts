// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — CONTRATOS (tests primero).
//
// Estas funciones fijan el comportamiento CORRECTO que la FASE 3 debe cumplir. Están
// implementadas a propósito como STUBS que reproducen el comportamiento ACTUAL (incorrecto),
// para que sus tests (fase3Contracts.test.ts) salgan en ROJO ahora.
//
// El TRATAMIENTO (que revisa la usuaria ANTES de tocar el modelo) reemplazará estos cuerpos
// por la implementación real y las integrará en la app (utils/App/useTaskCRUD). NADA de la app
// las usa todavía: añadir este fichero NO cambia el comportamiento de producción.
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
 * Principio (b): un contenedor está completo cuando TODAS sus hijas DEL DÍA lo están. Su `status`
 * guardado NO se lee (los 92 "completados" guardados quedan huérfanos, no se limpian).
 * STUB actual: lee el status guardado del contenedor → si alguien lo lee, el test se pone rojo.
 */
export function isContainerCompleteOnDay(containerId: string, allTasks: Record<string, Task>, _day: string): boolean {
  return allTasks[containerId]?.status === 'completed'; // STUB (incorrecto): lee el campo guardado
}

/**
 * Principio (b): al clicar la casilla de un contenedor se completan SOLO sus hijas del día.
 * STUB actual: devuelve TODAS las hijas (cerraría cosas de otros días/meses atrás).
 */
export function childrenToToggleOnDay(containerId: string, allTasks: Record<string, Task>, _day: string): string[] {
  return allTasks[containerId]?.subtasks || []; // STUB (incorrecto): todas, sin filtrar por día
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
