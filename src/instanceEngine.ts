/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Motor de instancias V20 — dos funciones puras.
 *
 * - occursOn(task, fecha): ¿toca este día? (predicado puro, NO genera nada,
 *   NO aplica excepciones — eso se hace en la capa que agrega Carga/Semana).
 * - materializeDay(fecha, allTasks): instancias reales de UN día para el Dashboard.
 *   Regla clave: una EXCEPCIÓN PERSISTIDA siempre gana sobre la regeneración
 *   (p.ej. una instancia ya completada se devuelve completada, no se regenera).
 *
 * Ninguna de las dos escribe en Supabase ni muta `allTasks`.
 */

import { Task } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';

// -------------------------------------------------------------------------
// occursOn — predicado puro de recurrencia
// -------------------------------------------------------------------------

/** Aplica la regla de recurrencia a una fecha concreta (semana lunes-base). */
function matchesRecurrence(recurrence: NonNullable<Task['recurrence']>, dateStr: string): boolean {
  if (!recurrence) return false;

  // Límites temporales
  if (dateStr < (recurrence.startDate || '')) return false;
  if (recurrence.endDate && dateStr > recurrence.endDate) return false;

  const date = parseLocalISO(dateStr);
  const jsDay = date.getDay();
  const specDay = (jsDay + 6) % 7; // 0=lunes ... 6=domingo
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
    case 'yearly': {
      // yearDay / yearMonth los fija el usuario; si faltan, se leen de startDate.
      const targetDay = recurrence.yearDay ?? (recurrence.startDate ? parseLocalISO(recurrence.startDate).getDate() : null);
      const targetMonth = recurrence.yearMonth ?? (recurrence.startDate ? parseLocalISO(recurrence.startDate).getMonth() + 1 : null);
      if (targetDay === null || targetMonth === null) return false;
      return date.getDate() === targetDay && (date.getMonth() + 1) === targetMonth;
    }
    default:
      return false;
  }
}

/**
/**
 * FASE 3 — ¿la fila `t` PERTENECE al día `day`? ÚNICA definición de "pertenece a un día".
 * La usan los tres cambios de FASE 3 (totales, completado, reconciliación): que no haya tres
 * definiciones que se desincronicen. Una fila se muestra/cuenta el día de su `dueDate`; si no
 * lo tiene, el de su `instanceDate` (excepciones movidas / instancias materializadas).
 * Un contenedor manual (sin fecha) NO pertenece a un día por sí mismo: pertenece por tener
 * hijas de ese día — eso lo derivan quienes la usan, llamando a esta misma función sobre las hijas.
 */
export function belongsToDay(t: Task | null | undefined, day: string): boolean {
  if (!t || !day) return false;
  const d = t.dueDate || t.instanceDate || null;
  return d === day;
}

/**
 * ¿La tarea `task` ocurre en `dateStr` (YYYY-MM-DD)?
 *
 * - Con `recurrence`: aplica la regla de recurrencia.
 * - Sin recurrencia, con `dueDate`: ocurre solo el día de su fecha.
 * - Sin recurrencia ni fecha: nunca.
 *
 * Función PURA: no mira excepciones, no muta nada, no crea objetos.
 */
export function occursOn(task: Task | null | undefined, dateStr: string): boolean {
  if (!task || !dateStr) return false;
  if (task.recurrence) return matchesRecurrence(task.recurrence, dateStr);
  if (task.dueDate) return task.dueDate === dateStr;
  return false;
}

// -------------------------------------------------------------------------
// materializeDay — instancias reales de un día
// -------------------------------------------------------------------------

/**
 * Índice de excepciones persistidas por templateId (una sola pasada).
 * Incluye borradas: se necesitan para suprimir un día concreto.
 */
function indexExceptionsByTemplate(allTasks: Record<string, Task>): Map<string, Task[]> {
  const byTemplate = new Map<string, Task[]>();
  for (const t of Object.values(allTasks)) {
    if (t && t.templateId && t.isException) {
      const arr = byTemplate.get(t.templateId);
      if (arr) arr.push(t);
      else byTemplate.set(t.templateId, [t]);
    }
  }
  return byTemplate;
}

/** Excepción (no borrada) que "aterriza" en este día: se muestra aquí (dueDate === día). */
function findLanded(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => !e.isDeleted && e.dueDate === dateStr);
}

/** Excepción borrada que afecta a este día: suprime la ocurrencia. */
function findDeletedForDay(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => e.isDeleted && (e.dueDate === dateStr || e.instanceDate === dateStr));
}

