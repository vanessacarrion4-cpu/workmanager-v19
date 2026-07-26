/**
 * useTaskOrdering.ts
 *
 * Handlers de ordenación, jerarquía (promover/degradar), expandir y navegación a template.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { Task } from './types';
import { supabase } from './supabaseClient';

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
      supabase.from('tasks').update({ order: i }).eq('id', dbId).then(({ error }) => {
        if (error) console.error('[ORDER] Error saving task order:', error);
      });
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
      updated[parentId] = {
        ...existing,
        subtasks: subtaskIds,
        modifiedAt: new Date().toISOString()
      };
      subtaskIds.forEach((subId, order) => {
        if (updated[subId]) {
          updated[subId] = { ...updated[subId], order };
        }
      });
      return updated;
    });

    const parentDbId = parentId.startsWith('inst-') ? (tasks[parentId]?.templateId || parentId) : parentId;
    supabase.from('tasks').update({ subtasks: subtaskIds }).eq('id', parentDbId).then(({ error }) => {
      if (error) console.error('[ORDER] Error saving parent subtasks array:', error);
    });

    subtaskIds.forEach((subId, order) => {
      const sub = tasks[subId];
      if (!sub) return;
      const dbId = subId.startsWith('inst-') ? (sub.templateId || subId) : subId;
      supabase.from('tasks').update({ order }).eq('id', dbId).then(({ error }) => {
        if (error) console.error('[ORDER] Error saving subtask order:', error);
      });
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
        supabase.from('tasks').update({ is_expanded: true, modified_at: timestamp })
          .eq('id', targetTask.parentTaskId).then(() => {});
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

    supabase.from('tasks').update({
      is_expanded: newExpanded,
      modified_at: timestamp
    }).eq('id', taskId).then(({ error }) => {
      if (error) console.error('[SUPABASE] Error actualizando isExpanded:', error);
    });
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
    if (!outerTask || !outerTask.parentTaskId) return;
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
    supabase.from('tasks')
      .update({ parent_task_id: grandParentId, modified_at: timestamp })
      .eq('id', taskId)
      .then(({ error }) => {
        if (error) console.error('[PROMOTE] Error persistiendo parent_task_id:', error);
      });
  }, [tasks, setTasks]);

  const handleDemoteTask = useCallback((taskId: string) => {
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
    if (outerIdx <= 0) return;
    const aboveTaskId = outerSiblingIds[outerIdx - 1];
    if (!tasks[aboveTaskId]) return;
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
    supabase.from('tasks')
      .update({ parent_task_id: aboveTaskId, modified_at: timestamp })
      .eq('id', taskId)
      .then(({ error }) => {
        if (error) console.error('[DEMOTE] Error persistiendo parent_task_id:', error);
      });
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
