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
import { persist, reportPersistError } from './persist'; // Avisos (B1): escrituras que fallan avisan (agrupadas por lote)

interface UseBulkActionsOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  selectedTaskIds: Set<string>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeDate: string;
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
      effectiveIds.add(id);
    }
  }
  return { ids: [...effectiveIds], resolved: resolvedById };
}

export function useBulkActions({
  tasks,
  setTasks,
  selectedTaskIds,
  setSelectedTaskIds,
  setSelectionMode,
  activeDate,
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
        if (base) next[id] = { ...base, ...updates, modifiedAt: timestamp };
      });
      return next;
    });

    setTimeout(() => {
      effectiveIds.forEach(id => {
        const task = tasks[id] || resolvedById[id]; // C3: virgen resuelto → llega al upsert de excepción
        if (!task) return;
        const updatedTask = { ...task, ...updates, modifiedAt: timestamp };

        // C3: un virgen resuelto (resolvedById) SIEMPRE se materializa (upsert), aunque su objeto
        // herede `existsInSupabase:true` de la plantilla vía materializeDay — ese flag no distingue
        // "instancia virgen" de "excepción persistida"; el que manda es "¿lo resolví como virgen?".
        const isVirgin = !!resolvedById[id];
        if (task.templateId && (isVirgin || !task.existsInSupabase)) {
          supabase.from('tasks').upsert({
            id: task.id,
            block_id: task.blockId,
            parent_task_id: null,
            template_id: task.templateId,
            instance_date: task.instanceDate || task.dueDate || null,
            title: task.title,
            notes: task.notes || '',
            priority: 'media',
            status: updatedTask.status,
            due_date: task.dueDate || null,
            due_time: task.dueTime || null,
            completed_at: updatedTask.completedAt || null,
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
          }, { onConflict: 'id' }).then(({ error }) => {
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
          if (updates.status !== undefined) supabaseUpdates.status = updatedTask.status;
          if (updates.completedAt !== undefined) supabaseUpdates.completed_at = updatedTask.completedAt ?? null;
          if (updates.dueDate !== undefined) supabaseUpdates.due_date = updatedTask.dueDate ?? null;
          if (updates.tags !== undefined) supabaseUpdates.tags = updatedTask.tags;
          if (updates.estimatedMinutes !== undefined) supabaseUpdates.estimated_minutes = updatedTask.estimatedMinutes;
          if ('delegation' in updates) supabaseUpdates.delegation = updatedTask.delegation ?? null;

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

    selectedTaskIds.forEach(id => {
      addTarget(id);
      const obj = tasks[id] || resolve(id);
      if (obj?.subtasks?.length) obj.subtasks.forEach((subId: string) => addTarget(subId));
    });

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
      const day = o.instanceDate || o.dueDate || activeDate;
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
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode, activeDate]);

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