/** Excepción (no borrada) que "abandona" este día: su día original era `dateStr` pero se movió. */
function findVacated(exceptions: Task[] | undefined, dateStr: string): Task | undefined {
  return exceptions?.find(e => !e.isDeleted && e.instanceDate === dateStr && e.dueDate !== dateStr);
}

/**
 * Resuelve qué objeto Task representa a un hijo (`childTemplate`) en `dateStr`.
 * Devuelve `null` si el hijo no aparece ese día.
 *
 * Precedencia (la excepción persistida SIEMPRE gana):
 *   1. Excepción borrada para este día → no aparece.
 *   2. Excepción persistida que aterriza aquí → se devuelve TAL CUAL (puede estar
 *      completada). Solo se ajusta el parentTaskId sin mutar el original.
 *   3. Excepción que abandona este día → no aparece (se verá en su nuevo día).
 *   4. Hijo manual (isTemplate:false) cuya fecha es hoy → tarea real por referencia.
 *   5. La recurrencia toca hoy → se genera una instancia nueva en 'pending'.
 *   6. En otro caso → no aparece.
 */
function resolveChildForDay(
  childTemplate: Task,
  dateStr: string,
  parentInstanceId: string,
  exceptionsByTemplate: Map<string, Task[]>,
  timestamp: string
): Task | null {
  const exceptions = exceptionsByTemplate.get(childTemplate.id);

  // 1. Borrada para este día → suprimida.
  if (findDeletedForDay(exceptions, dateStr)) return null;

  // 2. Excepción persistida que aterriza hoy → GANA sobre la regeneración.
  const landed = findLanded(exceptions, dateStr);
  if (landed) {
    // Copia superficial para cablear el padre correcto sin mutar el original.
    return { ...landed, parentTaskId: parentInstanceId };
  }

  // 3. Se movió a otro día → no aparece hoy.
  if (findVacated(exceptions, dateStr)) return null;

  // 4. Hijo manual (tarea real, no plantilla): aparece el día de su fecha.
  if (childTemplate.isTemplate === false) {
    if (!childTemplate.isDeleted && childTemplate.dueDate === dateStr) {
      return { ...childTemplate, parentTaskId: parentInstanceId };
    }
    return null;
  }

  // 4b (§16.71). Hija que PERDIÓ la pauta: al quitar la recurrencia de una hija de contenedor, el CRUD la deja
  // como plantilla SIN pauta (isTemplate:true, recurrence:null) conservando su parentTaskId — NO la degrada a
  // manual (isTemplate:false). Sin este caso caía al 5 (occursOn=false) → null → se salía del contenedor y
  // parecía HUÉRFANA aunque el parentTaskId siguiera apuntando al contenedor. La VISTA la resuelve por su fecha,
  // como una hija one-off, sin tocar el dato (decisión de la propietaria: que la vista sepa resolver los dos casos,
  // no parchear el dato). Es fila real (id propio) → se devuelve tal cual, no se genera instancia.
  if (!childTemplate.recurrence) {
    if (!childTemplate.isDeleted && childTemplate.dueDate === dateStr) {
      return { ...childTemplate, parentTaskId: parentInstanceId };
    }
    return null;
  }

  // 5. La recurrencia toca hoy → instancia nueva en 'pending'.
  if (occursOn(childTemplate, dateStr)) {
    return {
      ...childTemplate,
      id: `inst-${childTemplate.id}-${dateStr}`,
      templateId: childTemplate.id,
      parentTaskId: parentInstanceId,
      dueDate: dateStr,
      instanceDate: dateStr,
      isTemplate: false,
      isException: false,
      status: 'pending',
      completedAt: null,
      subtasks: [],
      createdAt: timestamp,
      modifiedAt: timestamp,
    };
  }

  // 6. No aparece.
  return null;
}

/**
 * Materializa las instancias de UN solo día a partir de las plantillas y
 * excepciones que hay en `allTasks`.
 *
 * Devuelve un array plano: por cada contenedor que aparece ese día, el
 * contenedor seguido de sus hijos. Las instancias recurrentes se generan al
 * vuelo; las excepciones persistidas y las tareas manuales se incluyen (con su
 * id y estado reales). NO escribe en Supabase ni muta `allTasks`.
 */
