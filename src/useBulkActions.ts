/**
 * useBulkActions.ts
 *
 * Handlers de acciones masivas: actualizar, borrar y duplicar tareas seleccionadas.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { Task } from './types';
import { supabase } from './supabaseClient';
import { resolveTaskId, materializeDay } from './instanceEngine';
import { getTaskRegisteredSelf } from './utils'; // A3-bulk: guarda de borrado (no tocar las que tienen tiempo ese día)
import { persist, reportPersistError } from './persist'; // Avisos (B1): escrituras que fallan avisan (agrupadas por lote)
import { toast } from './toast'; // (a) sesión 24: confirm informativo del bulk / aviso "nada que quitar"

interface UseBulkActionsOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  selectedTaskIds: Set<string>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeDate: string;
  timeEntries: any[]; // A3-bulk: para la guarda "sin tiempo registrado ese día"
}

/**
 * C3: resuelve un id de la selección al OBJETO renderizado, incluyendo instancias recurrentes VÍRGENES
 * (que no están en `tasks`). Materializa cada día implicado UNA sola vez (agrupado por fecha), no una
 * materialización completa por id (§13 Fase C). Devuelve `undefined` si no aparece ese día.
 */
function createDayResolver(tasks: Record<string, Task>, activeDate: string) {
  const dayCache: Record<string, Record<string, Task>> = {};
  const dayMapFor = (day: string): Record<string, Task> => {
    if (!dayCache[day]) {
      const dm: Record<string, Task> = {};
      for (const inst of materializeDay(day, tasks)) dm[inst.id] = inst;
      dayCache[day] = dm;
    }
    return dayCache[day];
  };
  return (id: string): Task | undefined => {
    if (tasks[id]) return tasks[id];
    const m = id.match(/-(\d{4}-\d{2}-\d{2})$/);
    return dayMapFor(m ? m[1] : activeDate)[id];
  };
}

/**
 * bulkEffectiveIds — selección REAL de una acción masiva (camino puro, testeable).
 *
 * Para cada id seleccionado: si es HOJA, se incluye tal cual; si es CONTENEDOR, se BAJA a sus hijas
 * PENDIENTES del día activo (nunca completadas ni de otro día). Devuelve también los objetos resueltos
 * (instancias recurrentes vírgenes que no están en `tasks`).
 *
 * FIX (item 6, mismo bug que b1): una hija MANUAL de un contenedor recurrente/plantilla apunta con su
 * `parentTaskId` a la INSTANCIA (`id`) **o a la PLANTILLA del contenedor** (`task.templateId`) — ver
 * `filters.ts` CASO 2 (`container.id || containerTemplateId`). El scan viejo solo miraba `=== id` para las
 * manuales, así que la hija manual que apuntaba a la plantilla se PERDÍA en la acción masiva. Ahora se
 * cubren ambas formas. (La rama recurrente por `tmpl.parentTaskId` se mantiene intacta → sin regresión.)
 */
