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
import { resolveTaskId, templateIdFromInstanceId, materializeDay, materializeInstanceById } from './instanceEngine';

interface UseTaskCRUDOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  blocks: any[];
  selectedBlockId: string | null;
  activeDate: string;
  setEditingTaskId: (id: string | null) => void;
  setInlineEditingTaskId: (id: string | null) => void;
  setEditingRuleId: (id: string | null) => void;
  setRecurrenceAction: (action: { taskId: string; type: 'edit' | 'delete'; ruleId: string } | null) => void;
  setAddSubtaskWarning: (val: { parentTaskId: string; blockId?: string; overrideDate?: string } | null) => void;
  dashboardTasks: Task[];
}

/** Resuelve un parentTaskId (puede ser inst-xxx-fecha) al templateId real para Supabase */
function resolveParentIdForSupabase(parentTaskId: string | null | undefined): string | null {
  if (!parentTaskId) return null;
  if (!parentTaskId.startsWith('inst-')) return parentTaskId;
  return parentTaskId.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function useTaskCRUD({
  tasks,
  setTasks,
  blocks,
  selectedBlockId,
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
    // Fallback V20: instancia virtual no presente (p.ej. día lejano) → resolver al id REAL
    // (excepción persistida si existe, si no la plantilla/serie) y editar ESE. Si la tarea
    // ya se encontró arriba, effectiveId === taskId → comportamiento idéntico. Solo abre
    // modales: NO cambia cómo se escribe.
    let effectiveId = taskId;
    if (!task) {
      const resolvedId = resolveTaskId(taskId, tasks);
      if (resolvedId !== taskId && tasks[resolvedId]) {
        task = tasks[resolvedId];
        effectiveId = resolvedId;
      }
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
    // Fallback V20: instancia virtual no presente → resolver, SOLO si es una excepción real.
    // NUNCA a la plantilla: borrar la plantilla eliminaría toda la serie. Si la tarea ya se
    // encontró arriba, effectiveId === taskId → comportamiento idéntico. No cambia cómo se borra.
    let effectiveId = taskId;
    if (!task) {
      const resolvedId = resolveTaskId(taskId, tasks);
      const resolved = resolvedId !== taskId ? tasks[resolvedId] : undefined;
      if (resolved && resolved.isException) { task = resolved; effectiveId = resolvedId; }
    }
    // B2: instancia recurrente VIRGEN sin fila ni excepción → materializar para abrir el modal y borrar la
    // ocurrencia. Necesario para las HIJAS: NO están en el array flat `dashboardTasks` (solo top-level), así
    // que el `dashboardTasks.find` de arriba solo resuelve el contenedor; sin esto, borrar una hija virgen es
    // no-op (caía en handleDeleteTask → return). `effectiveId` sigue = taskId (borrar ESA ocurrencia).
    if (!task && taskId.startsWith('inst-')) {
      const materialized = materializeInstanceById(taskId, tasks);
      if (materialized) task = materialized;
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
          priority: t.priority || 'medium',
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
      finalBlockId = selectedBlockId || (blocks.length > 0 ? blocks[0].id : 'b1');
    }

    const newTask: Task = {
      id,
      blockId: finalBlockId,
      title: '',
      notes: '',
      priority: 'media',
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
          priority: newTask.priority,
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

    if (!effectiveParentId) {
      setTimeout(() => setEditingTaskId(id), 50);
    } else {
      setInlineEditingTaskId(id);
    }
    return id;
  }, [tasks, setTasks, blocks, selectedBlockId, activeDate, setEditingTaskId, setInlineEditingTaskId]);

  const handleUpdateTask = useCallback((updatedTask: Task) => {
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

          const newParentId = oldParent.templateId
            ? `inst-${oldParent.templateId}-${newDate}`
            : `inst-${oldParent.id}-${newDate}`;

          const existingNewParent = updated[newParentId];
          const newSubtaskId = `inst-${updatedTask.templateId}-${newDate}`;

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
              templateId: oldParent.templateId || oldParent.id,
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

          updated[updatedTask.id] = { ...updated[updatedTask.id], parentTaskId: realParentTemplateId };

          if (!realParent.subtasks.includes(updatedTask.id)) {
            updated[realParentTemplateId] = {
              ...realParent,
              subtasks: [...realParent.subtasks, updatedTask.id]
            };
          }

          updated[parent.id] = {
            ...parent,
            subtasks: (parent.subtasks || []).filter((id: string) => id !== updatedTask.id)
          };

          setTimeout(() => {
            supabase.from('tasks')
              .update({ parent_task_id: realParentTemplateId })
              .eq('id', updatedTask.id)
              .then(({ error }) => {
                if (error) console.error('[SUPABASE] Error reconectando subtarea al template:', error);
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
        const instanceId = `inst-${updatedTask.id}-${instanceDate}`;
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
            priority: updatedTask.priority || 'media',
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
    setEditingTaskId(null);
    setInlineEditingTaskId(null);

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
          const _newSubtaskId = `inst-${updatedTask.templateId}-${_newDate}`;

          // FIX Bug4: resolver parent_task_id correcto (nunca inst-xxx, siempre templateId)
          const _parentIdForSupabase = resolveParentIdForSupabase(updatedTask.parentTaskId);

          await supabase.from('tasks')
            .update({ is_deleted: true, deleted_at: new Date().toISOString() })
            .eq('id', updatedTask.id);
          const { error: errNew } = await supabase.from('tasks').upsert([{
            id: _newSubtaskId,
            block_id: updatedTask.blockId,
            title: updatedTask.title || '',
            notes: updatedTask.notes || '',
            priority: updatedTask.priority,
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
            parent_task_id: _parentIdForSupabase,  // ← FIX: antes era null siempre
            template_id: updatedTask.templateId,
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
          priority: updatedTask.priority,
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
              priority: t.priority || 'medium',
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
      priority: 'media',
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
