/**
 * useTaskOrdering.ts
 *
 * Handlers de ordenación, jerarquía (promover/degradar), expandir y navegación a template.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { Task } from './types';
import { supabase } from './supabaseClient';
import { materializeDay, templateIdFromInstanceId } from './instanceEngine';
import { persist, reportPersistError } from './persist'; // Avisos (B1): escrituras que fallan avisan
import { toast } from './toast'; // Avisos (B1): no-op silencioso (no se puede promover/degradar) deja de ser mudo

/**
 * B5a: fila-excepción (mismo shape validado en cambio-2, useTaskCRUD) para MATERIALIZAR una
 * instancia recurrente virtual como fila REAL antes de que un `parent_task_id` la referencie.
 * Sin la fila real, el FK `tasks_parent_task_id_fkey` rechaza la escritura → 23503 SILENCIOSO.
 */
function buildExceptionRow(obj: Task, day: string, parentId: string | null, timestamp: string) {
  return {
    id: obj.id,
    block_id: obj.blockId,
    title: obj.title || '',
    notes: obj.notes || '',
    priority: 'media',
    status: obj.status || 'pending',
    due_date: day,
    due_time: obj.dueTime || null,
    completed_at: obj.completedAt || null,
    estimated_minutes: obj.estimatedMinutes || 0,
    actual_minutes: obj.actualMinutes || 0,
    total_estimated_combo: obj.totalEstimatedCombo || 0,
    total_registered_combo: obj.totalRegisteredCombo || 0,
    tags: obj.tags || [],
    order: obj.order || 0,
    is_template: false,
    is_active: true,
    is_exception: true,
    is_deleted: false,
    is_expanded: obj.isExpanded || false,
    task_type: obj.taskType || 'core', // #6 tapar fuga: ningún camino deja task_type null (default core)
    parent_task_id: parentId,
    template_id: obj.templateId || templateIdFromInstanceId(obj.id),
    instance_date: day,
    recurrence: null,
    delegation: obj.delegation || null,
    attachments: obj.attachments || [],
    created_at: obj.createdAt || timestamp,
    modified_at: timestamp,
  };
}

interface UseTaskOrderingOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  setCurrentView: (view: any) => void;
  setHighlightTaskId: (id: string | null) => void;
}