export function bulkEffectiveIds(
  selectedIds: Iterable<string>,
  tasks: Record<string, Task>,
  activeDate: string,
  resolve: (id: string) => Task | undefined,
): { ids: string[]; resolved: Record<string, Task> } {
  const effectiveIds = new Set<string>();
  const resolvedById: Record<string, Task> = {};
  for (const id of selectedIds) {
    let task = tasks[id];
    if (!task) { const o = resolve(id); if (o) { task = o; resolvedById[o.id] = o; } }
    if (!task) continue;
    const isContainer = !!(task.subtasks && task.subtasks.length > 0);
    if (isContainer) {
      const instanceDate = task.instanceDate || task.dueDate;
      let found = false;
      Object.values(tasks).forEach((t: Task) => {
        if (t.isDeleted) return;
        if (t.status === 'completed') return; // ← NUNCA mover completadas
        // subtarea MANUAL del día: su parentTaskId apunta a la INSTANCIA (id) o a la PLANTILLA del
        // contenedor (task.templateId). Antes solo se miraba `=== id` → la que apuntaba a la plantilla se perdía.
        if ((t.parentTaskId === id || (!!task!.templateId && t.parentTaskId === task!.templateId)) && t.dueDate === activeDate) {
          effectiveIds.add(t.id); found = true; return;
        }
        // instancia recurrente del día activo
        if (t.templateId && instanceDate) {
          const tmpl = tasks[t.templateId];
          if (tmpl && tmpl.parentTaskId === id && t.dueDate === activeDate) {
            effectiveIds.add(t.id); found = true; return;
          }
          if (task!.templateId) {
            if (tmpl && tmpl.parentTaskId === task!.templateId && t.dueDate === activeDate) {
              effectiveIds.add(t.id); found = true; return;
            }
          }
        }
      });
      // fallback: subtareas directas pendientes sin fecha (subtareas de templates)
      if (!found && task.subtasks) {
        task.subtasks.forEach((subId: string) => {
          const sub = tasks[subId];
          if (sub && !sub.isDeleted && sub.status !== 'completed') effectiveIds.add(subId);
        });
      }
    } else {
      // §16.34 (a)/(b): una tarea seleccionada SUELTA (hoja) solo entra al bulk si es del DÍA activo y NO está
      // COMPLETADA. Antes entraba cualquiera: `toggleTaskSelection` mete todas las hijas renderizadas del
      // contenedor en `selectedTaskIds`, y aquí caían SIN filtro → se movían/tocaban completadas y de otros
      // días (§16.16: los hechos consumados no se tocan NUNCA). El acotado por día+pendiente que ya hace la
      // rama CONTENEDOR se aplica ahora también a las hijas sueltas.
      if (task.status === 'completed') continue;
      if (task.dueDate && task.dueDate !== activeDate) continue;
      effectiveIds.add(id);
    }
  }
  return { ids: [...effectiveIds], resolved: resolvedById };
}

/**
 * bulkCompletedDirectIds — COMPLETADAS a borrar en un bulk (camino PURO, testeable). Regla: una completada se borra SOLO
 * si la propietaria la marcó DIRECTAMENTE (sola), NO arrastrada por un contenedor seleccionado (cascada → protegida).
 *
 * ⚠️ NO se fía de `parentTaskId` (una hija RECURRENTE lo tiene `null` — el motor re-anida por templateId; ese fue el bug
 * que borró 2 completadas reales, sesión 25). En su lugar reconstruye las HIJAS DEL DÍA de los CONTENEDORES seleccionados
 * (mismo mapeo que `bulkEffectiveIds`: manual por parentTaskId===instancia|plantilla; recurrente por la plantilla de la
 * hija que apunta al contenedor) y protege esas. Una completada fuera de ese conjunto = marcada sola → se borra.
 */
export function bulkCompletedDirectIds(
  selectedIds: Iterable<string>,
  tasks: Record<string, Task>,
  activeDate: string,
  resolve: (id: string) => Task | undefined,
): string[] {
  const sel = new Set(selectedIds);
  const cascadeChildIds = new Set<string>();
  for (const id of sel) {
    const cont = tasks[id] || resolve(id);
    if (!cont || !(cont.subtasks && cont.subtasks.length > 0)) continue; // no es contenedor
    const instanceDate = cont.instanceDate || cont.dueDate;
    Object.values(tasks).forEach((t: Task) => {
      if (!t || t.isDeleted) return;
      if ((t.parentTaskId === id || (!!cont.templateId && t.parentTaskId === cont.templateId)) && t.dueDate === activeDate) {
        cascadeChildIds.add(t.id); return;
      }
      if (t.templateId && instanceDate) {
        const tmpl = tasks[t.templateId];
        if (tmpl && (tmpl.parentTaskId === id || (!!cont.templateId && tmpl.parentTaskId === cont.templateId)) && t.dueDate === activeDate) {
          cascadeChildIds.add(t.id); return;
        }
      }
    });
    (cont.subtasks || []).forEach(sid => cascadeChildIds.add(sid)); // fallback: subtareas directas
  }
  const out: string[] = [];
  for (const id of sel) {
    const t = resolve(id);
    if (t && t.status === 'completed' && !(t.subtasks && t.subtasks.length > 0) && !cascadeChildIds.has(id)) {
      out.push(t.id);
    }
  }
  return out;
}

/**
 * bulkUpdatesForTask — guard del "mover a fecha" en lote (item 2, sesión 19).
 *
 * Una acción masiva que cambia `dueDate` NO debe tocar el `due_date` de una tarea COMPLETADA: mover al
 * futuro algo ya hecho no tiene sentido y es justo lo que aplastaba la historia (§16.17, colapso de fechas).
 * Las PENDIENTES se mueven libres. Solo se filtra `dueDate`; los demás campos del update sí se aplican
 * (p.ej. cambiar tags de una completada sigue funcionando). Escape hatch: mover UNA completada suelta desde
 * su fila (handleUpdateTask) NO pasa por aquí → sigue siendo posible a propósito.
 */
