/**
 * useTimerHandlers.ts
 *
 * Handlers del cronómetro, entradas manuales de tiempo y adjuntos.
 * Extraído de App.tsx.
 */

import { useCallback, useRef } from 'react';
import { Task, TimeEntry } from './types';
import { supabase } from './supabaseClient';
import { formatLocalISO } from './dateUtils';
import { resolveActionTarget } from './instanceEngine'; // rescate centralizado: resuelve/materializa la instancia virtual
import { toast } from './toast'; // Avisos (B1): no-op silencioso deja de ser mudo
import { diag } from './diag'; // DIAG-TEMP (sesión 15): quitar con el revert del commit de diagnóstico

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

  // DIAG-TEMP: ref al `tasks` más reciente, para registrar el estado local DESPUÉS del completado.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // DIAG-TEMP: traza del completado (payload → escritura AWAIT con respuesta real → readback → estado local).
  const diagComplete = (origin: string, targetId: string, t: Task | undefined, meta: any) => {
    const completedAt = new Date().toISOString();
    // BLINDAJE: la instrumentación NUNCA debe romper el completado real. Todo va en try/catch y
    // devolvemos `completedAt` pase lo que pase.
    try {
      diag(`completar:disparado (${origin})`, {
        ...meta, targetId, foundInTasks: !!t, currentStatus: t?.status,
        isInstance: targetId.startsWith('inst-'), templateId: t?.templateId, isTemplate: t?.isTemplate,
      });
      if (!t) {
        diag('completar:NO-OP — targetId no está en `tasks` (posible instancia virtual)', { targetId });
        return completedAt;
      }
      diag('completar:payload', { id: t.id, newStatus: 'completed', completedAt });
      const dbId = resolveId(t.id, tasks) || t.id;
      const isPlainLeaf = !t.templateId && !t.isTemplate && !String(t.id).startsWith('inst-');
      void (async () => {
        try {
          if (isPlainLeaf) {
            const resp = await supabase.from('tasks')
              .update({ status: 'completed', completed_at: completedAt, modified_at: new Date().toISOString() })
              .eq('id', dbId).select();
            diag('completar:respuesta-supabase (AWAIT)', {
              dbId,
              error: resp.error ? { message: resp.error.message, code: (resp.error as any).code, details: (resp.error as any).details, hint: (resp.error as any).hint } : null,
              filasAfectadas: resp.data?.length ?? 0,
              statusDevuelto: resp.data?.[0]?.status ?? null,
            });
          } else {
            diag('completar:instancia/plantilla — la escritura la hace handleUpdateTask; solo readback', { dbId });
          }
          // matiz 2: leer la fila de la INSTANCIA real (t.id), NO `dbId` (que resolvía a la PLANTILLA
          // y siempre daba 'pending'). handleUpdateTask persiste la excepción con id = t.id, pero de forma
          // ASÍNCRONA → damos un margen para que aterrice antes del readback (si no, carrera → existeFila:false).
          await new Promise(res => setTimeout(res, 900));
          const rb = await supabase.from('tasks').select('id,status,completed_at,is_exception').eq('id', t.id).maybeSingle();
          diag('completar:readback (fila de la INSTANCIA real)', { instanceId: t.id, existeFila: !!rb.data, dbStatus: rb.data?.status ?? null, dbCompletedAt: rb.data?.completed_at ?? null, error: rb.error?.message ?? null });
        } catch (e: any) {
          diag('completar:EXCEPCIÓN async (ignorada)', { message: String(e?.message || e) });
        }
      })();
      setTimeout(() => {
        try { diag('completar:estado-local-después', { id: t.id, localStatus: tasksRef.current[t.id]?.status ?? '(ya no está en tasks)' }); } catch { /* noop */ }
      }, 600);
    } catch (e: any) {
      try { diag('completar:DIAG-ERROR (instrumentación falló, se ignora)', { message: String(e?.message || e) }); } catch { /* noop */ }
    }
    return completedAt;
  };

  const handleStartTimer = useCallback((taskId: string, subtaskId: string | null = null) => {
    if (activeTimer) {
      if (!confirm("Ya hay un cronómetro activo. ¿Deseas pararlo y empezar este?")) return;
      handleStopTimer();
    }

    const task = resolveActionTarget(taskId, tasks);
    if (!task) { toast.warn('No encuentro esa tarea para iniciar el cronómetro. Recarga e inténtalo.'); return; }
    const targetEntity = subtaskId ? resolveActionTarget(subtaskId, tasks) : task;
    const title = targetEntity?.title || "Tarea sin título";

    // DIAG-TEMP: qué pasa la FILA al pulsar play → distingue si el play era del contenedor o de la hija.
    diag('timer:START (play pulsado)', { taskId, subtaskId, esSubtarea: !!subtaskId, tituloResuelto: title, tituloContenedor: task?.title });

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

    // DIAG-TEMP: qué llega al PARAR el cronómetro → si subtaskId es null aquí, el objetivo cae en el contenedor.
    diag('timer:STOP-confirm', { pendingTaskId: pendingEntry.taskId, pendingSubtaskId: pendingEntry.subtaskId, esSubtarea: !!pendingEntry.subtaskId, markComplete, minutes });

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

    if (markComplete && (pendingEntry.subtaskId || pendingEntry.taskId)) {
      const targetId = pendingEntry.subtaskId || pendingEntry.taskId;
      const t = resolveActionTarget(targetId, tasks); // rescate: materializa la instancia virtual si solo existe en memoria
      const completedAt = diagComplete('cronómetro-stop', targetId, t, { taskId: pendingEntry.taskId, subtaskId: pendingEntry.subtaskId, minutes }); // DIAG-TEMP
      if (t) handleUpdateTask({ ...t, status: 'completed', completedAt });
      else toast.warn('El tiempo se ha registrado, pero no he podido marcar la tarea como completada. Recarga e inténtalo.');
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
    const resolvedTaskId = resolveId(taskId, tasks) || taskId;
    const resolvedSubtaskId = resolveId(subtaskId, tasks);

    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      taskId,       // ID original — para que getTaskRegisteredSelf lo encuentre por instancia
      subtaskId,
      date,
      duration: minutes,
      note,
      createdAt: new Date().toISOString(),
      source: 'manual'
    };
    setTimeEntries(prev => [...prev, newEntry]);

    if (markComplete) {
      const targetId = subtaskId || taskId;
      const t = resolveActionTarget(targetId, tasks); // rescate: materializa la instancia virtual si solo existe en memoria
      const completedAt = diagComplete('panel manual', targetId, t, { taskId, subtaskId, minutes, date }); // DIAG-TEMP
      if (t) handleUpdateTask({ ...t, status: 'completed', completedAt });
      else toast.warn('El tiempo se ha registrado, pero no he podido marcar la tarea como completada. Recarga e inténtalo.');
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
    const task = resolveActionTarget(taskId, tasks);
    if (!task) { toast.warn('El archivo se subió, pero no he podido adjuntarlo a la tarea. Recarga e inténtalo.'); return; }
    const updatedAttachments = [...(task.attachments || []), attachment];
    handleUpdateTaskFn({ ...task, attachments: updatedAttachments });
  }, [tasks]);

  const handleDeleteAttachment = useCallback(async (taskId: string, attachmentId: string, path: string, handleUpdateTaskFn: (task: Task) => void) => {
    await supabase.storage.from('task-attachments').remove([path]);
    const task = resolveActionTarget(taskId, tasks);
    if (!task) { toast.warn('No he podido quitar el adjunto de la tarea. Recarga e inténtalo.'); return; }
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
