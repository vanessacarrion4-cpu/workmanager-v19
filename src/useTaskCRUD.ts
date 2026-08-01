/**
 * useTaskCRUD.ts
 *
 * Handlers de creación, edición, borrado y toggle de tareas.
 * Extraído de App.tsx para reducir su tamaño.
 *
 * FIX sesión 10: parent_task_id correcto en excepciones al mover fecha de subtarea
 */

import { useCallback } from 'react';
import { Task } from './types';
import { supabase } from './supabaseClient';
import { formatLocalISO } from './dateUtils';
import { resolveTaskId, templateIdFromInstanceId, materializeDay, materializeInstanceById, resolveActionTarget } from './instanceEngine';

interface UseTaskCRUDOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  blocks: any[];
  activeDate: string;
  setEditingTaskId: (id: string | null) => void;
  setInlineEditingTaskId: (id: string | null) => void;
  setEditingRuleId: (id: string | null) => void;
  setRecurrenceAction: (action: { taskId: string; type: 'edit' | 'delete'; ruleId: string } | null) => void;
  setAddSubtaskWarning: (val: { parentTaskId: string; blockId?: string; overrideDate?: string } | null) => void;
  dashboardTasks: Task[];
}

export function useTaskCRUD({
  tasks,
  setTasks,
  blocks,
  activeDate,
  setEditingTaskId,
  setInlineEditingTaskId,
  setEditingRuleId,
  setRecurrenceAction,
  setAddSubtaskWarning,
  dashboardTasks,
}: UseTaskCRUDOptions) {

  const handleEditTaskRequest = useCallback((taskId: string | null) => {
    if (taskId === null) {
      setEditingTaskId(null);
      setInlineEditingTaskId(null);
      return;
    }
    let task = tasks[taskId];
    if (!task) {
      task = dashboardTasks.find(t => t.id === taskId);
      if (task) {
        setTasks(prev => ({ ...prev, [taskId]: task! }));
      }
    }
    // Rescate CENTRALIZADO (resolveActionTarget): excepción persistida movida (NUNCA la plantilla — editarla
    // cambiaría la serie sin avisar) o instancia recurrente VIRGEN materializada (para que `task.templateId`
    // esté presente y salga el modal "¿este día o toda la serie?"). effectiveId = la ocurrencia a editar.
    let effectiveId = taskId;
    if (!task) {
      const resolved = resolveActionTarget(taskId, tasks);
      if (resolved) { task = resolved; effectiveId = resolved.id; }
    }
    if (task?.templateId) {
      setRecurrenceAction({ taskId: effectiveId, type: 'edit', ruleId: task.templateId });
    } else {
      setEditingTaskId(effectiveId);
    }
  }, [tasks, dashboardTasks, setEditingTaskId, setInlineEditingTaskId, setRecurrenceAction, setTasks]);

  const handleDeleteTaskRequest = useCallback((taskId: string) => {
    let task = tasks[taskId];
    if (!task) {
      task = dashboardTasks.find(t => t.id === taskId);
    }
    // Rescate CENTRALIZADO (resolveActionTarget): excepción persistida (NUNCA la plantilla — borrarla
    // eliminaría toda la serie) o instancia VIRGEN materializada. Cubre las HIJAS, que NO están en el
    // array plano `dashboardTasks` (solo top-level). effectiveId = la ocurrencia a borrar.
    let effectiveId = taskId;
    if (!task) {
      const resolved = resolveActionTarget(taskId, tasks);
      if (resolved) { task = resolved; effectiveId = resolved.id; }
    }
    if (task?.parentTaskId && !tasks[task.parentTaskId]) {
      const parentTask = dashboardTasks.find(t => t.id === task!.parentTaskId);
      if (parentTask) {
        setTasks(prev => ({ ...prev, [parentTask.id]: parentTask }));
      }
    }
    if (task?.templateId) {
      setRecurrenceAction({ taskId: effectiveId, type: 'delete', ruleId: task.templateId });
    } else if (task?.isTemplate && (task?.recurrence || (task?.subtasks && task.subtasks.some((subId: string) => tasks[subId]?.recurrence)))) {
      if (confirm(`¿Borrar "${task.title}" y todas sus instancias futuras?`)) {
        handleDeleteTask(effectiveId);
      }
    } else {
      handleDeleteTask(effectiveId);
    }
  }, [tasks, dashboardTasks, setRecurrenceAction, setTasks]);

  const handleToggleStatus = useCallback((taskId: string) => {
    let task = tasks[taskId] || Object.values(tasks).find(t => t.id === taskId);
    // Fallback V20 (a): instancia virtual movida cuyo id de excepción difiere → resolvemos al id
    // REAL solo si es EXCEPCIÓN persistida — nunca la plantilla (tocarla marcaría toda la serie).
    if (!task) {
      const resolvedId = resolveTaskId(taskId, tasks);
      const resolved = resolvedId !== taskId ? tasks[resolvedId] : undefined;
      if (resolved && resolved.isException) task = resolved;
    }
    // Fallback V20 (b) — B1: instancia recurrente VIRGEN (sin fila ni excepción) → materializamos
    // el DÍA una vez y sacamos de ahí el objetivo Y sus hijas (dayMap). Sin esto, un CONTENEDOR
    // virgen upsertaría SOLO el padre (las hijas se buscan con `tasks[sid]`, undefined) y la recarga
    // NO lo delataría. `materializeDay` suprime instancias borradas → `dayMap[taskId]` undefined →
    // no resucita. dayMap se construye FUERA del updater de setTasks (patrón anti-#6).
    let dayMap: Record<string, Task> | null = null;
    if (!task && taskId.startsWith('inst-')) {
      const m = taskId.match(/-(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        dayMap = {};
        for (const inst of materializeDay(m[1], tasks)) dayMap[inst.id] = inst;
        task = dayMap[taskId];
      }
    }
    if (!task) {
      console.error('[STATUS] Tarea no encontrada:', taskId);
      return;
    }
    if (task.isDeleted) return; // guard: no togglear (ni resucitar) una instancia borrada

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const timestamp = new Date().toISOString();
    const tasksToUpsert: Task[] = [];

    const toggleRecursive = (targetTask: Task, status: 'pending' | 'completed') => {
      const isInstance = !!targetTask.templateId;
      const isRecurring = !!(targetTask.templateId || targetTask.recurrence);
      const updated = {
        ...targetTask,
        status,
        isException: isInstance ? true : targetTask.isException,
        existsInSupabase: true,
        modifiedAt: timestamp,
        completedAt: status === 'completed' ? timestamp : undefined,
        wasRecurring: status === 'completed' && isRecurring ? true : targetTask.wasRecurring,
      };
      tasksToUpsert.push(updated);

      if (isInstance && targetTask.templateId && !targetTask.templateId.startsWith('inst-')) {
        const originalTask = tasks[targetTask.templateId];
        if (originalTask && !originalTask.isTemplate) {
          const alreadyAdded = tasksToUpsert.some(t => t.id === originalTask.id);
          if (!alreadyAdded) {
            tasksToUpsert.push({
              ...originalTask,
              status,
              modifiedAt: timestamp,
              completedAt: status === 'completed' ? timestamp : undefined,
            });
          }
        }
      }

      (targetTask.subtasks || []).forEach(sid => {
        // B1: las hijas de un contenedor virgen no están en `tasks` → caen a dayMap (materializado).
        // `tasks[sid]` primero da prioridad a la fila real: una hija con excepción persistida gana
        // sobre el materializado (caso mixto Q2).
        const sub = tasks[sid] || (dayMap ? dayMap[sid] : undefined);
        if (sub) toggleRecursive(sub, status);
      });
    };

    toggleRecursive(task, newStatus);

    setTasks(prev => {
      const next = { ...prev };
      tasksToUpsert.forEach(t => { next[t.id] = t; });
      return next;
    });

    tasksToUpsert.forEach(t => {
      if (t.templateId && t.id.startsWith('inst-')) {
        supabase.from('tasks').upsert({
          id: t.id,
          block_id: t.blockId,
          parent_task_id: null,
          template_id: t.templateId,
          instance_date: t.instanceDate || null,
          title: t.title,
          notes: t.notes || '',
          priority: 'media',
          status: t.status,
          due_date: t.dueDate || null,
          due_time: t.dueTime || null,
          completed_at: t.completedAt || null,
          estimated_minutes: t.estimatedMinutes || 0,
          actual_minutes: t.actualMinutes || 0,
          total_estimated_combo: t.totalEstimatedCombo || 0,
          total_registered_combo: t.totalRegisteredCombo || 0,
          tags: t.tags || [],
          order: t.order || 0,
          is_template: false,
          is_active: true,
          is_exception: true,
          is_deleted: false,
          is_expanded: t.isExpanded || false,
          task_type: t.taskType || 'core',
          recurrence: null,
          delegation: t.delegation || null,
          was_recurring: t.wasRecurring || false,
          created_at: t.createdAt || timestamp,
          modified_at: timestamp,
        }, { onConflict: 'id' }).then(({ error }) => {
          if (error) console.error('[SUPABASE] Error upsert instancia:', t.id, error);
        });
      } else {
        supabase.from('tasks').update({
          status: t.status,
          completed_at: t.completedAt || null,
          modified_at: timestamp
        }).eq('id', t.id).then(({ error }) => {
          if (error) console.error('[SUPABASE] Error update tarea:', t.id, error);
        });
      }
    });
  }, [tasks, setTasks]);

  const handleAddTask = useCallback((parentTaskId: string | null = null, blockId?: string, overrideDate?: string, defaultPersonId?: string) => {
    if (parentTaskId) {
      // Si es instancia recurrente, resolver al template para verificar propiedades
      let parent = tasks[parentTaskId];
      if (!parent && parentTaskId.startsWith('inst-')) {
        // B0: strip robusto (tmpl-/letras), NO el regex /^inst-(t-\d+)/ que fallaba con tmpl-.
        const templateId = templateIdFromInstanceId(parentTaskId);
        if (tasks[templateId]) parent = tasks[templateId];
      }
      if (parent) {
        const hasDate = !!parent.dueDate;
        const hasTag = parent.tags && parent.tags.length > 0;
        const hasRecurrence = !!parent.recurrence;
        const hasTime = !!parent.dueTime;
        const hasDelegation = !!parent.delegation;
        if ((hasDate || hasTag || hasRecurrence || hasTime || hasDelegation) && (!parent.subtasks || parent.subtasks.length === 0)) {
          setAddSubtaskWarning({ parentTaskId, blockId, overrideDate });
          return;
        }
      }
    }
    return doAddTask(parentTaskId, blockId, overrideDate, defaultPersonId);
  }, [tasks, setAddSubtaskWarning]);

  const doAddTask = useCallback((parentTaskId: string | null = null, blockId?: string, overrideDate?: string, defaultPersonId?: string) => {
    const id = `t-${Date.now()}`;
    const timestamp = new Date().toISOString();

    let finalBlockId = blockId;
    let isTemplate = false;

    // Resolver parentTaskId: si es instancia, usar su templateId como padre real
    // Formato: inst-{templateId}-{date} o inst-{templateId}-{subId}-{date}
    let effectiveParentId = parentTaskId;
    if (parentTaskId && parentTaskId.startsWith('inst-') && !tasks[parentTaskId]) {
      // B0: strip robusto (tmpl-/letras), NO el regex /^inst-(t-\d+)/ que fallaba con tmpl-.
      const templateId = templateIdFromInstanceId(parentTaskId);
      if (tasks[templateId]) effectiveParentId = templateId;
    }

    if (effectiveParentId && tasks[effectiveParentId]) {
      const parent = tasks[effectiveParentId];
      if (!finalBlockId) finalBlockId = parent.blockId;
      // Si el parentTaskId original era una instancia (inst-xxx), no heredar isTemplate
      // → la subtarea es manual con fecha, no template
      const cameFromInstance = parentTaskId && parentTaskId !== effectiveParentId;
      isTemplate = cameFromInstance ? false : (parent.isTemplate || false);
    }

    if (!finalBlockId) {
      // FASE 5 (pendiente de decisión): fallback PROVISIONAL a blocks[0]; no está decidido que una tarea sin bloque deba caer en el primer bloque.
      finalBlockId = blocks.length > 0 ? blocks[0].id : 'b1';
    }

    const newTask: Task = {
      id,
      blockId: finalBlockId,
      title: '',
      notes: '',
      status: 'pending',
      dueDate: overrideDate ? overrideDate : (isTemplate ? null : activeDate),
      dueTime: '',
      parentTaskId: effectiveParentId,
      ...(defaultPersonId ? { delegation: { personId: defaultPersonId, delegatedAt: formatLocalISO(new Date()) } } : {}),
      subtasks: [],
      estimatedMinutes: 0,
      tags: [],
      order: 0,
      createdAt: timestamp,
      modifiedAt: timestamp,
      attachments: [],
      isExpanded: true,
      isTemplate
    };

    const updatedTasks = { ...tasks, [id]: newTask };
    if (effectiveParentId && updatedTasks[effectiveParentId]) {
      const isFirstSubtask = (updatedTasks[effectiveParentId].subtasks || []).length === 0;
      updatedTasks[effectiveParentId] = {
        ...updatedTasks[effectiveParentId],
        subtasks: [...(updatedTasks[effectiveParentId].subtasks || []), id],
        isExpanded: true,
        dueDate: isFirstSubtask ? null : updatedTasks[effectiveParentId].dueDate,
        tags: isFirstSubtask ? [] : updatedTasks[effectiveParentId].tags,
        estimatedMinutes: isFirstSubtask ? 0 : updatedTasks[effectiveParentId].estimatedMinutes,
        modifiedAt: timestamp
      };
    }
    setTasks(updatedTasks);

    (async () => {
      try {
        let supabaseParentId = newTask.parentTaskId || null;
        if (supabaseParentId && supabaseParentId.startsWith('inst-')) {
          const parentInstance = tasks[supabaseParentId];
          if (parentInstance?.templateId) {
            supabaseParentId = parentInstance.templateId;
            setTasks(prev => ({
              ...prev,
              [newTask.id]: { ...prev[newTask.id], parentTaskId: supabaseParentId }
            }));
          } else {
            supabaseParentId = null;
          }
        }

        const dbTask = {
          id: newTask.id,
          block_id: newTask.blockId,
          title: newTask.title || '',
          notes: newTask.notes || '',
          priority: 'media',
          on_hold: newTask.onHold ?? false,
          status: newTask.status,
          due_date: newTask.dueDate || null,
          due_time: newTask.dueTime || null,
          estimated_minutes: newTask.estimatedMinutes || 0,
          actual_minutes: newTask.actualMinutes || 0,
          tags: newTask.tags || [],
          order: newTask.order || 0,
          is_template: newTask.isTemplate || false,
          is_active: true,
          is_deleted: false,
          parent_task_id: supabaseParentId,
          template_id: newTask.templateId || null,
          instance_date: newTask.instanceDate || null,
          recurrence: newTask.recurrence || null,
          delegation: newTask.delegation || null,
          created_at: newTask.createdAt,
          modified_at: newTask.modifiedAt
        };

        const { error } = await supabase.from('tasks').insert([dbTask]);
        if (error) throw error;
      } catch (e) {
        console.error('[SUPABASE] Error creating task:', e);
      }
    })();

    // Opción A (sesión 15): crear SIEMPRE abre la edición del título EN LA FILA (no el modal), igual
    // en nivel-1 y en subtareas. El modal solo se abre a petición (botón editar → setEditingTaskId).
    setInlineEditingTaskId(id);
    return id;
  }, [tasks, setTasks, blocks, activeDate, setEditingTaskId, setInlineEditingTaskId]);

  const handleUpdateTask = useCallback((updatedTask: Task, options?: { onHoldOnly?: boolean }) => {
    // Suspender/reactivar ("en suspenso") es un cambio de FLAG y nada más: NUNCA debe re-fechar la
    // instancia ni recrear su id. Antes pasaba por la maquinaria de excepción/reprogramación, que movía
    // la hija al día del contenedor/hoy (id -07-29 → -07-30) → en la vista del día original desaparecía y
    // había que recargar. Y al hacerlo en bucle (9 hijas) el estado se corrompía. Aquí es escritura pura
    // del on_hold conservando id, due_date e instance_date; cada llamada toca su propia fila → compone sin
    // pisarse. (sesión 15)
    if (options?.onHoldOnly) {
      const ts = new Date().toISOString();
      const isInstance = !!updatedTask.templateId || String(updatedTask.id).startsWith('inst-');
      const next: Task = {
        ...updatedTask,
        existsInSupabase: true,
        isException: isInstance ? true : updatedTask.isException,
        modifiedAt: ts,
      };
      setTasks(prev => ({ ...prev, [updatedTask.id]: { ...(prev[updatedTask.id] || {} as Task), ...next } }));

      if (isInstance && updatedTask.templateId && String(updatedTask.id).startsWith('inst-')) {
        // Instancia recurrente: upsert de la excepción CONSERVANDO fecha e id (no se mueve nada).
        supabase.from('tasks').upsert({
          id: updatedTask.id,
          block_id: updatedTask.blockId,
          parent_task_id: null,
          template_id: updatedTask.templateId,
          instance_date: updatedTask.instanceDate || null,
          title: updatedTask.title,
          notes: updatedTask.notes || '',
          priority: 'media',
          status: updatedTask.status,
          due_date: updatedTask.dueDate || null,
          due_time: updatedTask.dueTime || null,
          completed_at: updatedTask.completedAt || null,
          estimated_minutes: updatedTask.estimatedMinutes || 0,
          actual_minutes: updatedTask.actualMinutes || 0,
          total_estimated_combo: updatedTask.totalEstimatedCombo || 0,
          total_registered_combo: updatedTask.totalRegisteredCombo || 0,
          tags: updatedTask.tags || [],
          order: updatedTask.order || 0,
          is_template: false,
          is_active: true,
          is_exception: true,
          is_deleted: false,
          is_expanded: updatedTask.isExpanded || false,
          task_type: updatedTask.taskType || 'core',
          on_hold: updatedTask.onHold ?? false,
          recurrence: null,
          delegation: updatedTask.delegation || null,
          was_recurring: updatedTask.wasRecurring || false,
          created_at: updatedTask.createdAt || ts,
          modified_at: ts,
        }, { onConflict: 'id' }).then(({ error }) => {
          if (error) console.error('[SUPABASE] Error on_hold (instancia):', updatedTask.id, error);
        });
      } else {
        // Tarea real (manual o excepción ya persistida): solo el flag.
        supabase.from('tasks').update({ on_hold: updatedTask.onHold ?? false, modified_at: ts })
          .eq('id', updatedTask.id)
          .then(({ error }) => {
            if (error) console.error('[SUPABASE] Error on_hold:', updatedTask.id, error);
          });
      }
      return;
    }

    const isException = updatedTask.templateId &&
      updatedTask.instanceDate &&
      updatedTask.dueDate !== updatedTask.instanceDate;

    setTasks(prev => {
      const updated = { ...prev };
      const timestamp = new Date().toISOString();

      if (isException && updatedTask.parentTaskId && updatedTask.instanceDate) {
        const newDate = updatedTask.dueDate;
        const oldDate = updatedTask.instanceDate;
        const oldParent = updated[updatedTask.parentTaskId];

        if (oldParent) {
          const newParentSubtasks = (oldParent.subtasks || []).filter(sid => sid !== updatedTask.id);

          if (newParentSubtasks.length === 0 && oldParent.templateId && !oldParent.isException) {
            delete updated[oldParent.id];
          } else {
            updated[oldParent.id] = { ...oldParent, subtasks: newParentSubtasks, modifiedAt: timestamp };
          }

          // Fuga inst-inst-: normalizar SIEMPRE las bases con templateIdFromInstanceId antes de
          // construir ids. Si oldParent/updatedTask ya eran instancias (o su templateId apuntaba a
          // otra instancia), concatenar en crudo generaba `inst-inst-…` y `template_id → instancia`.
          const parentTid = templateIdFromInstanceId(oldParent.templateId || oldParent.id);
          const childTid = templateIdFromInstanceId(updatedTask.templateId);
          const newParentId = `inst-${parentTid}-${newDate}`;

          const existingNewParent = updated[newParentId];
          const newSubtaskId = `inst-${childTid}-${newDate}`;

          if (existingNewParent) {
            updated[newParentId] = {
              ...existingNewParent,
              subtasks: [...(existingNewParent.subtasks || []), newSubtaskId],
              modifiedAt: timestamp
            };
          } else {
            const parentTemplate = oldParent.templateId ? updated[oldParent.templateId] : oldParent;
            updated[newParentId] = {
              ...(parentTemplate || oldParent),
              id: newParentId,
              templateId: parentTid,
              dueDate: newDate,
              instanceDate: newDate,
              isTemplate: false,
              isException: true,
              subtasks: [newSubtaskId],
              status: 'pending',
              modifiedAt: timestamp,
              createdAt: timestamp
            };
          }

          updated[newSubtaskId] = {
            ...updatedTask,
            id: newSubtaskId,
            dueDate: newDate,
            instanceDate: oldDate,
            parentTaskId: newParentId,
            isException: true,
            modifiedAt: timestamp
          };

          delete updated[updatedTask.id];
          return updated;
        }
      }

      updated[updatedTask.id] = {
        ...updatedTask,
        isException: updatedTask.templateId ? true : (isException ? true : updatedTask.isException),
        modifiedAt: timestamp
      };

      if (updatedTask.recurrence && updatedTask.parentTaskId && updated[updatedTask.parentTaskId]) {
        let parent = updated[updatedTask.parentTaskId];

        if (parent.templateId && updated[parent.templateId]) {
          const realParentTemplateId = parent.templateId;
          const realParent = updated[realParentTemplateId];

          // B4-cambio-1: la excepción recurrente NO se reconecta a la PLANTILLA (era la contaminación que
          // alimentaba el bucle inst-inst-). Su parent_task_id queda `null`; materializeDay re-anida por
          // plantilla + templateId/día. Y NO se mete la instancia en `template.subtasks` (corrompía la fuente
          // de verdad de la jerarquía). Scope: solo aquí, dentro del `if (updatedTask.recurrence ...)` →
          // exclusivamente excepciones de instancias recurrentes; las manuales no-recurrentes no entran.
          updated[updatedTask.id] = { ...updated[updatedTask.id], parentTaskId: null };

          updated[parent.id] = {
            ...parent,
            subtasks: (parent.subtasks || []).filter((id: string) => id !== updatedTask.id)
          };

          setTimeout(() => {
            supabase.from('tasks')
              .update({ parent_task_id: null })
              .eq('id', updatedTask.id)
              .then(({ error }) => {
                if (error) console.error('[SUPABASE] Error escribiendo parent_task_id=null (excepción recurrente):', error);
              });
          }, 0);

          parent = realParent;
        }

        if (!parent.isTemplate || parent.dueDate) {
          updated[parent.id] = { ...parent, isTemplate: true, dueDate: null };
          setTimeout(() => {
            supabase.from('tasks')
              .update({ is_template: true, due_date: null })
              .eq('id', parent.id)
              .then(({ error }) => {
                if (error) console.error('[SUPABASE] Error propagando isTemplate al padre:', error);
              });
          }, 0);
        }
      }

      if (
        updatedTask.recurrence &&
        !updatedTask.parentTaskId &&
        !updatedTask.templateId &&
        !updatedTask.isTemplate
      ) {
        const instanceDate = updatedTask.dueDate || formatLocalISO(new Date());
        const instanceId = `inst-${templateIdFromInstanceId(updatedTask.id)}-${instanceDate}`;
        const instanceTimestamp = new Date().toISOString();

        updated[updatedTask.id] = {
          ...updatedTask,
          isTemplate: true,
          dueDate: null,
          dueTime: null,
          modifiedAt: instanceTimestamp
        };

        updated[instanceId] = {
          ...updatedTask,
          id: instanceId,
          templateId: updatedTask.id,
          dueDate: instanceDate,
          instanceDate,
          isTemplate: false,
          isException: true,
          existsInSupabase: true,
          recurrence: null,
          createdAt: instanceTimestamp,
          modifiedAt: instanceTimestamp
        };

        setTimeout(() => {
          supabase.from('tasks')
            .update({
              is_template: true,
              due_date: null,
              due_time: null,
              recurrence: updatedTask.recurrence,
              modified_at: instanceTimestamp
            })
            .eq('id', updatedTask.id)
            .then(({ error }) => {
              if (error) console.error('[SUPABASE] Error convirtiendo a template:', error);
            });

          supabase.from('tasks').upsert({
            id: instanceId,
            block_id: updatedTask.blockId,
            parent_task_id: null,
            template_id: updatedTask.id,
            instance_date: instanceDate,
            title: updatedTask.title,
            notes: updatedTask.notes || '',
            attachments: updatedTask.attachments || [],
            priority: 'media',
            status: updatedTask.status,
            due_date: instanceDate,
            due_time: updatedTask.dueTime || null,
            estimated_minutes: updatedTask.estimatedMinutes || 0,
            actual_minutes: updatedTask.actualMinutes || 0,
            tags: updatedTask.tags || [],
            delegation: updatedTask.delegation || null,
            is_template: false,
            is_active: true,
            is_exception: true,
            is_deleted: false,
            recurrence: null,
            created_at: instanceTimestamp,
            modified_at: instanceTimestamp
          }, { onConflict: 'id' }).then(({ error }) => {
            if (error) console.error('[SUPABASE] Error creando instancia del día:', error);
          });
        }, 0);
      }

      return updated;
    });
    // NO se resetea aquí el estado de edición (editingTaskId / inlineEditingTaskId): guardar NO debe
    // apagar la edición ni cerrar el modal. El modal cierra por su propio onClose (TaskModal.handleSave);
    // la edición inline del título sale en su commit (TaskCard.commitTitle). Antes, este reset por-guardado
    // desmontaba el <input> del título con cada pulsación (se guardaba en cada tecla) → fila inusable.

    (async () => {
      try {
        const _isSubtaskDateChange = !!(
          updatedTask.templateId &&
          updatedTask.instanceDate &&
          updatedTask.dueDate !== updatedTask.instanceDate &&
          updatedTask.parentTaskId
        );
        if (_isSubtaskDateChange) {
          const _newDate = updatedTask.dueDate;
          const _oldDate = updatedTask.instanceDate;
          // Fuga inst-inst- (escritor async/DB): normalizar la base antes de construir el id Y el template_id.
          const _childTid = templateIdFromInstanceId(updatedTask.templateId);
          const _newSubtaskId = `inst-${_childTid}-${_newDate}`;

          // B4-cambio-2: la excepción recurrente MOVIDA NO se enlaza a la plantilla (era el 2º escritor de
          // contaminación parent→plantilla, además del de cambio-1). parent_task_id queda `null`; materializeDay
          // re-anida en el día destino por templateId+dueDate (findLanded). Revierte el "FIX Bug4" (que ponía la
          // plantilla): en V20 el huérfano lo evita materializeDay, no el parent_task_id.
          await supabase.from('tasks')
            .update({ is_deleted: true, deleted_at: new Date().toISOString() })
            .eq('id', updatedTask.id);
          const { error: errNew } = await supabase.from('tasks').upsert([{
            id: _newSubtaskId,
            block_id: updatedTask.blockId,
            title: updatedTask.title || '',
            notes: updatedTask.notes || '',
            priority: 'media',
            status: updatedTask.status,
            due_date: _newDate,
            due_time: updatedTask.dueTime || null,
            completed_at: updatedTask.completedAt || null,
            estimated_minutes: updatedTask.estimatedMinutes || 0,
            actual_minutes: updatedTask.actualMinutes || 0,
            total_estimated_combo: updatedTask.totalEstimatedCombo || 0,
            total_registered_combo: updatedTask.totalRegisteredCombo || 0,
            tags: updatedTask.tags || [],
            order: updatedTask.order || 0,
            is_template: false,
            is_active: true,
            is_exception: true,
            is_deleted: false,
            is_expanded: updatedTask.isExpanded || false,
            task_type: updatedTask.taskType || null,
            parent_task_id: null,  // B4-cambio-2: null (no plantilla); materializeDay re-anida por templateId
            template_id: _childTid,
            instance_date: _oldDate,
            recurrence: null,
            delegation: updatedTask.delegation || null,
            attachments: updatedTask.attachments || [],
            created_at: updatedTask.createdAt || new Date().toISOString(),
            modified_at: new Date().toISOString()
          }], { onConflict: 'id' });
          if (errNew) console.error('[SUPABASE] Error guardando subtarea excepción nueva fecha:', errNew);
          return;
        }

        const isInstance = !!updatedTask.templateId;
        let supabaseParentId = isInstance ? null : (updatedTask.parentTaskId || null);
        if (supabaseParentId && supabaseParentId.startsWith('inst-')) {
          const parentInstance = tasks[supabaseParentId];
          supabaseParentId = parentInstance?.templateId || null;
        }
        const dbTask = {
          id: updatedTask.id,
          block_id: updatedTask.blockId,
          title: updatedTask.title || '',
          notes: updatedTask.notes || '',
          priority: 'media',
          status: updatedTask.status,
          due_date: updatedTask.dueDate || null,
          due_time: updatedTask.dueTime || null,
          completed_at: updatedTask.completedAt || null,
          estimated_minutes: updatedTask.estimatedMinutes || 0,
          actual_minutes: updatedTask.actualMinutes || 0,
          total_estimated_combo: updatedTask.totalEstimatedCombo || 0,
          total_registered_combo: updatedTask.totalRegisteredCombo || 0,
          tags: updatedTask.tags || [],
          order: updatedTask.order || 0,
          is_template: isInstance ? false : (updatedTask.isTemplate || false),
          is_active: updatedTask.isActive !== false,
          is_exception: isInstance ? true : (updatedTask.isException || false),
          is_deleted: updatedTask.isDeleted || false,
          is_expanded: updatedTask.isExpanded,
          on_hold: updatedTask.onHold ?? false,
          task_type: updatedTask.taskType,
          parent_task_id: supabaseParentId,
          template_id: updatedTask.templateId || null,
          instance_date: updatedTask.instanceDate || null,
          recurrence: isInstance ? null : (updatedTask.recurrence || null),
          delegation: updatedTask.delegation || null,
          attachments: updatedTask.attachments || [],
          created_at: updatedTask.createdAt,
          modified_at: new Date().toISOString()
        };

        const { error } = await supabase.from('tasks').upsert([dbTask], { onConflict: 'id' });
        if (error) throw error;
      } catch (e) {
        console.error('[SUPABASE] Error updating task:', e);
      }
    })();
  }, [tasks, setTasks, setEditingTaskId, setInlineEditingTaskId]);

  const handleDeleteTask = useCallback((taskId: string) => {
    const updatedTasks = { ...tasks };
    const task = updatedTasks[taskId];
    if (!task) return;

    if (task.parentTaskId && updatedTasks[task.parentTaskId]) {
      updatedTasks[task.parentTaskId] = {
        ...updatedTasks[task.parentTaskId],
        subtasks: updatedTasks[task.parentTaskId].subtasks.filter(id => id !== taskId)
      };
    }

    const removeRecursive = (id: string) => {
      const t = updatedTasks[id];
      if (!t) return;
      t.subtasks.forEach(sid => removeRecursive(sid));
      delete updatedTasks[id];
    };

    const idsToDelete: Task[] = [];
    const collectRecursive = (id: string) => {
      const t = updatedTasks[id];
      if (!t) return;
      idsToDelete.push(t);
      t.subtasks.forEach(sid => collectRecursive(sid));
    };
    collectRecursive(taskId);

    if (task.isTemplate && !task.templateId) {
      Object.values(updatedTasks).forEach((t: Task) => {
        if (!t || idsToDelete.find(d => d.id === t.id)) return;
        if (t.templateId === taskId) {
          idsToDelete.push(t);
        }
        if (t.templateId) {
          const tTemplate = updatedTasks[t.templateId];
          if (tTemplate && tTemplate.parentTaskId === taskId) {
            idsToDelete.push(t);
          }
        }
      });
    }

    removeRecursive(taskId);
    idsToDelete.forEach(t => {
      if (t.id !== taskId) delete updatedTasks[t.id];
    });
    setTasks(updatedTasks);

    (async () => {
      const timestamp = new Date().toISOString();
      for (const t of idsToDelete) {
        try {
          if (t.templateId) {
            await supabase.from('tasks').upsert({
              id: t.id,
              block_id: t.blockId,
              parent_task_id: null,
              template_id: t.templateId,
              instance_date: t.instanceDate || null,
              title: t.title,
              notes: t.notes || '',
              priority: 'media',
              status: t.status,
              due_date: t.dueDate || null,
              due_time: t.dueTime || null,
              completed_at: t.completedAt || null,
              estimated_minutes: t.estimatedMinutes || 0,
              actual_minutes: t.actualMinutes || 0,
              tags: t.tags || [],
              delegation: t.delegation || null,
              is_template: false,
              is_exception: true,
              is_deleted: true,
              deleted_at: timestamp,
              is_active: false,
              created_at: t.createdAt || timestamp,
              modified_at: timestamp
            }, { onConflict: 'id' });
          } else {
            await supabase.from('tasks')
              .update({ is_deleted: true, deleted_at: timestamp })
              .eq('id', t.id);
          }
        } catch (e) {
          console.error('[SUPABASE] Error borrando:', t.id, e);
        }
      }
    })();
  }, [tasks, setTasks]);

  const handleAddRule = useCallback((blockId?: string) => {
    const id = `tmpl-${Date.now()}`;
    const newTemplate: Task = {
      id,
      blockId: blockId || (blocks.length > 0 ? blocks[0].id : 'b1'),
      title: '',
      notes: '',
      status: 'pending',
      dueDate: null,
      subtasks: [],
      estimatedMinutes: 0,
      tags: [],
      order: 0,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      isTemplate: true,
      isActive: true
    };
    setTasks(prev => ({ ...prev, [id]: newTemplate }));
    setEditingRuleId(id);
  }, [blocks, setTasks, setEditingRuleId]);

  return {
    handleEditTaskRequest,
    handleDeleteTaskRequest,
    handleToggleStatus,
    handleAddTask,
    doAddTask,
    handleUpdateTask,
    handleDeleteTask,
    handleAddRule,
  };
}