export function bulkUpdatesForTask(updates: Partial<Task>, task: Task | undefined): Partial<Task> {
  if (task && task.status === 'completed' && updates.dueDate !== undefined) {
    const u = { ...updates };
    delete u.dueDate;
    return u;
  }
  return updates;
}

/**
 * bulkUpsertStatusFields — §16.34 (c), REGLA DEL MODELO: ningún camino escribe un estado que no está cambiando
 * A PROPÓSITO. Devuelve los campos de status para el UPSERT de una instancia en `bulkUpdateTasks` SOLO cuando la
 * op cambia status de verdad. Si la op es mover fecha / tiempo / tags / delegar (`updates.status === undefined`),
 * devuelve `{}`: así el upsert NO incluye `status`/`completed_at` → en CONFLICTO PostgREST preserva lo de BD (no
 * reabre una instancia que allí está completada, p.ej. una fuera de ventana resuelta como "virgen" pendiente);
 * en ALTA nueva se usa el default de la columna. Puro y testeable.
 */
export function bulkUpsertStatusFields(updates: Partial<Task>, updatedTask: Task): Record<string, any> {
  if (updates.status === undefined) return {};
  return { status: updatedTask.status, completed_at: updatedTask.completedAt || null };
}

export function useBulkActions({
  tasks,
  setTasks,
  selectedTaskIds,
  setSelectedTaskIds,
  setSelectionMode,
  activeDate,
  timeEntries,
}: UseBulkActionsOptions) {

  const bulkUpdateTasks = useCallback((updates: Partial<Task>) => {
    const timestamp = new Date().toISOString();
    // §16.16 (modelo corregido): un CONTENEDOR nunca recibe una escritura directa de un campo derivado
    // (status, tiempo, etc.); se BAJA a las hijas del día. Antes el `status` era la excepción (se escribía
    // en el propio contenedor) → esa era la segunda fuente de `status:'completed'` en contenedores.
    // C3: resolver instancias recurrentes VÍRGENES (no están en `tasks`) para que entren en el flujo;
    // el path de upsert (más abajo, `templateId && !existsInSupabase`) las materializa como excepción.
    const resolve = createDayResolver(tasks, activeDate);
    // §16.16 + item 6: la selección vive en `bulkEffectiveIds` (helper PURO, testeado — camino real).
    const { ids: effectiveIdList, resolved: resolvedById } = bulkEffectiveIds(selectedTaskIds, tasks, activeDate, resolve);
    const effectiveIds = new Set<string>(effectiveIdList);

    setTasks(prev => {
      const next = { ...prev };
      effectiveIds.forEach(id => {
        const base = next[id] || resolvedById[id]; // C3: materializar el virgen en memoria también
        if (base) next[id] = { ...base, ...bulkUpdatesForTask(updates, base), modifiedAt: timestamp }; // item 2: no re-fechar completadas
      });
      return next;
    });

    setTimeout(() => {
      effectiveIds.forEach(id => {
        const task = tasks[id] || resolvedById[id]; // C3: virgen resuelto → llega al upsert de excepción
        if (!task) return;
        const u = bulkUpdatesForTask(updates, task); // item 2: no re-fechar completadas
        const updatedTask = { ...task, ...u, modifiedAt: timestamp };

        // C3: un virgen resuelto (resolvedById) SIEMPRE se materializa (upsert), aunque su objeto
        // herede `existsInSupabase:true` de la plantilla vía materializeDay — ese flag no distingue
        // "instancia virgen" de "excepción persistida"; el que manda es "¿lo resolví como virgen?".
        const isVirgin = !!resolvedById[id];
        if (task.templateId && (isVirgin || !task.existsInSupabase)) {
          // §16.34 (c) — REGLA DEL MODELO: ningún camino escribe un estado que no está cambiando A PROPÓSITO.
          // Una op de bulk que NO cambia status (mover fecha, tiempo, tags, delegar) NO debe escribir `status`/
          // `completed_at`/`was_recurring` en el upsert: si el id ya existe en BD COMPLETADA (p.ej. fuera de la
          // ventana cargada, resuelta como "virgen" pendiente), incluirlos la REABRÍA. Omitiéndolos, en CONFLICTO
          // PostgREST solo actualiza las columnas presentes (preserva el status/completed_at/was_recurring de BD);
          // en ALTA nueva usan el default de la columna (pending). Solo se escribe status cuando la op lo toca.
          const row: Record<string, any> = {
            id: task.id,
            block_id: task.blockId,
            parent_task_id: null,
            template_id: task.templateId,
            instance_date: task.instanceDate || task.dueDate || null,
            title: task.title,
            notes: task.notes || '',
            priority: 'media',
            due_date: task.dueDate || null,
            due_time: task.dueTime || null,
            estimated_minutes: updatedTask.estimatedMinutes || 0,
            actual_minutes: task.actualMinutes || 0,
            tags: updatedTask.tags || [],
            order: task.order || 0,
            is_template: false,
            is_active: true,
            is_exception: true,
            is_deleted: false,
            is_expanded: task.isExpanded || false,
            task_type: task.taskType || 'core',
            recurrence: null,
            delegation: updatedTask.delegation ?? null,
            created_at: task.createdAt || timestamp,
            modified_at: timestamp,
            // §16.34 (c): status/completed_at SOLO si la op los cambia (si no, se omiten → conflicto preserva BD).
            ...bulkUpsertStatusFields(updates, updatedTask),
          };
          supabase.from('tasks').upsert(row, { onConflict: 'id' }).then(({ error }) => {
            if (error) {
              console.error('[BULK] Error upsert instancia:', task.id, error);
              reportPersistError({ verbo: 'guardar', titulo: task.title });
            } else {
              setTasks(prev => ({
                ...prev,
                [id]: { ...prev[id], existsInSupabase: true, isException: true }
              }));
            }
          });
        } else {
          const supabaseUpdates: Record<string, any> = { modified_at: timestamp };
          if (u.status !== undefined) supabaseUpdates.status = updatedTask.status;
          if (u.completedAt !== undefined) supabaseUpdates.completed_at = updatedTask.completedAt ?? null;
          if (u.dueDate !== undefined) supabaseUpdates.due_date = updatedTask.dueDate ?? null; // item 2: undefined para completadas → no escribe due_date
          if (u.tags !== undefined) supabaseUpdates.tags = updatedTask.tags;
          if (u.estimatedMinutes !== undefined) supabaseUpdates.estimated_minutes = updatedTask.estimatedMinutes;
          if ('delegation' in u) supabaseUpdates.delegation = updatedTask.delegation ?? null;

          persist(supabase.from('tasks').update(supabaseUpdates).eq('id', id), { verbo: 'guardar', titulo: updatedTask.title });
        }
      });
    }, 0);

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
    // #7: activeDate va en las deps — se usa para filtrar las subtareas del día activo al mover
    // un contenedor. Sin ella, el callback quedaba con un activeDate stale al cambiar de día.
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode, activeDate]);

  const bulkDeleteTasks = useCallback(() => {
    const timestamp = new Date().toISOString();
    const resolve = createDayResolver(tasks, activeDate);

    // A3-bulk (sesión 23): el BORRADO usa el MISMO helper que las demás acciones masivas (`bulkEffectiveIds`) en vez
    // de su resolución ad-hoc antigua (que cascadeaba TODAS las hijas y usaba instanceDate). El helper baja los
    // contenedores a sus hijas PENDIENTES del día VISIBLE (`dueDate===activeDate`), excluye completadas y de otros días,
    // y NO incluye el contenedor en sí → se resuelve por sus hijas (si no queda ninguna, el motor lo suprime). Es
    // siempre "QUITA ESTE DÍA", nunca la serie. GUARDA propia del borrado: además, no tocar las que tengan TIEMPO
    // registrado ese día (§16.16: preservar trabajo). → guarda efectiva = pendiente + sin tiempo + no completada.
    // "Terminar la rutina" NO existe en el bulk (Option B, decisión propietaria sesión 23): es decisión por serie,
    // solo desde la fila (⋯→Eliminar→Terminar), donde se ve el nombre. Así el bulk nunca corta N series de un clic.
    const { ids: effectiveIds } = bulkEffectiveIds(selectedTaskIds, tasks, activeDate, resolve);
    const targetIds = effectiveIds.filter(id => getTaskRegisteredSelf(id, timeEntries, activeDate) === 0);

    // (b) sesión 24 + FIX sesión 26 (Parte 2): COMPLETADAS en selección múltiple. El bulk protege las completadas por
    // defecto (bulkEffectiveIds las excluye) porque lo normal es que entren por CASCADA de un contenedor seleccionado y no
    // se ven. PERO una completada que la propietaria marca DIRECTAMENTE (sola, no arrastrada por su contenedor) la eligió a
    // propósito → se borra.
    //
    // ⚠️ EL BUG (sesión 25): distinguíamos "directa" mirando `parentTaskId` (isRootSel). Pero una hija RECURRENTE tiene
    // `parent_task_id = null` (el motor re-anida por templateId) → isRootSel devolvía true SIEMPRE → una completada
    // recurrente arrastrada por su contenedor se trataba como "directa" y se BORRABA (destruyó 2 completadas reales).
    //
    // FIX: no fiarse de `parentTaskId`. Se reconstruye el conjunto de HIJAS DEL DÍA de los CONTENEDORES seleccionados
    // (incluidas las completadas), con el mismo mapeo que `bulkEffectiveIds` (manual: parentTaskId === instancia o
    // plantilla del contenedor; recurrente: la plantilla de la hija apunta al contenedor). Una completada se borra SOLO si
    // NO está en ese conjunto (= la marcaste sola, sin su contenedor). Cascada → protegida; directa → se borra.
    const directCompletedIds = bulkCompletedDirectIds(selectedTaskIds, tasks, activeDate, resolve);

    const allTargetIds = Array.from(new Set([...targetIds, ...directCompletedIds]));

    // (a) sesión 24: CONFIRM INFORMATIVO. El bulk hace SOLO la acción segura (quita del día, nunca la serie) → no
    // pregunta "¿seguro?", INFORMA qué hace. Conteo REAL (allTargetIds), no selectedTaskIds.size (un contenedor cuenta
    // como 1 pero baja a N hijas). El confirm vive AQUÍ (antes en App.tsx/BlocksView con .size) para usar el N verdadero.
    const n = allTargetIds.length;
    if (n === 0) { toast.warn('No hay nada que quitar: las completadas (en cascada) y las series se conservan.'); return; }
    const dayLabel = new Date(activeDate + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!confirm(`Se quitarán ${n} ${n === 1 ? 'tarea' : 'tareas'} del ${dayLabel}. Las series se mantienen.`)) return;

    const realIds = new Set<string>();             // filas reales → UPDATE is_deleted
    const virginObjs: Record<string, Task> = {};   // instancias VÍRGENES → materializar excepción borrada

    const addTarget = (id: string) => {
      if (tasks[id]) { realIds.add(id); return; }
      // No está en estado: ¿excepción persistida? (resolveTaskId; NUNCA la plantilla = borraría la serie).
      const resolvedId = resolveTaskId(id, tasks);
      if (resolvedId !== id && tasks[resolvedId]?.isException) { realIds.add(resolvedId); return; }
      // C3: instancia recurrente VIRGEN → materializar fila-excepción con is_deleted:true (Fase 3).
      // Antes: `UPDATE is_deleted .eq(id)` sobre `inst-…` inexistente = no-op → el borrado no persistía.
      const obj = resolve(id);
      if (obj && obj.templateId) virginObjs[obj.id] = obj;
    };

    allTargetIds.forEach(id => addTarget(id));

    // §16.16 (modelo corregido): "ser contenedor" NO es un estado guardado, se DERIVA de tener hijas.
    // Al vaciar de golpe no hay nada que "degradar": la tarea deja de agruparse como contenedor sola,
    // porque todas las vistas leen subtasks.length, no una marca. No se toca isTemplate ni el status.
    setTasks(prev => {
      const next = { ...prev };
      realIds.forEach(id => { if (next[id]) next[id] = { ...next[id], isDeleted: true, modifiedAt: timestamp }; });
      Object.values(virginObjs).forEach(o => {
        next[o.id] = { ...o, isDeleted: true, isException: true, existsInSupabase: true, modifiedAt: timestamp } as Task;
      });
      return next;
    });

    realIds.forEach(id => {
      persist(supabase.from('tasks').update({ is_deleted: true, modified_at: timestamp }).eq('id', id), { verbo: 'borrar', titulo: tasks[id]?.title });
    });
    Object.values(virginObjs).forEach(o => {
      // A3-bulk: el día de la excepción-borrada = día VISIBLE (activeDate), NO la fecha de la instancia. Una hija
      // movida a hoy tiene instanceDate en su día original → usar instanceDate borraba el día equivocado (bug de día).
      const day = activeDate;
      persist(supabase.from('tasks').upsert({
        id: o.id,
        block_id: o.blockId,
        parent_task_id: null,          // no cuelga de plantilla (evita contaminación); materializeDay ya no la renderiza (findDeletedForDay)
        template_id: o.templateId,
        instance_date: day,
        title: o.title,
        notes: o.notes || '',
        priority: 'media',
        status: o.status || 'pending',
        due_date: day,
        due_time: o.dueTime || null,
        completed_at: o.completedAt || null,
        estimated_minutes: o.estimatedMinutes || 0,
        actual_minutes: o.actualMinutes || 0,
        tags: o.tags || [],
        order: o.order || 0,
        is_template: false,
        is_active: true,
        is_exception: true,
        is_deleted: true,
        is_expanded: o.isExpanded || false,
        task_type: o.taskType || 'core',
        recurrence: null,
        delegation: o.delegation || null,
        created_at: o.createdAt || timestamp,
        modified_at: timestamp,
      }, { onConflict: 'id' }), { verbo: 'borrar', titulo: o.title });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode, activeDate, timeEntries]);

  const bulkDuplicateTasks = useCallback(() => {
    const timestamp = new Date().toISOString();
    const duplicateTaskRecursive = (original: Task, newParentId: string | null = null, isRoot: boolean = true): Task | null => {
      if (!original || original.isDeleted) return null;
      const newId = `t-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        ...original,
        id: newId,
        title: isRoot ? `${original.title} (copia)` : original.title,
        parentTaskId: newParentId,
        // C2: el duplicado nace como tarea SUELTA limpia — corta el vínculo a serie/plantilla,
        // instancia y recurrencia, para que no herede comportamiento recurrente ni se ancle a un día.
        templateId: null,
        instanceDate: null,
        isException: false,
        recurrence: null,
        status: 'pending',
        createdAt: timestamp,
        modifiedAt: timestamp,
        completedAt: undefined,
        subtasks: [],
      };
    };

    // #6: cálculo PURO fuera del updater (leyendo de `tasks`, no de `prev`), para que el
    // updater de setTasks sea puro y StrictMode pueda re-invocarlo SIN duplicar los inserts.
    const duplicates: Task[] = [];                              // filas a insertar (una sola vez)
    const newById: Record<string, Task> = {};                  // duplicados por id (merge al estado)
    const parentSubtaskPatches: Record<string, string[]> = {}; // padre → nuevo array subtasks (solo estado)

    // C2: resolver ids de la selección desde el DÍA MATERIALIZADO (no `tasks` crudo), para poder
    // duplicar contenedores/hijas VÍRGENES (post-flip / fuera de ventana). Perf: materializar cada
    // día implicado UNA sola vez (agrupado por fecha), no una materialización completa por id (§13).
    const dayCache: Record<string, Record<string, Task>> = {};
    const dayMapFor = (day: string): Record<string, Task> => {
      if (!dayCache[day]) {
        const dm: Record<string, Task> = {};
        for (const inst of materializeDay(day, tasks)) dm[inst.id] = inst;
        dayCache[day] = dm;
      }
      return dayCache[day];
    };
    const resolve = (id: string): Task | undefined => {
      if (tasks[id]) return tasks[id];
      const m = id.match(/-(\d{4}-\d{2}-\d{2})$/);
      return dayMapFor(m ? m[1] : activeDate)[id];
    };
    // FK-safe: un padre es destino válido de `parent_task_id` solo si será una FILA real (persistida):
    // tarea real (no `inst-`), o excepción persistida (`inst-` con is_exception). Una instancia
    // GENERADA por useGeneration está en `tasks` pero NO en BD → escribirla = 23503. En ese caso, null.
    const parentIsRealRow = (pid: string | null | undefined): boolean =>
      !!pid && !!tasks[pid] && (!pid.startsWith('inst-') || tasks[pid].isException === true);

    const rootIds = Array.from(selectedTaskIds).filter(id => {
      const task = resolve(id);
      if (!task) return false;
      if (!task.parentTaskId) return true;
      return !selectedTaskIds.has(task.parentTaskId);
    });

    rootIds.forEach(id => {
      const original = resolve(id);
      if (!original || original.isDeleted) return;

      // Raíz suelta y FK-safe: si el padre original no es fila real (virgen/generado), el duplicado
      // sube a top-level (parent null) en vez de colgar de un id inexistente (evita el 23503).
      const effectiveParentId = parentIsRealRow(original.parentTaskId) ? original.parentTaskId! : null;
      const rootDuplicate = duplicateTaskRecursive(original, effectiveParentId);
      if (!rootDuplicate) return;

      newById[rootDuplicate.id] = rootDuplicate;
      duplicates.push(rootDuplicate);

      if (original.subtasks && original.subtasks.length > 0) {
        const newSubtaskIds: string[] = [];
        original.subtasks.forEach(subId => {
          const subOriginal = resolve(subId);
          if (!subOriginal) return;
          const subDuplicate = duplicateTaskRecursive(subOriginal, rootDuplicate.id, false);
          if (!subDuplicate) return;
          newSubtaskIds.push(subDuplicate.id);
          newById[subDuplicate.id] = subDuplicate;
          duplicates.push(subDuplicate);
        });
        rootDuplicate.subtasks = newSubtaskIds;
      }

      if (effectiveParentId) {
        // Inserta el duplicado justo tras el original en el array subtasks del padre. Se acumula
        // por si varias raíces comparten padre. SOLO estado: la jerarquía se persiste por el
        // parent_task_id del duplicado (por eso quitamos el update({subtasks}) muerto = #18).
        const base = parentSubtaskPatches[effectiveParentId] || tasks[effectiveParentId]?.subtasks || [];
        const originalIndex = base.indexOf(original.id);
        const newSubtasks = [...base];
        if (originalIndex >= 0) {
          newSubtasks.splice(originalIndex + 1, 0, rootDuplicate.id);
        } else {
          newSubtasks.push(rootDuplicate.id);
        }
        parentSubtaskPatches[effectiveParentId] = newSubtasks;
      }
    });

    // Updater PURO: solo mezcla los duplicados y los patches de padre en el estado.
    setTasks(prev => {
      const next = { ...prev, ...newById };
      Object.entries(parentSubtaskPatches).forEach(([pid, subs]) => {
        if (next[pid]) next[pid] = { ...next[pid], subtasks: subs };
      });
      return next;
    });

    // C2: insertar SECUENCIAL y en orden PADRE→HIJO (así viene `duplicates`: raíz antes que sus hijas).
    // Con la FK `tasks_parent_task_id_fkey`, insertar una hija (parent = id del nuevo contenedor) antes
    // que su contenedor → 23503. El `forEach` anterior lanzaba todos los inserts en PARALELO (carrera).
    // Fuera del updater = patrón anti-#6 intacto (StrictMode no re-inserta: el cálculo es puro arriba).
    const rowOf = (task: Task) => ({
      id: task.id,
      block_id: task.blockId,
      parent_task_id: task.parentTaskId || null,
      template_id: task.templateId || null,
      instance_date: task.instanceDate || null,
      title: task.title,
      notes: task.notes || '',
      priority: 'media',
      status: task.status,
      due_date: task.dueDate || null,
      due_time: task.dueTime || null,
      completed_at: null,
      estimated_minutes: task.estimatedMinutes || 0,
      actual_minutes: task.actualMinutes || 0,
      total_estimated_combo: task.totalEstimatedCombo || 0,
      total_registered_combo: task.totalRegisteredCombo || 0,
      tags: task.tags || [],
      order: task.order || 0,
      is_template: task.isTemplate || false,
      is_active: task.isActive !== false,
      is_exception: task.isException || false,
      is_deleted: false,
      is_expanded: task.isExpanded || false,
      task_type: task.taskType || 'core',
      recurrence: task.recurrence || null,
      delegation: task.delegation || null,
      created_at: timestamp,
      modified_at: timestamp,
      deleted_at: null,
    });
    (async () => {
      for (const task of duplicates) {
        const { error } = await supabase.from('tasks').insert(rowOf(task));
        if (error) { console.error('[SUPABASE] Error duplicando tarea:', error); reportPersistError({ verbo: 'duplicar', titulo: task.title }); break; }
      }
    })();

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode]);

  return {
    bulkUpdateTasks,
    bulkDeleteTasks,
    bulkDuplicateTasks,
  };
}
