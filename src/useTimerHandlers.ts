/**
 * useTimerHandlers.ts
 *
 * Handlers del cronómetro, entradas manuales de tiempo y adjuntos.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { Task, TimeEntry } from './types';
import { supabase } from './supabaseClient';
import { formatLocalISO } from './dateUtils';

interface ActiveTimer {
  entityId: string;
  parentTaskId: string;
  subtaskId: string | null;
  startTime: string;
  accumulatedSeconds: number;
  title: string;
}

interface UseTimerHandlersOptions {
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  activeTimer: ActiveTimer | null;
  setActiveTimer: React.Dispatch<React.SetStateAction<ActiveTimer | null>>;
  setTimerStopModal: React.Dispatch<React.SetStateAction<{ minutes: number; pendingEntry: any } | null>>;
  setTimeEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
  handleUpdateTask: (task: Task) => void;
}

export function useTimerHandlers({
  tasks,
  setTasks,
  activeTimer,
  setActiveTimer,
  setTimerStopModal,
  setTimeEntries,
  handleUpdateTask,
}: UseTimerHandlersOptions) {

  const handleStartTimer = useCallback((taskId: string, subtaskId: string | null = null) => {
    if (activeTimer) {
      if (!confirm("Ya hay un cronómetro activo. ¿Deseas pararlo y empezar este?")) return;
      handleStopTimer();
    }

    const task = tasks[taskId];
    if (!task) return;
    const targetEntity = subtaskId ? tasks[subtaskId] : task;
    const title = targetEntity?.title || "Tarea sin título";

    setActiveTimer({
      entityId: subtaskId || taskId,
      parentTaskId: taskId,
      subtaskId,
      startTime: new Date().toISOString(),
      accumulatedSeconds: 0,
      title
    });
  }, [activeTimer, tasks, setActiveTimer]);

  const handleStopTimer = useCallback(() => {
    if (!activeTimer) return;

    const start = new Date(activeTimer.startTime).getTime();
    const now = new Date().getTime();
    const elapsedSeconds = Math.floor((now - start) / 1000) + activeTimer.accumulatedSeconds;
    const minutes = Math.floor(elapsedSeconds / 60);

    if (minutes < 1) {
      if (confirm("El tiempo transcurrido es menor a 1 minuto. ¿Deseas descartarlo?")) {
        setActiveTimer(null);
        return;
      }
    }

    setTimerStopModal({
      minutes: Math.max(1, minutes),
      pendingEntry: {
        taskId: activeTimer.parentTaskId,
        subtaskId: activeTimer.subtaskId,
        date: formatLocalISO(new Date()),
      }
    });
    setActiveTimer(null);
  }, [activeTimer, setActiveTimer, setTimerStopModal]);

  const resolveId = useCallback((id: string | null, tasksMap: Record<string, Task>): string | null => {
    if (!id) return null;
    if (!id.startsWith('inst-')) return id;
    const t = tasksMap[id];
    if (t?.templateId) return t.templateId;
    const parts = id.replace('inst-', '').split('-');
    parts.pop(); parts.pop(); parts.pop();
    return parts.join('-');
  }, []);

  const handleTimerStopConfirm = useCallback((note: string, markComplete: boolean, timerStopModal: { minutes: number; pendingEntry: any }) => {
    const { minutes, pendingEntry } = timerStopModal;

    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      taskId: pendingEntry.taskId,
      subtaskId: pendingEntry.subtaskId,
      date: pendingEntry.date,
      duration: minutes,
      note,
      createdAt: new Date().toISOString(),
      source: 'timer'
    };
    setTimeEntries(prev => [...prev, newEntry]);

    if (markComplete && pendingEntry.subtaskId) {
      const t = tasks[pendingEntry.subtaskId];
      if (t) handleUpdateTask({ ...t, status: 'completed', completedAt: new Date().toISOString() });
    } else if (markComplete && pendingEntry.taskId) {
      const t = tasks[pendingEntry.taskId];
      if (t) handleUpdateTask({ ...t, status: 'completed', completedAt: new Date().toISOString() });
    }

    supabase.from('time_entries').insert({
      id: newEntry.id,
      task_id: resolveId(newEntry.taskId, tasks),
      subtask_id: resolveId(newEntry.subtaskId, tasks) || null,
      date: newEntry.date,
      duration: newEntry.duration,
      note: newEntry.note || '',
      source: newEntry.source,
      created_at: newEntry.createdAt
    }).then(({ error }) => {
      if (error) console.error('[SUPABASE] Error saving time entry:', error);
    });
  }, [tasks, setTimeEntries, handleUpdateTask, resolveId]);

  const handleManualTimeEntry = useCallback((
    taskId: string,
    subtaskId: string | null,
    minutes: number,
    date: string,
    note?: string,
    markComplete?: boolean
  ) => {
    // Resolver siempre instancia→templateId, igual que el cronómetro
    const resolvedTaskId = resolveId(taskId, tasks) || taskId;
    const resolvedSubtaskId = resolveId(subtaskId, tasks);
    console.log('[handleManualTimeEntry]', { taskId, subtaskId, resolvedTaskId, resolvedSubtaskId, minutes, date });

    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      taskId: resolvedTaskId,
      subtaskId: resolvedSubtaskId,
      date,
      duration: minutes,
      note,
      createdAt: new Date().toISOString(),
      source: 'manual'
    };
    setTimeEntries(prev => [...prev, newEntry]);

    if (markComplete) {
      const targetId = subtaskId || taskId;
      const t = tasks[targetId];
      if (t) handleUpdateTask({ ...t, status: 'completed', completedAt: new Date().toISOString() });
    }

    supabase.from('time_entries').insert({
      id: newEntry.id,
      task_id: resolvedTaskId,
      subtask_id: resolvedSubtaskId || null,
      date: newEntry.date,
      duration: newEntry.duration,
      note: newEntry.note || '',
      source: newEntry.source,
      created_at: newEntry.createdAt
    }).then(({ error }) => {
      if (error) console.error('[SUPABASE] Error saving manual time entry:', error);
    });
  }, [tasks, setTimeEntries, handleUpdateTask, resolveId]);

  const handleDeleteTimeEntry = useCallback((entryId: string) => {
    setTimeEntries(prev => prev.filter(e => e.id !== entryId));
    supabase.from('time_entries').delete().eq('id', entryId)
      .then(({ error }) => {
        if (error) console.error('[SUPABASE] Error deleting time entry:', error);
      });
  }, [setTimeEntries]);

  const handleUpdateTimeEntry = useCallback((entryId: string, updates: { duration: number; note: string }) => {
    setTimeEntries(prev => prev.map(e => e.id === entryId ? { ...e, ...updates } : e));
    supabase.from('time_entries').update({ duration: updates.duration, note: updates.note })
      .eq('id', entryId)
      .then(({ error }) => {
        if (error) console.error('[SUPABASE] Error updating time entry:', error);
      });
  }, [setTimeEntries]);

  const handleUploadAttachment = useCallback(async (taskId: string, file: File, handleUpdateTaskFn: (task: Task) => void) => {
    const ext = file.name.split('.').pop();
    const path = `${taskId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('task-attachments').upload(path, file);
    if (error) { console.error('[ATTACHMENTS] Upload error:', error); return; }
    const { data: urlData } = supabase.storage.from('task-attachments').getPublicUrl(path);
    const attachment = {
      id: `att-${Date.now()}`,
      name: file.name,
      url: urlData.publicUrl,
      type: file.type,
      size: file.size,
      path,
      createdAt: new Date().toISOString()
    };
    const task = tasks[taskId];
    if (!task) return;
    const updatedAttachments = [...(task.attachments || []), attachment];
    handleUpdateTaskFn({ ...task, attachments: updatedAttachments });
  }, [tasks]);

  const handleDeleteAttachment = useCallback(async (taskId: string, attachmentId: string, path: string, handleUpdateTaskFn: (task: Task) => void) => {
    await supabase.storage.from('task-attachments').remove([path]);
    const task = tasks[taskId];
    if (!task) return;
    const updatedAttachments = (task.attachments || []).filter((a: any) => a.id !== attachmentId);
    handleUpdateTaskFn({ ...task, attachments: updatedAttachments });
  }, [tasks]);

  return {
    handleStartTimer,
    handleStopTimer,
    handleTimerStopConfirm,
    handleManualTimeEntry,
    handleDeleteTimeEntry,
    handleUpdateTimeEntry,
    handleUploadAttachment,
    handleDeleteAttachment,
  };
}
