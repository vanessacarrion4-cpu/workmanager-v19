/**
 * useBulkActions.ts
 *
 * Handlers de acciones masivas: actualizar, borrar y duplicar tareas seleccionadas.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { Task } from './types';
import { supabase } from './supabaseClient';
import { resolveTaskId } from './instanceEngine';

interface UseBulkActionsOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  selectedTaskIds: Set<string>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeDate: string;
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
    const isContainerSafeUpdate = updates.status !== undefined;

    const effectiveIds = new Set<string>();
    selectedTaskIds.forEach(id => {
      const task = tasks[id];
      if (!task) return;
      const isContainer = task.subtasks && task.subtasks.length > 0;
      if (isContainer && !isContainerSafeUpdate) {
        // Solo subtareas pendientes del día activo — nunca completadas ni de otro día
        const instanceDate = task.instanceDate || task.dueDate;
        let found = false;
        Object.values(tasks).forEach((t: Task) => {
          if (t.isDeleted) return;
          if (t.status === 'completed') return; // ← NUNCA mover completadas
          // subtarea directa del día activo
          if (t.parentTaskId === id && t.dueDate === activeDate) {
            effectiveIds.add(t.id); found = true; return;
          }
          // instancia recurrente del día activo
          if (t.templateId && instanceDate) {
            const tmpl = tasks[t.templateId];
            if (tmpl && tmpl.parentTaskId === id && t.dueDate === activeDate) {
              effectiveIds.add(t.id); found = true; return;
            }
            if (task.templateId) {
              if (tmpl && tmpl.parentTaskId === task.templateId && t.dueDate === activeDate) {
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
    });

    setTasks(prev => {
      const next = { ...prev };
      effectiveIds.forEach(id => {
        if (next[id]) {
          next[id] = { ...next[id], ...updates, modifiedAt: timestamp };
        }
      });
      return next;
    });

    setTimeout(() => {
      effectiveIds.forEach(id => {
        const task = tasks[id];
        if (!task) return;
        const updatedTask = { ...task, ...updates, modifiedAt: timestamp };

        if (task.templateId && !task.existsInSupabase) {
          supabase.from('tasks').upsert({
            id: task.id,
            block_id: task.blockId,
            parent_task_id: null,
            template_id: task.templateId,
            instance_date: task.instanceDate || task.dueDate || null,
            title: task.title,
            notes: task.notes || '',
            priority: task.priority || 'media',
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

          supabase.from('tasks').update(supabaseUpdates).eq('id', id).then(({ error }) => {
            if (error) console.error('[BULK] Error update tarea:', id, error);
          });
        }
      });
    }, 0);

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode]);

  const bulkDeleteTasks = useCallback(() => {
    const timestamp = new Date().toISOString();

    const effectiveIds = new Set<string>();
    selectedTaskIds.forEach(id => {
      let task = tasks[id];
      let effId = id;
      // Fallback V20: si la instancia virtual no está en el estado, resolver al id REAL.
      // SOLO si es una excepción persistida — nunca la plantilla (borrar la plantilla borraría
      // la serie entera). No cambia cómo se borra: mismo UPDATE is_deleted sobre el id resuelto.
      if (!task) {
        const resolvedId = resolveTaskId(id, tasks);
        const resolved = resolvedId !== id ? tasks[resolvedId] : undefined;
        if (resolved && resolved.isException) { task = resolved; effId = resolvedId; }
      }
      if (!task) return;
      effectiveIds.add(effId);
      if (task.subtasks && task.subtasks.length > 0) {
        task.subtasks.forEach((subId: string) => {
          const sub = tasks[subId];
          if (sub && !sub.isDeleted) effectiveIds.add(subId);
        });
      }
    });

    setTasks(prev => {
      const next = { ...prev };
      effectiveIds.forEach(id => {
        if (next[id]) {
          next[id] = { ...next[id], isDeleted: true, modifiedAt: timestamp };
        }
      });
      return next;
    });

    effectiveIds.forEach(id => {
      supabase.from('tasks').update({
        is_deleted: true,
        modified_at: timestamp
      }).eq('id', id).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error bulk delete:', error);
      });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode]);

  const bulkDuplicateTasks = useCallback(() => {
    const timestamp = new Date().toISOString();
    const duplicates: Task[] = [];

    const duplicateTaskRecursive = (original: Task, newParentId: string | null = null, isRoot: boolean = true): Task | null => {
      if (!original || original.isDeleted) return null;
      const newId = `t-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        ...original,
        id: newId,
        title: isRoot ? `${original.title} (copia)` : original.title,
        parentTaskId: newParentId,
        status: 'pending',
        createdAt: timestamp,
        modifiedAt: timestamp,
        completedAt: undefined,
        subtasks: [],
      };
    };

    setTasks(prev => {
      const next = { ...prev };

      const rootIds = Array.from(selectedTaskIds).filter(id => {
        const task = prev[id];
        if (!task) return false;
        if (!task.parentTaskId) return true;
        return !selectedTaskIds.has(task.parentTaskId);
      });

      rootIds.forEach(id => {
        const original = prev[id];
        if (!original || original.isDeleted) return;

        const effectiveParentId = original.parentTaskId || null;
        const rootDuplicate = duplicateTaskRecursive(original, effectiveParentId);
        if (!rootDuplicate) return;

        next[rootDuplicate.id] = rootDuplicate;
        duplicates.push(rootDuplicate);

        if (original.subtasks && original.subtasks.length > 0) {
          const newSubtaskIds: string[] = [];
          original.subtasks.forEach(subId => {
            const subOriginal = prev[subId];
            if (!subOriginal) return;
            const subDuplicate = duplicateTaskRecursive(subOriginal, rootDuplicate.id, false);
            if (!subDuplicate) return;
            newSubtaskIds.push(subDuplicate.id);
            next[subDuplicate.id] = subDuplicate;
            duplicates.push(subDuplicate);
          });
          rootDuplicate.subtasks = newSubtaskIds;
          next[rootDuplicate.id] = rootDuplicate;
        }

        if (effectiveParentId && next[effectiveParentId]) {
          const parentTask = next[effectiveParentId];
          const currentSubtasks = parentTask.subtasks || [];
          const originalIndex = currentSubtasks.indexOf(original.id);
          const newSubtasks = [...currentSubtasks];
          if (originalIndex >= 0) {
            newSubtasks.splice(originalIndex + 1, 0, rootDuplicate.id);
          } else {
            newSubtasks.push(rootDuplicate.id);
          }
          next[effectiveParentId] = { ...parentTask, subtasks: newSubtasks };
          supabase.from('tasks').update({ subtasks: newSubtasks })
            .eq('id', effectiveParentId).then(() => {});
        }
      });

      return next;
    });

    duplicates.forEach(task => {
      supabase.from('tasks').insert({
        id: task.id,
        block_id: task.blockId,
        parent_task_id: task.parentTaskId || null,
        template_id: task.templateId || null,
        instance_date: task.instanceDate || null,
        title: task.title,
        notes: task.notes || '',
        priority: task.priority,
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
        deleted_at: null
      }).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error duplicando tarea:', error);
      });
    });

    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [tasks, setTasks, selectedTaskIds, setSelectedTaskIds, setSelectionMode]);

  return {
    bulkUpdateTasks,
    bulkDeleteTasks,
    bulkDuplicateTasks,
  };
}