export function materializeDay(dateStr: string, allTasks: Record<string, Task>): Task[] {
  if (!dateStr || !allTasks) return [];

  const exceptionsByTemplate = indexExceptionsByTemplate(allTasks);
  const timestamp = new Date().toISOString();
  const result: Task[] = [];

  // Ids referenciados como subtarea de cualquier tarea: NO son contenedores de nivel 1.
  // (Evita que un template hijo sin parentTaskId se materialice dos veces.)
  const childIds = new Set<string>();
  for (const t of Object.values(allTasks)) {
    if (t?.subtasks) for (const id of t.subtasks) childIds.add(id);
  }

  // Plantillas-contenedor reales (nivel 1): isTemplate, sin templateId ni padre, y que no son subtarea de nadie.
  //
  // §16.79 (regla de modelo): la recurrencia vive en la HIJA y NO depende de ningún estado del contenedor.
  // Se RETIRA el guard `isActive !== false` (era el mismo error que `isTemplate`: un flag del contenedor apagando
  // a las hijas). Era el origen del bug "las mensuales de Pagos del mes FINCA no generan" (§16.76): el contenedor
  // quedó is_active:false (legacy, terminar-rutina viejo) y suprimía sus 5 hijas mensuales. Terminar una serie =
  // `recurrence.endDate` (lo respeta matchesRecurrence), NUNCA isActive. Basura legada con is_active:false que
  // pudiera resucitar: limpiada antes (gafgaf borrada; pruebaaaa sin hijas recurrentes; Firmas RRHH con endDate).
  const containers = Object.values(allTasks).filter(t =>
    t &&
    t.isTemplate === true &&
    !t.templateId &&
    !t.parentTaskId &&
    !childIds.has(t.id) &&
    !t.isDeleted
  );

  for (const container of containers) {
    const containerExceptions = exceptionsByTemplate.get(container.id);

    // §16.16 (TAPÓN B, sesión 18): la excepción-BORRADA de contenedor para el día se calcula aquí pero NO
    // se aplica aún — un contenedor con hijas PENDIENTES vivas ese día NO debe enterrarse (era lo que
    // ocultaba "Verduras vivas" y sus 4 tareas: "borrar → este día" suprimía el subárbol entero). La
    // decisión se toma abajo, tras resolver las hijas.
    const deletedForDay = findDeletedForDay(containerExceptions, dateStr);

    // ¿El contenedor viene de una excepción persistida que aterriza hoy?
    const containerLanded = findLanded(containerExceptions, dateStr);

    // Contenedor MOVIDO a otro día (vacated) sin excepción que aterrice hoy → no aparece hoy (ni sus hijas).
    // CLAVE: aplica a AMBAS ramas. Antes el check solo estaba en la rama SIN-hijas; un contenedor CON-hijas
    // movido seguía apareciendo en el día viejo (las hijas siguen occursOn ese día) → doble render (el bug de
    // los 3 contenedores movidos reales). Guard `!containerLanded`: no ocultar una excepción que aterriza aquí.
    if (!containerLanded && findVacated(containerExceptions, dateStr)) continue;

    const parentInstanceId = containerLanded ? containerLanded.id : `inst-${container.id}-${dateStr}`;

    const childTemplates = (container.subtasks || [])
      .map(id => allTasks[id])
      .filter(Boolean) as Task[];

    // --- Caso contenedor SIN hijos: plantilla recurrente autónoma ---
    // (el check de vacated ya se hizo arriba, unificado para ambas ramas)
    if (childTemplates.length === 0) {
      // SIN hijas no hay trabajo vivo que enterrar → el día borrado se suprime (comportamiento previo).
      if (deletedForDay) continue;
      if (containerLanded) {
        result.push({ ...containerLanded, subtasks: [] });
        continue;
      }
      if (occursOn(container, dateStr)) {
        result.push(buildContainerInstance(container, parentInstanceId, dateStr, [], timestamp));
      }
      continue;
    }

    // --- Caso contenedor CON hijos ---
    const resolvedChildren: Task[] = [];
    const subtaskIds: string[] = [];
    for (const child of childTemplates) {
      const resolved = resolveChildForDay(child, dateStr, parentInstanceId, exceptionsByTemplate, timestamp);
      if (resolved) {
        resolvedChildren.push(resolved);
        subtaskIds.push(resolved.id);
      }
    }

    // #5 / §16.17 (sesión 26): ordenar las hijas por su `order`. El resuelto es la EXCEPCIÓN del día (con el order
    // per-día que escribe handleUpdateSubtasksOrder) si aterriza hoy, o la generada (order de la plantilla) si no →
    // reordenar las subtareas de un contenedor recurrente es POR DÍA y sobrevive a la recarga. En días sin excepción
    // el order es el de la plantilla, así que el resultado no cambia. Sort ESTABLE (mismo order → orden de llegada).
    if (resolvedChildren.length > 1) {
      const indexed = resolvedChildren.map((c, i) => ({ c, i }));
      indexed.sort((a, b) => ((a.c.order ?? 9999) - (b.c.order ?? 9999)) || (a.i - b.i));
      resolvedChildren.length = 0; subtaskIds.length = 0;
      for (const { c } of indexed) { resolvedChildren.push(c); subtaskIds.push(c.id); }
    }

    // TAPÓN B: solo se HONRA la excepción-borrada del contenedor si ese día NO le queda ninguna hija
    // pendiente PERSISTIDA (trabajo real con el que se interactuó: `allTasks[c.id]` existe). Una ocurrencia
    // recurrente auto-generada (no persistida) NO resucita un contenedor borrado a propósito. Con ≥1 hija
    // pendiente persistida, el contenedor REAPARECE (no enterrar trabajo vivo — el bug de "Verduras vivas").
    const hasPendingPersistedChild = resolvedChildren.some(c => c.status !== 'completed' && !!allTasks[c.id]);
    if (deletedForDay && !hasPendingPersistedChild) continue;

    // Si el contenedor tiene hijos pero ninguno aplica hoy (todos movidos/borrados),
    // no se crea un contenedor vacío... salvo que exista una excepción de contenedor.
    if (subtaskIds.length === 0 && !containerLanded) continue;

    const containerInstance = containerLanded
      ? { ...containerLanded, subtasks: subtaskIds }
      : buildContainerInstance(container, parentInstanceId, dateStr, subtaskIds, timestamp);

    result.push(containerInstance, ...resolvedChildren);
  }

  return result;
}

