/**
 * TaskModal.tsx
 *
 * Modal compacto rediseñado — sesión 6.
 * - Sin footer: Guardar en header junto a ✓ y 🗑
 * - Recurrencia colapsada por defecto
 * - Fila unificada: tipo + bloque + estimado
 * - Fila unificada: tags + fecha + hora
 * - Delegación siempre visible
 * - Notas con autosize
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar as CalendarIcon, Clock, Trash2, X, RefreshCw,
  Plus, Edit, Check, ArrowUpLeft, Paperclip, Eye, ChevronDown, Save, LayoutGrid
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Task, TagType } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { TAG_LABELS } from './constants';
import { getTaskRegisteredCombo, formatMinutes } from './utils';
import {
  DelegationChip, DatePickerChip, TagPickerChip, RecurrencePickerChip,
  EstimatedTimeChip, TimePickerChip, MonthDatePicker, TimeManagementPanel
} from './components';

interface TaskModalProps {
  task: Task;
  allTasksMap: Record<string, Task>;
  onClose: () => void;
  onSave: (task: Task) => void;
  onAddTask: (parentId: string | null, blockId?: string, overrideDate?: string) => string | undefined;
  onDeleteTask: (id: string) => void;
  onEditTask: (id: string | null) => void;
  blocks: any[];
  people?: any[];
  onAddPerson?: (person: any) => void;
  onRenamePerson?: (id: string, name: string) => void;
  onDeletePerson?: (id: string) => void;
  onRecurrenceDateChange?: ((task: any, newDate: string) => void) | null;
  onUploadAttachment?: ((taskId: string, file: File) => void) | null;
  onDeleteAttachment?: ((taskId: string, attachmentId: string, path: string) => void) | null;
  onToggleStatus?: ((taskId: string) => void) | null;
  timeEntries?: any[];
  onAddTimeEntry?: ((taskId: string, subtaskId: string | null, minutes: number, date: string, note?: string, markComplete?: boolean) => void) | null;
  onDeleteTimeEntry?: ((entryId: string) => void) | null;
  onUpdateTimeEntry?: ((entryId: string, updates: any) => void) | null;
  onGoToTemplate?: ((taskId: string) => void) | null;
  initialShowTime?: boolean;
  initialInstanceDate?: string | null;
}

export function TaskModal({
  task,
  allTasksMap,
  onClose,
  onSave,
  onAddTask,
  onDeleteTask,
  onEditTask,
  blocks,
  people = [],
  onAddPerson,
  onRenamePerson,
  onDeletePerson,
  onRecurrenceDateChange = null,
  onUploadAttachment = null,
  onDeleteAttachment = null,
  onToggleStatus = null,
  timeEntries = [],
  onAddTimeEntry = null,
  onDeleteTimeEntry = null,
  onUpdateTimeEntry = null,
  onGoToTemplate = null,
  initialShowTime = false,
  initialInstanceDate = null,
}: TaskModalProps) {
  const [localTask, setLocalTask] = useState<Task>(task);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(null);
  const [subtaskTitles, setSubtaskTitles] = useState<Record<string, string>>({});
  const [showDateSelector, setShowDateSelector] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTimeEntry, setShowTimeEntry] = useState(initialShowTime);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Una tarea COMPLETADA no se edita (ni desde la fila ni desde el modal — el modal era la puerta de
  // atrás). Con `locked` el cuerpo del modal es no-editable; excepción: el tiempo registrado. (sesión 15)
  const locked = localTask.status === 'completed';
  const tags: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];

  useEffect(() => { setLocalTask(task); }, [task.id]);
  useEffect(() => {
    setLocalTask(prev => ({ ...prev, attachments: task.attachments || [] }));
  }, [JSON.stringify(task.attachments)]);

  // Autosize notas
  useEffect(() => {
    if (notesRef.current) {
      notesRef.current.style.height = 'auto';
      notesRef.current.style.height = notesRef.current.scrollHeight + 'px';
    }
  }, [localTask.notes]);

  const subtasks = useMemo(() => {
    return (localTask.subtasks || [])
      .map(id => allTasksMap[id] || { id, title: subtaskTitles[id] || '', status: 'pending' as const, blockId: localTask.blockId, parentTaskId: localTask.id, subtasks: [], tags: [], estimatedMinutes: 0, order: -1 })
      .sort((a, b) => (a?.order || 0) - (b?.order || 0));
  }, [localTask.subtasks, localTask.id, localTask.blockId, allTasksMap, subtaskTitles]);

  const handleUpdateSubtask = (sid: string, updates: Partial<Task>) => {
    const subtask = allTasksMap[sid];
    onSave({ ...subtask, ...updates });
    const hasRecurrence = updates.recurrence !== undefined ? !!updates.recurrence : !!subtask?.recurrence;
    if (hasRecurrence && subtask?.parentTaskId) {
      const parent = allTasksMap[subtask.parentTaskId];
      if (parent && (!parent.isTemplate || parent.dueDate)) {
        onSave({ ...parent, isTemplate: true, dueDate: null });
      }
    }
  };

  const handleSave = () => {
    const taskToSave = localTask.templateId
      ? { ...localTask, isException: true, existsInSupabase: true }
      : localTask;
    onSave(taskToSave);
    onClose();
  };

  const totalEstimated = localTask.estimatedMinutes || 0;
  const totalRegistered = useMemo(() => {
    const filterDate = initialInstanceDate || localTask.instanceDate || localTask.dueDate || undefined;
    return getTaskRegisteredCombo(localTask.id, allTasksMap, timeEntries, new Set(), filterDate);
  }, [timeEntries, localTask.id, allTasksMap, initialInstanceDate, localTask.instanceDate, localTask.dueDate]);
  const regColor = totalRegistered === 0
    ? 'dark:text-text-secondary/40 text-text-secondary-light/40'
    : totalRegistered > totalEstimated && totalEstimated > 0
      ? 'text-[#EC4899]'
      : totalEstimated > 0 && totalRegistered >= totalEstimated * 0.9
        ? 'text-[#F97316]'
        : 'text-[#84CC16]';

  const frequencies = [
    { id: 'daily', label: 'Diaria' },
    { id: 'weekdays', label: 'L-V' },
    { id: 'weekly', label: 'Sem' },
    { id: 'monthly', label: 'Mes' },
    { id: 'yearly', label: 'Año' }
  ];

  const isRecurringInstance = !!localTask.templateId;
  const hasActiveRecurrence = !!localTask.recurrence;

  // Label recurrencia para mostrar en el toggle cuando está colapsado
  const recurrenceLabel = (() => {
    if (isRecurringInstance) {
      const template = allTasksMap[localTask.templateId!];
      const rec = template?.recurrence || (template?.parentTaskId ? allTasksMap[template.parentTaskId]?.recurrence : null);
      if (!rec) return 'Serie activa';
      const freq = rec.frequency || rec.type;
      if (freq === 'daily') return 'Diaria';
      if (freq === 'weekdays') return 'L-V';
      if (freq === 'weekly') {
        const dayNames = ['L','M','X','J','V','S','D'];
        return (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ') || 'Semanal';
      }
      if (freq === 'monthly') return `Día ${rec.monthDay || '?'}`;
      if (freq === 'yearly') return 'Anual';
      return 'Serie activa';
    }
    if (hasActiveRecurrence) {
      const freq = localTask.recurrence!.frequency;
      if (freq === 'daily') return 'Diaria';
      if (freq === 'weekdays') return 'L-V';
      if (freq === 'weekly') {
        const dayNames = ['L','M','X','J','V','S','D'];
        return (localTask.recurrence!.weekDays || []).map((d: number) => dayNames[d]).join(' ') || 'Semanal';
      }
      if (freq === 'monthly') return `Día ${localTask.recurrence!.monthDay || '?'}`;
      if (freq === 'yearly') return 'Anual';
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        key={localTask.id}
        className="dark:bg-bg-card bg-white w-full max-w-lg rounded-[1.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.5)] border dark:border-border-main border-border-main-light overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* ── HEADER ── */}
        <div className="px-4 pt-3 pb-3 border-b dark:border-border-main border-border-main-light flex items-center gap-2 dark:bg-bg-card bg-white shrink-0">
          {/* Volver al padre */}
          {localTask.parentTaskId && (
            <button
              onClick={() => onEditTask(localTask.parentTaskId!)}
              className="w-8 h-8 flex items-center justify-center bg-turquesa/10 text-turquesa rounded-xl border border-turquesa/20 hover:bg-turquesa/20 transition-all shrink-0"
              title="Volver al padre"
            >
              <ArrowUpLeft size={14} />
            </button>
          )}

          {/* Título */}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black text-turquesa uppercase tracking-[0.2em] mb-0.5 flex items-center gap-2">
              {isRecurringInstance ? 'Instancia recurrente' : hasActiveRecurrence ? 'Tarea repetitiva' : 'Tarea'}
              {locked && (
                <span className="px-1.5 py-0.5 rounded-md bg-turquesa/15 text-turquesa border border-turquesa/30 flex items-center gap-1">
                  <Check size={9} strokeWidth={3} /> Completada
                </span>
              )}
            </p>
            <input
              autoFocus={!locked}
              readOnly={locked}
              className={`text-base font-black w-full bg-transparent outline-none placeholder:text-text-secondary dark:text-white text-text-main-light leading-tight ${locked ? 'line-through opacity-60' : ''}`}
              value={localTask.title}
              onChange={e => setLocalTask(prev => ({ ...prev, title: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !locked) handleSave(); }}
              placeholder="¿Qué hay que hacer?"
            />
          </div>

          {/* Acciones header */}
          <div className="flex items-center gap-1 shrink-0">
            {onToggleStatus && (
              <button
                onClick={() => {
                  // No cerrar: cambiar el estado en el sitio. Reabrir → pending → los campos se
                  // desbloquean con el modal abierto. Completar → completed → se bloquean. (sesión 15)
                  onToggleStatus(localTask.id);
                  setLocalTask(prev => ({
                    ...prev,
                    status: prev.status === 'completed' ? 'pending' : 'completed',
                    completedAt: prev.status === 'completed' ? undefined : new Date().toISOString(),
                  }));
                }}
                title={localTask.status === 'completed' ? 'Reabrir (volver a pendiente)' : 'Completar tarea'}
                className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all ${
                  localTask.status === 'completed'
                    ? 'bg-turquesa border-turquesa text-white hover:bg-turquesa/85'
                    : 'bg-transparent border-turquesa/40 text-turquesa hover:bg-turquesa/10'
                }`}
              >
                <Check size={14} />
              </button>
            )}
            {/* Ir a Bloques — siempre visible si onGoToTemplate está disponible */}
            {onGoToTemplate && (
              <button
                onClick={() => {
                  const targetId = localTask.templateId || localTask.id;
                  onGoToTemplate(targetId);
                  onClose();
                }}
                title="Ver en Bloques"
                className="w-8 h-8 flex items-center justify-center dark:bg-bg-secondary bg-bg-secondary-light rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50 hover:text-turquesa transition-all"
              >
                <LayoutGrid size={14} />
              </button>
            )}
            <button
              onClick={() => { onDeleteTask(localTask.id); onClose(); }}
              title="Eliminar tarea"
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-secondary bg-bg-secondary-light dark:hover:bg-rosa/10 hover:bg-rosa/5 rounded-xl border dark:border-border-main border-border-main-light text-rosa border-rosa/20 transition-all"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={handleSave}
              title="Guardar cambios"
              className="w-8 h-8 flex items-center justify-center bg-turquesa text-white rounded-xl hover:bg-turquesa/85 active:scale-95 transition-all shadow-md shadow-turquesa/20"
            >
              <Save size={14} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center dark:bg-bg-secondary bg-bg-secondary-light dark:hover:bg-bg-main hover:bg-gray-200 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── BODY ── */}
        {/* Nota (sesión 15): NO se bloquea el cuerpo entero — eso mataba la consulta (abrir adjuntos,
            copiar notas, entrar en subtareas). Se bloquea CADA control de ESCRITURA por separado. */}
        <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar flex-1">

          {/* FILA 1: Tipo + Bloque + Estimado + Registrado */}
          <div className="flex items-center gap-2 dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-2">
            {/* Tipo Core/Adhoc */}
            <div className="flex rounded-xl overflow-hidden border dark:border-border-main border-border-main-light shrink-0">
              <button
                disabled={locked}
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'core' }))}
                className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                  localTask.taskType === 'core' || (hasActiveRecurrence && !localTask.taskType)
                    ? 'bg-turquesa text-white'
                    : 'dark:text-text-secondary text-text-secondary-light hover:dark:text-white'
                }`}
              >Core</button>
              <button
                disabled={locked}
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'adhoc' }))}
                className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                  localTask.taskType === 'adhoc' || (!hasActiveRecurrence && !isRecurringInstance && !localTask.taskType)
                    ? 'bg-rosa text-white'
                    : 'dark:text-text-secondary text-text-secondary-light hover:dark:text-white'
                }`}
              >Adhoc</button>
            </div>

            <div className="w-px h-5 dark:bg-border-main bg-border-main-light shrink-0" />

            {/* Bloque */}
            <select
              disabled={locked}
              className="flex-1 min-w-0 bg-transparent text-[11px] font-bold dark:text-white text-text-main-light outline-none cursor-pointer truncate"
              value={localTask.blockId}
              onChange={e => setLocalTask(prev => ({ ...prev, blockId: e.target.value }))}
            >
              {blocks.filter((b: any) => b.isActive).map((b: any) => (
                <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
              ))}
            </select>

            <div className="w-px h-5 dark:bg-border-main bg-border-main-light shrink-0" />

            {/* Estimado */}
            <div className="flex items-center gap-1 shrink-0">
              <Clock size={12} className="text-turquesa" />
              <input
                type="number"
                disabled={locked}
                className="w-12 bg-transparent text-[11px] font-bold dark:text-white text-text-main-light outline-none text-right"
                value={localTask.estimatedMinutes || ''}
                onChange={e => setLocalTask(prev => ({ ...prev, estimatedMinutes: parseInt(e.target.value) || 0 }))}
                placeholder="0"
              />
              <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">min</span>
            </div>

            <div className="w-px h-5 dark:bg-border-main bg-border-main-light shrink-0" />

            {/* Registrado — clicable para añadir. Sigue vivo aunque la tarea esté completada (el tiempo
                registrado es la excepción a "completada = no editable"). */}
            <button
              onClick={() => setShowTimeEntry(v => !v)}
              className={`flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-lg transition-all hover:bg-white/10 ${regColor}`}
              title="Tiempo registrado — clic para añadir"
            >
              <Check size={11} strokeWidth={3} />
              <span className="text-[11px] font-black">{formatMinutes(totalRegistered)}</span>
            </button>
          </div>

          {/* Panel tiempo — TimeManagementPanel completo como overlay */}
          {showTimeEntry && (
            <TimeManagementPanel
              taskId={localTask.id}
              subtaskId={null}
              instanceDate={initialInstanceDate || localTask.instanceDate || localTask.dueDate || null}
              allTasksMap={allTasksMap}
              timeEntries={timeEntries}
              fromModal={true}
              onAddEntry={(taskId: string, subtaskId: string | null, minutes: number, date: string, note: string, markComplete: boolean) => {
                if (onAddTimeEntry) onAddTimeEntry(taskId, subtaskId, minutes, date, note, markComplete);
              }}
              onDeleteEntry={(entryId: string) => { if (onDeleteTimeEntry) onDeleteTimeEntry(entryId); }}
              onUpdateEntry={(entryId: string, updates: any) => { if (onUpdateTimeEntry) onUpdateTimeEntry(entryId, updates); }}
              onClose={() => setShowTimeEntry(false)}
            />
          )}

          {/* FILA 2: Tags + Delegación + Fecha — solo escritura → bloqueada entera si completada */}
          <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-0 dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl px-2 py-1.5 ${locked ? 'pointer-events-none' : ''}`}>
            {/* Tags — solo si no es contenedor */}
            <div className="flex items-center gap-1">
              {!(localTask.subtasks && localTask.subtasks.length > 0) ? (
                <>
                  {tags.map(t => {
                    const active = localTask.tags.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => setLocalTask(prev => ({ ...prev, tags: [t] }))}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg text-sm border transition-all ${
                          active
                            ? 'bg-turquesa border-turquesa shadow-sm'
                            : 'dark:border-border-main border-border-main-light hover:border-turquesa/50 dark:bg-bg-card bg-white'
                        }`}
                        title={TAG_LABELS[t].label}
                      >
                        {TAG_LABELS[t].icon}
                      </button>
                    );
                  })}
                </>
              ) : (
                <span className="text-[10px] dark:text-text-secondary text-text-secondary-light italic">🗂️ Contenedor</span>
              )}
            </div>

            {/* Delegación — centrada */}
            <div className="flex justify-center px-2 border-x dark:border-border-main border-border-main-light h-7 items-center">
              <DelegationChip
                delegation={localTask.delegation}
                people={people}
                onAddPerson={onAddPerson}
                onRenamePerson={onRenamePerson}
                onDeletePerson={onDeletePerson}
                onRecurrenceDateChange={onRecurrenceDateChange}
                onChange={(delegation: any) => setLocalTask(prev => ({ ...prev, delegation }))}
              />
            </div>

            {/* Fecha — alineada a la derecha */}
            <div className="flex items-center justify-end gap-1 pl-2">
              <button
                onClick={() => setShowDateSelector(!showDateSelector)}
                className={`flex items-center gap-1.5 text-[11px] font-bold transition-all ${
                  localTask.dueDate ? 'text-turquesa hover:opacity-70' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa'
                }`}
              >
                <CalendarIcon size={12} />
                <span className="whitespace-nowrap">
                  {localTask.dueDate ? (() => {
                    const d = parseLocalISO(localTask.dueDate);
                    return `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;
                  })() : 'Sin fecha'}
                </span>
              </button>
              {localTask.dueDate && (
                <button onClick={() => setLocalTask(prev => ({ ...prev, dueDate: null, dueTime: '' }))} className="text-rosa hover:bg-rosa/10 rounded p-0.5 transition-all shrink-0">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* FILA 3: Hora — solo si tiene fecha y no es recurrente */}
          {localTask.dueDate && !localTask.recurrence && (
            <div className={`flex items-center gap-2 dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 ${locked ? 'pointer-events-none' : ''}`}>
              <Clock size={12} className="text-azul shrink-0" />
              <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest shrink-0">Hora</span>
              <input
                type="time"
                value={localTask.dueTime || ''}
                onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                className="flex-1 bg-transparent text-[11px] font-bold text-azul outline-none"
              />
              {localTask.dueTime && (
                <button onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))} className="text-rosa hover:bg-rosa/10 rounded p-0.5 transition-all">
                  <X size={10} />
                </button>
              )}
            </div>
          )}

          {/* Selector de fecha expandible */}
          <AnimatePresence>
            {showDateSelector && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl">
                  <MonthDatePicker
                    value={localTask.dueDate}
                    onChange={(d) => {
                      setLocalTask(prev => ({ ...prev, dueDate: d }));
                      setShowDateSelector(false);
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recurrencia — colapsable. En completadas: DESPLEGAR sigue vivo (consulta: ver cuándo se
              repite); solo se bloquea EDITAR la regla (el contenido, más abajo). */}
          <div className="dark:bg-bg-main/20 bg-gray-100/50 border dark:border-border-main border-border-main-light rounded-2xl overflow-hidden">
            {/* Toggle header */}
            <button
              onClick={() => setShowRecurrence(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:dark:bg-white/5 hover:bg-black/5 transition-all"
            >
              <div className="flex items-center gap-2">
                <RefreshCw size={13} className={hasActiveRecurrence || isRecurringInstance ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'} />
                <span className="text-[11px] font-black dark:text-white text-text-main-light uppercase tracking-widest">Repetición</span>
                {(recurrenceLabel) && (
                  <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-turquesa/20 text-turquesa border border-turquesa/30">
                    {recurrenceLabel}
                  </span>
                )}
              </div>
              <ChevronDown size={13} className={`dark:text-text-secondary text-text-secondary-light transition-transform ${showRecurrence ? 'rotate-180' : ''}`} />
            </button>

            {/* Contenido recurrencia */}
            <AnimatePresence>
              {showRecurrence && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className={`px-3 pb-3 space-y-3 border-t dark:border-border-main border-border-main-light ${locked ? 'pointer-events-none' : ''}`}>

                    {/* Instancia recurrente — info */}
                    {isRecurringInstance && (() => {
                      const template = allTasksMap[localTask.templateId!];
                      const rec = template?.recurrence || (template?.parentTaskId ? allTasksMap[template.parentTaskId]?.recurrence : null);
                      const dayNames = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
                      const freq = rec?.frequency || rec?.type;
                      let desc = null;
                      if (freq === 'daily') desc = 'Diaria — todos los días';
                      else if (freq === 'weekdays') desc = 'Semanal — Lun a Vie';
                      else if (freq === 'weekly') desc = `Semanal — ${(rec.weekDays || []).map((d: number) => dayNames[d]).join(', ')}`;
                      else if (freq === 'monthly') desc = `Mensual — día ${rec.monthDay || '?'}`;
                      else if (freq === 'yearly') {
                        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
                        desc = rec.yearDay && rec.yearMonth ? `Anual — ${rec.yearDay} de ${months[rec.yearMonth - 1]}` : 'Anual';
                      }
                      return (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-start gap-2 p-2.5 dark:bg-turquesa/10 bg-turquesa/5 border border-turquesa/20 rounded-xl">
                            <RefreshCw size={12} className="text-turquesa shrink-0 mt-0.5" />
                            <p className="text-[11px] dark:text-text-secondary text-text-secondary-light">
                              <span className="text-turquesa font-bold">Instancia de una serie.</span> Los cambios solo afectan a este día.
                            </p>
                          </div>
                          {desc && (
                            <div className="flex items-center gap-2 p-2.5 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl">
                              <span className="text-[11px] font-bold text-turquesa">{desc}</span>
                              {rec?.startDate && (
                                <span className="text-[10px] dark:text-text-secondary text-text-secondary-light ml-auto">
                                  desde {new Date(rec.startDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Toggle activar/desactivar recurrencia */}
                    {!isRecurringInstance && (
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Activar repetición</span>
                        <button
                          onClick={() => setLocalTask(prev => prev.recurrence
                            // Desactivar recurrencia → vuelve a tarea normal (se quita la regla).
                            ? { ...prev, recurrence: undefined, isTemplate: false, dueDate: prev.dueDate || formatLocalISO(new Date()) }
                            // Activar: SOLO fijar la pauta. NO pre-poner isTemplate:true — eso saltaba la conversión
                            // manual→plantilla de handleUpdateTask (crear la 1ª instancia del día), mismo bug ya cerrado
                            // en la fila con c0bb09d. Se conserva dueDate para que la 1ª instancia aterrice en el día.
                            : { ...prev, recurrence: { frequency: 'daily', startDate: prev.dueDate || formatLocalISO(new Date()) } }
                          )}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            hasActiveRecurrence ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-gray-200 dark:text-text-secondary text-text-secondary-light'
                          }`}
                        >
                          {hasActiveRecurrence ? 'ACTIVA' : 'DESACTIVADA'}
                        </button>
                      </div>
                    )}

                    {/* Config cuando recurrencia activa */}
                    {hasActiveRecurrence && (
                      <div className="space-y-3">
                        {/* Frecuencia + Inicio */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Frecuencia</label>
                            <div className="flex dark:bg-bg-secondary bg-bg-secondary-light rounded-xl p-0.5 gap-0.5">
                              {frequencies.map(f => (
                                <button
                                  key={f.id}
                                  onClick={() => setLocalTask(prev => {
                                    const today = new Date();
                                    const updates: any = { frequency: f.id as any };
                                    if (f.id === 'weekly' && (!prev.recurrence?.weekDays || prev.recurrence.weekDays.length === 0)) {
                                      updates.weekDays = [(today.getDay() + 6) % 7];
                                    }
                                    if (f.id === 'monthly' && !prev.recurrence?.monthDay) {
                                      updates.monthDay = today.getDate();
                                    }
                                    return { ...prev, recurrence: { ...prev.recurrence!, ...updates } };
                                  })}
                                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${
                                    localTask.recurrence?.frequency === f.id
                                      ? 'bg-turquesa dark:text-white text-white'
                                      : 'dark:text-text-secondary text-text-secondary-light hover:dark:text-white'
                                  }`}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Inicio</label>
                            <input
                              type="date"
                              className="w-full p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold dark:text-white text-text-main-light outline-none"
                              value={localTask.recurrence!.startDate}
                              onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, startDate: e.target.value } }))}
                            />
                          </div>
                        </div>

                        {/* Hora para recurrentes */}
                        <div className="flex items-center gap-2 p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl">
                          <Clock size={12} className="text-azul shrink-0" />
                          <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hora</span>
                          <input
                            type="time"
                            value={localTask.dueTime || ''}
                            onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                            className="flex-1 bg-transparent text-[11px] font-bold text-azul outline-none"
                          />
                          {localTask.dueTime && (
                            <button onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))} className="text-rosa hover:bg-rosa/10 rounded p-0.5 transition-all">
                              <X size={10} />
                            </button>
                          )}
                        </div>

                        {/* Días semana */}
                        {localTask.recurrence!.frequency === 'weekly' && (
                          <div className="space-y-1">
                            <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Días</label>
                            <div className="flex gap-1">
                              {['L','M','X','J','V','S','D'].map((d, i) => {
                                const active = localTask.recurrence?.weekDays?.includes(i);
                                return (
                                  <button
                                    key={d}
                                    onClick={() => {
                                      const curr = localTask.recurrence?.weekDays || [];
                                      const next = curr.includes(i) ? curr.filter(v => v !== i) : [...curr, i];
                                      setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, weekDays: next } }));
                                    }}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black border transition-all ${
                                      active
                                        ? 'bg-turquesa border-turquesa text-white'
                                        : 'dark:bg-bg-secondary bg-bg-secondary-light dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'
                                    }`}
                                  >{d}</button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Día del mes */}
                        {localTask.recurrence!.frequency === 'monthly' && (
                          <div className="space-y-1">
                            <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día del mes (1-31)</label>
                            <input
                              type="number" min="1" max="31"
                              className="w-full p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold text-turquesa outline-none text-center"
                              value={localTask.recurrence!.monthDay || parseLocalISO(localTask.recurrence!.startDate || formatLocalISO(new Date())).getDate()}
                              onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, monthDay: parseInt(e.target.value) || 1 } }))}
                            />
                          </div>
                        )}

                        {/* Día y mes anual */}
                        {localTask.recurrence!.frequency === 'yearly' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día</label>
                              <input type="number" min="1" max="31"
                                className="w-full p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold text-turquesa outline-none text-center"
                                value={localTask.recurrence!.yearDay || new Date().getDate()}
                                onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearDay: parseInt(e.target.value) || 1 } }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mes</label>
                              <input type="number" min="1" max="12"
                                className="w-full p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold text-turquesa outline-none text-center"
                                value={localTask.recurrence!.yearMonth || new Date().getMonth() + 1}
                                onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearMonth: parseInt(e.target.value) || 1 } }))}
                              />
                            </div>
                          </div>
                        )}

                        {/* Termina */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Termina</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: undefined } }))}
                              className={`flex-1 px-2 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${!localTask.recurrence!.endDate ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'}`}
                            >Nunca</button>
                            <button
                              onClick={() => {
                                if (!localTask.recurrence!.endDate) {
                                  const d = new Date(); d.setMonth(d.getMonth() + 6);
                                  setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: formatLocalISO(d) } }));
                                }
                              }}
                              className={`flex-1 px-2 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${localTask.recurrence!.endDate ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'}`}
                            >El</button>
                          </div>
                          {localTask.recurrence!.endDate && (
                            <input
                              type="date"
                              value={localTask.recurrence!.endDate}
                              onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: e.target.value } }))}
                              className="w-full p-2 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-[11px] font-bold text-turquesa outline-none text-center"
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Subtareas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Subtareas</span>
              <button
                disabled={locked}
                onClick={() => {
                  const nid = onAddTask(localTask.id, localTask.blockId, localTask.dueDate || localTask.instanceDate || undefined);
                  if (nid) {
                    setLocalTask(prev => ({ ...prev, subtasks: [nid, ...(prev.subtasks || [])] }));
                    setSubtaskTitles(prev => ({ ...prev, [nid]: '' }));
                    setFocusedSubtaskId(nid);
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-turquesa/10 hover:bg-turquesa/20 text-turquesa rounded-xl transition-all text-[10px] font-black uppercase tracking-widest border border-turquesa/20"
              >
                <Plus size={11} /> Añadir
              </button>
            </div>

            <div className="space-y-1.5">
              {subtasks.map((st: Task) => (
                <div key={st.id} className="flex gap-2 items-start dark:bg-bg-main/40 bg-white p-3 rounded-xl border dark:border-border-main border-border-main-light group">
                  <button
                    disabled={locked}
                    onClick={() => handleUpdateSubtask(st.id, { status: st.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() })}
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      st.status === 'completed' ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light hover:border-turquesa'
                    }`}
                  >
                    {st.status === 'completed' && <Check size={8} />}
                  </button>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <input
                      readOnly={locked}
                      autoFocus={st.id === focusedSubtaskId}
                      onFocus={() => {
                        if (st.id === focusedSubtaskId) setFocusedSubtaskId(null);
                        // Inicializar título local si no existe
                        if (subtaskTitles[st.id] === undefined) {
                          setSubtaskTitles(prev => ({ ...prev, [st.id]: st.title }));
                        }
                      }}
                      className={`w-full bg-transparent text-[12px] font-bold dark:text-white text-text-main-light outline-none border-b dark:border-border-main border-border-main-light/20 focus:border-turquesa transition-all pb-0.5 ${st.status === 'completed' ? 'line-through opacity-50' : ''}`}
                      value={subtaskTitles[st.id] !== undefined ? subtaskTitles[st.id] : st.title}
                      onChange={e => setSubtaskTitles(prev => ({ ...prev, [st.id]: e.target.value }))}
                      onBlur={e => {
                        const newTitle = subtaskTitles[st.id] !== undefined ? subtaskTitles[st.id] : st.title;
                        handleUpdateSubtask(st.id, { title: newTitle });
                        setSubtaskTitles(prev => { const n = { ...prev }; delete n[st.id]; return n; });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      placeholder="Título del paso..."
                    />
                    <div className={`flex flex-wrap items-center gap-1 ${locked ? 'pointer-events-none' : ''}`}>
                      {!st.isTemplate && st.dueDate && (
                        <TimePickerChip value={st.dueTime || ''} onChange={(time: string) => handleUpdateSubtask(st.id, { dueTime: time })} />
                      )}
                      <DatePickerChip value={st.dueDate} onChange={(date: string) => handleUpdateSubtask(st.id, { dueDate: date })} />
                      {!st.templateId && (!st.subtasks || st.subtasks.length === 0) && (
                        <RecurrencePickerChip
                          value={st.recurrence}
                          defaultDate={st.dueDate || null} // C4: la pauta arranca en la fecha de la tarea, no hoy
                          onChange={(rec: any) => handleUpdateSubtask(st.id, {
                            recurrence: rec || undefined,
                            isTemplate: !!rec,
                            dueDate: rec ? null : (st.dueDate || formatLocalISO(new Date())),
                            dueTime: st.dueTime
                          })}
                        />
                      )}
                      <TagPickerChip selectedTags={st.tags || []} onChange={(tags: TagType[]) => handleUpdateSubtask(st.id, { tags })} />
                      <DelegationChip
                        delegation={st.delegation} people={people}
                        onChange={(delegation: any) => handleUpdateSubtask(st.id, { delegation })}
                        onAddPerson={onAddPerson} onRenamePerson={onRenamePerson} onDeletePerson={onDeletePerson}
                      />
                      <EstimatedTimeChip value={st.estimatedMinutes || 0} onChange={(val: number) => handleUpdateSubtask(st.id, { estimatedMinutes: val })} variant="mini" />
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 transition-all shrink-0 ${locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button onClick={() => onEditTask(st.id)} title="Entrar en la subtarea" className="p-1.5 dark:text-text-secondary text-text-secondary-light hover:text-turquesa transition-all">
                      <Edit size={13} />
                    </button>
                    {!locked && (
                      <button onClick={() => onDeleteTask(st.id)} className="p-1.5 dark:text-text-secondary text-text-secondary-light hover:text-rosa transition-all">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {subtasks.length === 0 && (
                <div className="py-4 border-2 border-dashed dark:border-border-main border-border-main-light rounded-xl flex items-center justify-center dark:text-text-secondary text-text-secondary-light opacity-40">
                  <p className="text-[11px] italic">Sin subtareas</p>
                </div>
              )}
            </div>
          </div>

          {/* Notas — EXCEPCIÓN explícita a "completada = no editable" (sesión 15): las notas son un
              CUADERNO, no un valor de la tarea. Se editan siempre, aunque esté completada. No poner readOnly. */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Notas</label>
            <textarea
              ref={notesRef}
              rows={2}
              className="w-full p-3 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl text-[12px] font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 resize-none placeholder:dark:text-text-secondary/30 placeholder:text-text-secondary-light/30 overflow-hidden"
              placeholder="Anota cualquier detalle relevante..."
              value={localTask.notes || ''}
              onChange={e => setLocalTask(prev => ({ ...prev, notes: e.target.value }))}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = t.scrollHeight + 'px';
              }}
            />
          </div>

          {/* Adjuntos */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between pl-1">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Adjuntos</label>
              <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border cursor-pointer transition-all text-[10px] font-black uppercase tracking-widest ${
                (uploading || locked) ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa'
              }`}>
                <Paperclip size={11} />
                {uploading ? 'Subiendo...' : 'Adjuntar'}
                <input type="file" className="hidden" disabled={uploading || locked} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !onUploadAttachment) return;
                  setUploading(true);
                  await onUploadAttachment(localTask.id, file);
                  setUploading(false);
                  e.target.value = '';
                }} />
              </label>
            </div>
            {(localTask.attachments && localTask.attachments.length > 0) ? (
              <div className="space-y-1.5">
                {localTask.attachments.map((att: any) => {
                  const isImage = att.type?.startsWith('image/');
                  return (
                    <div key={att.id} className="flex items-center gap-2 p-2.5 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl group">
                      {isImage ? (
                        <img src={att.url} alt={att.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0 cursor-pointer" onClick={() => window.open(att.url, '_blank')} />
                      ) : (
                        <div className="w-8 h-8 rounded-lg dark:bg-bg-card bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Paperclip size={13} className="text-turquesa" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold dark:text-white text-text-main-light truncate">{att.name}</p>
                        <p className="text-[9px] dark:text-text-secondary text-text-secondary-light">{att.size ? `${Math.round(att.size / 1024)}KB` : ''}</p>
                      </div>
                      <div className={`flex items-center gap-1 transition-opacity ${locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <a href={att.url} target="_blank" rel="noopener noreferrer" className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/10 hover:bg-turquesa/20 rounded-lg transition-all">
                          <Eye size={11} />
                        </a>
                        {!locked && (
                          <button onClick={() => onDeleteAttachment && onDeleteAttachment(localTask.id, att.id, att.path)} className="w-6 h-6 flex items-center justify-center text-rosa bg-rosa/10 hover:bg-rosa/20 rounded-lg transition-all">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-4 text-center border-2 border-dashed dark:border-border-main border-border-main-light rounded-xl dark:text-text-secondary text-text-secondary-light opacity-40">
                <Paperclip size={16} className="mx-auto mb-1" />
                <p className="text-[10px] font-bold uppercase tracking-widest">Sin adjuntos</p>
              </div>
            )}
          </div>

        </div>
      </motion.div>
    </div>
  );
}
