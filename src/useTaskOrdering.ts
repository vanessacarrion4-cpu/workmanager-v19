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
        modifiedAt: new Date().toISOString()
      };

      if (grandParentId && newTasks[grandParentId]) {
        const grandParent = newTasks[grandParentId];
        const parentIdx = grandParent.subtasks.indexOf(parentTask.id);
        const newSubtasks = [...grandParent.subtasks];
        newSubtasks.splice(parentIdx + 1, 0, taskId);
        newTasks[grandParentId] = {
          ...grandParent,
          subtasks: newSubtasks,
          modifiedAt: new Date().toISOString()
        };
      }

      newTasks[taskId] = {
        ...task,
        parentTaskId: grandParentId,
        modifiedAt: new Date().toISOString()
      };

      return newTasks;
    });
  }, [setTasks]);

  const handleDemoteTask = useCallback((taskId: string) => {
    setTasks(prev => {
      const task = prev[taskId];
      if (!task) return prev;

      const currentLevel = task.parentTaskId
        ? (prev[task.parentTaskId]?.parentTaskId ? 3 : 2)
        : 1;
      if (currentLevel >= 3) return prev;

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
          modifiedAt: new Date().toISOString()
        };
      }

      newTasks[aboveTaskId] = {
        ...aboveTask,
        subtasks: [...(aboveTask.subtasks || []), taskId],
        isExpanded: true,
        modifiedAt: new Date().toISOString()
      };

      newTasks[taskId] = {
        ...task,
        parentTaskId: aboveTaskId,
        modifiedAt: new Date().toISOString()
      };

      return newTasks;
    });
  }, [setTasks]);

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