/** Construye una instancia de contenedor nueva en 'pending' a partir de su plantilla. */
function buildContainerInstance(
  container: Task,
  instanceId: string,
  dateStr: string,
  subtaskIds: string[],
  timestamp: string
): Task {
  return {
    ...container,
    id: instanceId,
    templateId: container.id,
    parentTaskId: null,
    dueDate: dateStr,
    instanceDate: dateStr,
    isTemplate: false,
    isException: false,
    status: 'pending',
    completedAt: null,
    subtasks: subtaskIds,
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

// -------------------------------------------------------------------------
// templateIdFromInstanceId — extrae el templateId de un id de instancia
// -------------------------------------------------------------------------

/**
 * De `inst-{templateId}-{YYYY-MM-DD}` devuelve `{templateId}`.
 *
 * Robusto a templateId con LETRAS/guiones (`tmpl-…`, UUID): hace strip del prefijo
 * `inst-` y de la fecha final, NO asume `t-\d+` (el regex `/^inst-(t-\d+)/` es INCORRECTO —
 * ver §5). Si `id` no es `inst-…` o no acaba en `-YYYY-MM-DD`, se devuelve tal cual.
 */
export function templateIdFromInstanceId(id: string): string {
  if (!id || !id.startsWith('inst-')) return id;
  if (!/-\d{4}-\d{2}-\d{2}$/.test(id)) return id;
  return id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

// -------------------------------------------------------------------------
// resolveTaskId — de id de instancia virtual al id de la tarea REAL
// -------------------------------------------------------------------------

/**
 * Resuelve el id sobre el que deben operar los handlers cuando reciben una
 * instancia virtual (`inst-{templateId}-{YYYY-MM-DD}`).
 *
 * Precedencia (la misma que materializeDay — la EXCEPCIÓN PERSISTIDA gana):
 *   1. Si no es un id `inst-…` → ya es real (tarea manual, plantilla…): se devuelve tal cual.
 *   2. Si existe una excepción persistida que ATERRIZA en ese día (en su sitio o movida a
 *      él: `isException && !isDeleted && templateId coincide && dueDate === fecha`) → se
 *      devuelve el id de ESA excepción (completada, movida, etc.).
 *   3. Si no hay excepción → se devuelve el id de la PLANTILLA (la serie).
 *
 * Función PURA: no muta nada, no escribe en Supabase. El id de plantilla se extrae con el
 * regex correcto (los templateId llevan letras/guiones; `/^inst-(t-\d+)/` sería INCORRECTO).
 */
export function resolveTaskId(instanceId: string, allTasks: Record<string, Task>): string {
  if (!instanceId || !instanceId.startsWith('inst-')) return instanceId;

  const dateMatch = instanceId.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) return instanceId; // formato inesperado: no tocar
  const date = dateMatch[1];
  const templateId = instanceId.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');

  // Excepción persistida que aterriza en este día → gana.
  for (const t of Object.values(allTasks)) {
    if (t && t.isException && !t.isDeleted && t.templateId === templateId && t.dueDate === date) {
      return t.id;
    }
  }

  // Sin excepción → la plantilla (la serie).
  return templateId;
}

// -------------------------------------------------------------------------
// materializeInstanceById — objeto de UNA instancia virtual (para handlers)
// -------------------------------------------------------------------------

/**
 * Devuelve el objeto Task que `materializeDay` renderiza para `instanceId` en su día,
 * SIN escribir ni mutar nada. Uso: los handlers que reciben el id de una instancia
 * recurrente VIRGEN (sin fila en el estado) y necesitan el objeto para materializar la
 * excepción al tocarla (completar/borrar/promover…), una vez retirado `useGeneration`.
 *
 * Contrato:
 *   - id que NO es `inst-…` (tarea real): se devuelve `allTasks[id]` o `null`.
 *   - id `inst-…` con formato inesperado (sin fecha): `allTasks[id]` o `null`.
 *   - id `inst-…` válido: se corre `materializeDay` de ese día y se busca por id exacto.
 *       · La recurrencia toca ese día → la instancia generada ('pending', isException:false).
 *       · Una excepción persistida aterriza ese día CON ese mismo id → se devuelve la
 *         excepción (p.ej. completada); es coherente con `materializeDay`.
 *       · No toca, fue movida (vacated) o borrada ese día → `null`. En el día DESTINO de
 *         una excepción movida, `materializeDay` la devuelve bajo su id ORIGINAL, no bajo
 *         el `inst-…` del destino → aquí sería `null` (ese caso lo cubre `resolveTaskId`).
 *
 * Función PURA (delega en `materializeDay`, que no muta ni escribe).
 */
export function materializeInstanceById(instanceId: string, allTasks: Record<string, Task>): Task | null {
  if (!instanceId || !allTasks) return null;
  if (!instanceId.startsWith('inst-')) return allTasks[instanceId] ?? null;

  const dateMatch = instanceId.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) return allTasks[instanceId] ?? null; // formato inesperado

  const date = dateMatch[1];
  const dayInstances = materializeDay(date, allTasks);
  return dayInstances.find(t => t.id === instanceId) ?? null;
}

/**
 * Resuelve el OBJETIVO de una acción (completar, registrar tiempo, borrar, editar, arrancar timer…) a
 * partir de un id, cubriendo las TRES formas en que una tarea puede existir tras retirar `useGeneration`:
 *   1. Fila real en el estado (`allTasks[id]`): tarea manual o excepción ya persistida → se devuelve.
 *   2. Instancia recurrente con excepción persistida bajo OTRO id (movida): se resuelve vía
 *      `resolveTaskId`, PERO solo si es `isException` — NUNCA la plantilla (tocarla afectaría a toda la
 *      serie sin avisar).
 *   3. Instancia SOLO VIRTUAL (materializada al vuelo, sin fila): se materializa con
 *      `materializeInstanceById`.
 * Devuelve `null` si no existe ese día. NO persiste ni muta: la ESCRITURA de la acción (p.ej.
 * `handleUpdateTask`) es la que crea/actualiza la fila de excepción. El id sobre el que actuar es
 * siempre `resultado.id`.
 *
 * RESCATE CENTRALIZADO (sesión 15): TODO handler que actúe sobre UNA ocurrencia por id debe pasar por
 * aquí en vez de leer `allTasks[id]` directamente. Si no, una instancia solo-virtual no se encuentra y
 * la acción es un no-op silencioso (bug del completado). Excepción: `handleToggleStatus` y las acciones
 * en lote necesitan el DÍA entero (recursión de hijas) y usan `materializeDay` directamente.
 */
export function resolveActionTarget(id: string, allTasks: Record<string, Task>): Task | null {
  if (!id || !allTasks) return null;
  const direct = allTasks[id];
  if (direct) return direct;
  const resolvedId = resolveTaskId(id, allTasks);
  if (resolvedId !== id) {
    const resolved = allTasks[resolvedId];
    if (resolved && resolved.isException) return resolved;
  }
  if (id.startsWith('inst-')) return materializeInstanceById(id, allTasks);
  return null;
}
