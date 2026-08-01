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
import { getTaskEstimatedCombo, getTaskRegisteredCombo } from './utils';
import { materializeDay } from './instanceEngine';

/**
 * Principio (a): el estimado de un contenedor en un día = suma del estimado de sus hijas
 * DE ESE DÍA (no de todas sus hijas de cualquier día).
 * STUB actual: getTaskEstimatedCombo suma TODAS las hijas, sin filtrar por día.
 */
export function containerEstimatedForDay(containerId: string, allTasks: Record<string, Task>, _day: string): number {
  return getTaskEstimatedCombo(containerId, allTasks); // STUB (incorrecto): ignora el día
}

/**
 * Principio (a): el registrado de un contenedor = suma del registrado de sus hijas DEL DÍA,
 * y NUNCA cuenta tiempo registrado sobre el propio contenedor.
 * STUB actual: getTaskRegisteredCombo suma el tiempo PROPIO del contenedor + el de las hijas.
 */
export function containerRegisteredForDay(
  containerId: string, allTasks: Record<string, Task>, timeEntries: any[], day: string,
): number {
  return getTaskRegisteredCombo(containerId, allTasks, timeEntries, new Set(), day); // STUB: incluye lo propio
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