export function useTaskOrdering({
  tasks,
  setTasks,
  setCurrentView,
  setHighlightTaskId,
}: UseTaskOrderingOptions) {

  const handleUpdateTasksOrder = useCallback((orderedTasks: Task[]) => {
    const updated = { ...tasks };
    orderedTasks.forEach((t, i) => {
      updated[t.id] = { ...updated[t.id], order: i, modifiedAt: new Date().toISOString() };
    });
    setTasks(updated);
    orderedTasks.forEach((t, i) => {
      const dbId = t.id.startsWith('inst-') ? (t.templateId || t.id) : t.id;
      persist(supabase.from('tasks').update({ order: i }).eq('id', dbId), { verbo: 'guardar', titulo: t.title });
    });
  }, [tasks, setTasks]);

  const handleUpdateSubtasksOrder = useCallback((parentId: string, subtaskIds: string[]) => {
    setTasks(prev => {
      const existing = prev[parentId];
      if (!existing) {
        console.warn('[ORDER] parentId not found in tasks:', parentId);
        return prev;
      }
      const updated = { ...prev };
      // A (sesión 19): FUSIONAR, no reemplazar. `subtaskIds` son solo las hijas VISIBLES reordenadas (en Bloques,
      // p.ej. las 4 reglas; las completadas/ocultas no vienen). Se intercalan en los huecos visibles del array
      // completo, conservando las ocultas en su sitio → no se pierden las completadas del estado.
      const existingSubs = existing.subtasks || [];
      const visSet = new Set(subtaskIds);
      let vi = 0;
      const merged = existingSubs.map((id: string) => (visSet.has(id) ? subtaskIds[vi++] : id));
      for (const id of subtaskIds) if (!existingSubs.includes(id)) merged.push(id); // defensivo: ids nuevos
      updated[parentId] = {
        ...existing,
        subtasks: merged,
        modifiedAt: new Date().toISOString()
      };
      // order: solo a las visibles reordenadas (no re-escribir order de las ocultas — evita tocar 132 completadas).
      subtaskIds.forEach((subId, order) => {
        if (updated[subId]) {
          updated[subId] = { ...updated[subId], order };
        }
      });
      return updated;
    });

    // Bug #18 RESUELTO (sesión 19): se elimina el `update({ subtasks })`. La columna `subtasks` NO existe
    // en la tabla (`subtasks` se RECONSTRUYE en carga desde `parent_task_id`), así que esa escritura SIEMPRE
    // devolvía 400 (PGRST204) — un fallo mudo e inútil. El orden de subtareas ya PERSISTE por el `order` de
    // cada hija (abajo): en carga, `reconstructHierarchy` ordena el array por ese `order`. No se pierde nada.
    // GAP ADYACENTE (distinto, aparcado en §16.17): los contenedores RECURRENTES usan
    // `reconstructInstanceHierarchy`, que NO ordena por `order` → reordenar sus hijas puede no sobrevivir a
    // una recarga. Es un cambio de la reconstrucción en carga, no de aquí.
    subtaskIds.forEach((subId, order) => {
      const sub = tasks[subId];
      if (!sub) return;
      const dbId = subId.startsWith('inst-') ? (sub.templateId || subId) : subId;
      persist(supabase.from('tasks').update({ order }).eq('id', dbId), { verbo: 'guardar', titulo: sub.title });
    });
  }, [tasks, setTasks]);

  const handleGoToTemplate = useCallback((templateId: string) => {
    const targetTask = tasks[templateId];
    if (!targetTask) return;

    if (targetTask.parentTaskId) {
      const parent = tasks[targetTask.parentTaskId];
      if (parent && !parent.isExpanded) {
        const timestamp = new Date().toISOString();
        setTasks(prev => ({
          ...prev,
          [targetTask.parentTaskId!]: { ...prev[targetTask.parentTaskId!], isExpanded: true, modifiedAt: timestamp }
        }));
        persist(supabase.from('tasks').update({ is_expanded: true, modified_at: timestamp })
          .eq('id', targetTask.parentTaskId), { verbo: 'guardar', titulo: parent.title });
      }
    }

    setCurrentView('blocks');
    setHighlightTaskId(templateId);
    setTimeout(() => setHighlightTaskId(null), 4000);
  }, [tasks, setTasks, setCurrentView, setHighlightTaskId]);

  const handleToggleExpandTask = useCallback((taskId: string) => {
    const timestamp = new Date().toISOString();
    const task = tasks[taskId];
    if (!task) return;

    const newExpanded = task.isExpanded !== undefined ? !task.isExpanded : true;

    setTasks(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], isExpanded: newExpanded, modifiedAt: timestamp }
    }));

    persist(supabase.from('tasks').update({
      is_expanded: newExpanded,
      modified_at: timestamp
    }).eq('id', taskId), { verbo: 'guardar', titulo: task.title });
  }, [tasks, setTasks]);

  const handleExpandAllInBlock = useCallback((blockId: string, expand: boolean) => {
    const updatedTasks = { ...tasks };
    Object.values(updatedTasks).forEach((t: Task) => {
      if (t.blockId === blockId) {
        t.isExpanded = expand;
      }
    });
    setTasks(updatedTasks);
  }, [tasks, setTasks]);

  const handlePromoteTask = useCallback((taskId: string) => {
    // #1: calcular el nuevo padre (el abuelo) FUERA del updater para poder persistirlo.
    // Va fuera y no dentro de setTasks a propósito: bajo StrictMode el updater corre 2×,
    // así que la escritura a Supabase no puede vivir ahí (patrón anti-#6).
    const outerTask = tasks[taskId];
    if (!outerTask) { toast.warn('No encuentro esa tarea para subirla de nivel.'); return; }
    if (!outerTask.parentTaskId) { toast.warn('Esta tarea ya está en el nivel superior.'); return; }
    const outerParent = tasks[outerTask.parentTaskId];
    if (!outerParent) return;
    const grandParentId = outerParent.parentTaskId || null;
    const timestamp = new Date().toISOString();

    setTasks(prev => {
      const task = prev[taskId];
      if (!task || !task.parentTaskId) return prev;

      const parentTask = prev[task.parentTaskId];
      if (!parentTask) return prev;
      const grandParentId = parentTask.parentTaskId || null;

      const newTasks = { ...prev };

      newTasks[parentTask.id] = {
        ...parentTask,
        subtasks: parentTask.subtasks.filter(sid => sid !== taskId),
        modifiedAt: timestamp
      };

      if (grandParentId && newTasks[grandParentId]) {
        const grandParent = newTasks[grandParentId];
        const parentIdx = grandParent.subtasks.indexOf(parentTask.id);
        const newSubtasks = [...grandParent.subtasks];
        newSubtasks.splice(parentIdx + 1, 0, taskId);
        newTasks[grandParentId] = {
          ...grandParent,
          subtasks: newSubtasks,
          modifiedAt: timestamp
        };
      }

      newTasks[taskId] = {
        ...task,
        parentTaskId: grandParentId,
        modifiedAt: timestamp
      };

      return newTasks;
    });

    // #1: persistir SOLO el nuevo padre de la fila movida. NO se escribe `subtasks`
    // (columna inexistente = #18; la jerarquía se reconstruye desde parent_task_id al cargar).
    // .eq('id', taskId) sin resolver a templateId: si es una instancia virgen (inst-…) esto
    // es no-op a propósito (materializar excepción = Fase 3).
    persist(supabase.from('tasks')
      .update({ parent_task_id: grandParentId, modified_at: timestamp })
      .eq('id', taskId), { verbo: 'mover', titulo: outerTask.title });
  }, [tasks, setTasks]);

  const handleDemoteTask = useCallback((taskId: string) => {
    // Tope de 2 niveles (modelo contenedor+hijas; hoy no hay ninguna tarea en nivel 3 — verificado en datos).
    // Degradar solo vale para una tarea de nivel-1 SIN hijas: si ya es hija (parentTaskId) pasaria a nivel-3,
    // y si es un contenedor con hijas, las arrastraria a nivel-3. En ambos casos se aborta.
    {
      const st = tasks[taskId];
      if (!st || st.parentTaskId || (st.subtasks || []).some((sid: string) => tasks[sid] && !tasks[sid].isDeleted)) return;
    }
    // ── B5a: degradar una tarea ONE-OFF dentro de un contenedor recurrente (instancia VIRTUAL) ──
    // El nuevo padre visible (hermano de arriba en el DÍA MATERIALIZADO — lo que ve la usuaria, no
    // `tasks` crudo) puede ser `inst-K-D`, una instancia que NO existe como fila. Escribir
    // `parent_task_id=inst-K-D` hoy → FK `tasks_parent_task_id_fkey` → 23503 SILENCIOSO (se pierde al
    // recargar). Fix (patrón materializar-al-escribir de B1/B2/B4): materializar el contenedor como fila
    // real y apuntar el one-off a esa instancia (anida solo ese día vía getVisibleSubtasksForDay CASO 2).
    // Solo one-off: un sujeto recurrente (con templateId) anida por PLANTILLA (CASO 1) → reestructura de
    // serie = B5b, no per-día. El resto de casos caen al cuerpo original INTACTO (cero regresión #1).
    {
      const subject = tasks[taskId];
      if (subject && !subject.templateId && !subject.isTemplate && !subject.parentTaskId && subject.dueDate) {
        const day = subject.dueDate;
        const dayMap: Record<string, Task> = {};
        for (const inst of materializeDay(day, tasks)) dayMap[inst.id] = inst;
        for (const t of Object.values(tasks)) { if (!t.isDeleted) dayMap[t.id] = t; } // estado gana
        const sibs = (Object.values(dayMap) as Task[])
          .filter(t => !t.parentTaskId && t.blockId === subject.blockId && !t.isTemplate && !t.isDeleted
            // SOLO items de ESTE día: una fila/instancia con fecha cuenta si es de hoy; un contenedor
            // manual sin fecha, solo si tiene ≥1 hija de hoy. (Un `subtasks.length>0` a secas arrastraba
            // instancias de OTROS días —tienen dueDate≠day pero subtasks>0—, contaminando el "hermano de arriba".)
            && (t.dueDate === day
                || (!t.dueDate && (t.subtasks || []).some(sid => dayMap[sid] && !dayMap[sid].isDeleted && dayMap[sid].dueDate === day))))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(t => t.id);
        const i = sibs.indexOf(taskId);
        if (i > 0) {
          const aboveId = sibs[i - 1];
          const above = dayMap[aboveId];
          const parentVirtual = aboveId.startsWith('inst-') && !tasks[aboveId];
          if (parentVirtual && above && above.templateId) {
            const ts = new Date().toISOString();
            // Estado optimista: el one-off cuelga del contenedor; activeDayMap/CASO 2 lo anida ese día.
            setTasks(prev => {
              const t = prev[taskId];
              if (!t) return prev;
              return { ...prev, [taskId]: { ...t, parentTaskId: aboveId, modifiedAt: ts } };
            });
            // Persistencia FUERA del updater (anti-#6/StrictMode). Orden: PADRE primero (FK), luego el hijo.
            (async () => {
              const { error: eP } = await supabase.from('tasks')
                .upsert([buildExceptionRow({ ...above, isExpanded: true }, day, null, ts)], { onConflict: 'id' });
              if (eP) { console.error('[DEMOTE-B5a] Error materializando contenedor destino:', eP); reportPersistError({ verbo: 'mover', titulo: subject.title }); return; }
              const { error: eS } = await supabase.from('tasks')
                .update({ parent_task_id: aboveId, modified_at: ts }).eq('id', taskId);
              if (eS) { console.error('[DEMOTE-B5a] Error persistiendo parent_task_id del one-off:', eS); reportPersistError({ verbo: 'mover', titulo: subject.title }); }
            })();
            return;
          }
        }
      }
    }

    // #1: calcular el hermano de arriba (el nuevo padre) FUERA del updater para persistirlo.
    // Mismo motivo que en promote: la escritura no puede vivir dentro de setTasks (StrictMode 2×).
    const outerTask = tasks[taskId];
    if (!outerTask) return;

    let outerSiblingIds: string[] = [];
    if (outerTask.parentTaskId && tasks[outerTask.parentTaskId]) {
      outerSiblingIds = tasks[outerTask.parentTaskId].subtasks || [];
    } else {
      outerSiblingIds = (Object.values(tasks) as Task[])
        .filter(t => !t.parentTaskId && t.blockId === outerTask.blockId && !t.isTemplate && !t.isDeleted)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(t => t.id);
    }
    const outerIdx = outerSiblingIds.indexOf(taskId);
    if (outerIdx <= 0) { toast.warn('No hay ninguna tarea encima bajo la que colocar esta.'); return; }
    const aboveTaskId = outerSiblingIds[outerIdx - 1];
    if (!tasks[aboveTaskId]) { toast.warn('No hay una tarea encima válida bajo la que colocar esta.'); return; }
    const timestamp = new Date().toISOString();

    setTasks(prev => {
      const task = prev[taskId];
      if (!task) return prev;

      let siblingIds: string[] = [];
      if (task.parentTaskId && prev[task.parentTaskId]) {
        siblingIds = prev[task.parentTaskId].subtasks || [];
      } else {
        siblingIds = (Object.values(prev) as Task[])
          .filter(t => !t.parentTaskId && t.blockId === task.blockId && !t.isTemplate && !t.isDeleted)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(t => t.id);
      }

      const idx = siblingIds.indexOf(taskId);
      if (idx <= 0) return prev;

      const aboveTaskId = siblingIds[idx - 1];
      const aboveTask = prev[aboveTaskId];
      if (!aboveTask) return prev;

      const newTasks = { ...prev };

      if (task.parentTaskId && newTasks[task.parentTaskId]) {
        const parent = newTasks[task.parentTaskId];
        newTasks[task.parentTaskId] = {
          ...parent,
          subtasks: (parent.subtasks || []).filter(sid => sid !== taskId),
          modifiedAt: timestamp
        };
      }

      newTasks[aboveTaskId] = {
        ...aboveTask,
        subtasks: [...(aboveTask.subtasks || []), taskId],
        isExpanded: true,
        modifiedAt: timestamp
      };

      newTasks[taskId] = {
        ...task,
        parentTaskId: aboveTaskId,
        modifiedAt: timestamp
      };

      return newTasks;
    });

    // #1: persistir SOLO el nuevo padre de la fila movida. NO se escribe `subtasks` (#18).
    // .eq('id', taskId) sin resolver: instancia virgen (inst-…) → no-op a propósito (Fase 3).
    persist(supabase.from('tasks')
      .update({ parent_task_id: aboveTaskId, modified_at: timestamp })
      .eq('id', taskId), { verbo: 'mover', titulo: outerTask.title });
  }, [tasks, setTasks]);

  return {
    handleUpdateTasksOrder,
    handleUpdateSubtasksOrder,
    handleGoToTemplate,
    handleToggleExpandTask,
    handleExpandAllInBlock,
    handlePromoteTask,
    handleDemoteTask,
  };
}
