/**
 * TaskModal.tsx
 *
 * Modal de configuración de tarea (puntual o recurrente).
 * Extraído de App.tsx — era la función TaskModal() interna.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon, Clock, Trash2, X, RefreshCw,
  Plus, Edit, Check, ArrowUpLeft, Paperclip, Eye
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Task, TagType } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { TAG_LABELS } from './constants';
import {
  DelegationChip, DatePickerChip, TagPickerChip, RecurrencePickerChip,
  EstimatedTimeChip, TimePickerChip, MonthDatePicker
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
}: TaskModalProps) {
  const [localTask, setLocalTask] = useState<Task>(task);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(null);
  const [showDateSelector, setShowDateSelector] = useState(false);
  const [uploading, setUploading] = useState(false);
  const tags: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];

  useEffect(() => {
    setLocalTask(task);
  }, [task.id]);

  useEffect(() => {
    setLocalTask(prev => ({ ...prev, attachments: task.attachments || [] }));
  }, [JSON.stringify(task.attachments)]);

  const subtasks = useMemo(() => {
    return (localTask.subtasks || [])
      .map(id => allTasksMap[id])
      .filter(Boolean)
      .sort((a, b) => (a?.order || 0) - (b?.order || 0));
  }, [localTask.subtasks, allTasksMap]);

  const handleUpdateSubtask = (sid: string, updates: Partial<Task>) => {
    const subtask = allTasksMap[sid];
    onSave({ ...subtask, ...updates });

    const hasRecurrence = updates.recurrence !== undefined
      ? !!updates.recurrence
      : !!subtask?.recurrence;

    if (hasRecurrence && subtask?.parentTaskId) {
      const parent = allTasksMap[subtask.parentTaskId];
      if (parent && (!parent.isTemplate || parent.dueDate)) {
        onSave({ ...parent, isTemplate: true, dueDate: null });
      }
    }
  };

  const frequencies = [
    { id: 'daily', label: 'Diaria' },
    { id: 'weekdays', label: 'L-V' },
    { id: 'weekly', label: 'Semanal' },
    { id: 'monthly', label: 'Mensual' },
    { id: 'yearly', label: 'Anual' }
  ];

  return (
    <div className="fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        key={localTask.id}
        className="dark:bg-bg-card bg-white w-full max-w-xl rounded-[1.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.5)] border dark:border-border-main border-border-main-light overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="p-4 border-b dark:border-border-main border-border-main-light flex justify-between items-start dark:bg-bg-card bg-white">
          <div className="flex-1 flex items-start gap-4">
            {localTask.parentTaskId && (
              <button
                onClick={() => onEditTask(localTask.parentTaskId!)}
                className="p-2 bg-turquesa/10 text-turquesa rounded-xl border border-turquesa/20 hover:bg-turquesa/20 transition-all mt-6"
                title="Volver al padre"
              >
                <ArrowUpLeft size={16} />
              </button>
            )}
            <div className="flex-1">
              <p className="text-[10px] font-black text-turquesa uppercase tracking-[0.2em] mb-2">
                {localTask.templateId
                  ? 'Instancia de Tarea Repetitiva'
                  : (localTask.recurrence || localTask.isTemplate)
                    ? 'Configurar Tarea Repetitiva'
                    : 'Configurar Tarea Puntual'}
              </p>
              <input
                autoFocus
                className="text-xl font-black w-full bg-transparent outline-none placeholder:text-text-secondary dark:text-white text-text-main-light"
                value={localTask.title}
                onChange={e => setLocalTask(prev => ({ ...prev, title: e.target.value }))}
                placeholder="¿Qué hay que hacer?"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onToggleStatus && (
              <button
                onClick={() => {
                  onToggleStatus(localTask.id);
                  onClose();
                }}
                title={localTask.status === 'completed' ? 'Marcar pendiente' : 'Completar'}
                className={`p-3 rounded-2xl border transition-all ${
                  localTask.status === 'completed'
                    ? 'dark:bg-bg-secondary bg-bg-secondary-light dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa'
                    : 'bg-turquesa/10 border-turquesa/40 text-turquesa hover:bg-turquesa/20'
                }`}
              >
                <Check size={18} />
              </button>
            )}
            <button
              onClick={() => { onDeleteTask(localTask.id); onClose(); }}
              title="Eliminar tarea"
              className="p-3 dark:bg-bg-secondary bg-bg-secondary-light dark:hover:bg-rosa/10 hover:bg-rosa/5 rounded-2xl border dark:border-border-main border-border-main-light text-rosa border-rosa/20 transition-all"
            >
              <Trash2 size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-3 dark:bg-bg-secondary bg-bg-secondary-light dark:hover:bg-bg-main hover:bg-gray-200 rounded-2xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          {/* Core/Ad-hoc Toggle */}
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Tipo de Tarea</label>
            <div className="flex gap-3 dark:bg-bg-main bg-white p-1 rounded-2xl border dark:border-border-main border-border-main-light">
              <button
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'core' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl transition-all ${localTask.taskType === 'core' || ((localTask.recurrence || localTask.isTemplate) && !localTask.taskType) ? 'bg-turquesa dark:text-white text-text-main-light shadow-lg' : 'text-text-secondary hover:text-white hover:bg-white/5'}`}
              >
                <span className="text-[11px] font-black uppercase tracking-widest">Puesto (CORE)</span>
              </button>
              <button
                onClick={() => setLocalTask(prev => ({ ...prev, taskType: 'adhoc' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl transition-all ${localTask.taskType === 'adhoc' || ((!localTask.recurrence && !localTask.isTemplate) && !localTask.taskType) ? 'bg-rosa dark:text-white text-text-main-light shadow-lg' : 'text-text-secondary hover:text-white hover:bg-white/5'}`}
              >
                <span className="text-[11px] font-black uppercase tracking-widest">Puntual (AD-HOC)</span>
              </button>
            </div>
          </div>

          {/* Delegación */}
          {!(localTask.subtasks && localTask.subtasks.length > 0) && (
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Delegar a</label>
              <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-3">
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
            </div>
          )}

          {/* Main Config Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Bloque / Contexto</label>
              <select
                className="w-full p-2 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 appearance-none cursor-pointer"
                value={localTask.blockId}
                onChange={e => setLocalTask(prev => ({ ...prev, blockId: e.target.value }))}
              >
                {blocks.filter((b: any) => b.isActive).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Estimado (min)</label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-turquesa" size={16} />
                <input
                  type="number"
                  className="w-full pl-10 pr-4 py-2 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20"
                  value={localTask.estimatedMinutes || ''}
                  onChange={e => setLocalTask(prev => ({ ...prev, estimatedMinutes: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          {/* Categoría */}
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Categoría</label>
            {localTask.subtasks && localTask.subtasks.length > 0 ? (
              <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-3 flex items-center gap-2">
                <span className="text-lg">🗂️</span>
                <p className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light">
                  Las tareas contenedor no tienen etiqueta. La etiqueta la asignan sus subtareas.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map(t => {
                  const active = localTask.tags.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setLocalTask(prev => ({ ...prev, tags: [t] }))}
                      className={`px-4 py-3 rounded-xl text-xl border transition-all flex items-center justify-center ${active ? 'bg-turquesa border-turquesa shadow-lg shadow-turquesa/20' : 'dark:bg-bg-main bg-gray-50 dark:border-border-main border-border-main-light hover:border-turquesa/50'}`}
                      title={TAG_LABELS[t].label}
                    >
                      {TAG_LABELS[t].icon}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fecha de ejecución */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Fecha de ejecución</label>
            </div>

            <div className="dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CalendarIcon size={18} className="text-turquesa" />
                  <span className="text-sm font-bold dark:text-white text-text-main-light">
                    {localTask.dueDate ? (() => {
                      const d = parseLocalISO(localTask.dueDate);
                      const dd = d.getDate().toString().padStart(2, '0');
                      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
                      const yyyy = d.getFullYear();
                      return `${dd}-${mm}-${yyyy}`;
                    })() : 'Sin fecha asignada'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowDateSelector(!showDateSelector)}
                    className={`p-2 rounded-lg transition-all ${showDateSelector ? 'bg-turquesa dark:text-white text-text-main-light' : 'text-turquesa hover:bg-turquesa/10'}`}
                    title="Modificar fecha"
                  >
                    <CalendarIcon size={18} />
                  </button>
                  {localTask.dueDate && (
                    <button
                      onClick={() => setLocalTask(prev => ({ ...prev, dueDate: null, dueTime: '' }))}
                      className="p-2 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                      title="Eliminar fecha"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>

              {!localTask.recurrence && (
                <div className="flex items-center gap-3 pt-2 border-t dark:border-border-main/30 border-border-main-light/30">
                  <Clock size={16} className="text-azul shrink-0" />
                  <span className="text-xs font-bold dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hora</span>
                  <input
                    type="time"
                    value={localTask.dueTime || ''}
                    onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                    className="flex-1 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-1.5 text-sm font-bold text-azul outline-none focus:border-azul/50"
                  />
                  {localTask.dueTime && (
                    <button
                      onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))}
                      className="p-1.5 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {showDateSelector && (
              <div className="p-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-[2rem] animate-in fade-in slide-in-from-top-2">
                <div className="mb-4 flex items-center justify-between px-2">
                  <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Seleccionar Día</span>
                </div>
                <MonthDatePicker
                  value={localTask.dueDate}
                  onChange={(d) => {
                    setLocalTask(prev => ({ ...prev, dueDate: d }));
                    setShowDateSelector(false);
                  }}
                />
              </div>
            )}
          </div>

          {/* Recurrencia */}
          <div className="p-6 dark:bg-bg-main/20 bg-gray-100/50 border dark:border-border-main border-border-main-light rounded-[2rem] space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw size={20} className={localTask.recurrence || localTask.templateId ? 'text-turquesa' : 'dark:text-text-secondary text-text-secondary-light'} />
                <h3 className="text-sm font-black dark:text-white text-text-main-light uppercase tracking-widest">Recurrencia (Repetir tarea)</h3>
              </div>
              {localTask.templateId ? (
                <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-turquesa/20 text-turquesa border border-turquesa/30">
                  SERIE ACTIVA
                </span>
              ) : (
                <button
                  onClick={() => setLocalTask(prev => ({
                    ...prev,
                    recurrence: prev.recurrence ? undefined : { frequency: 'daily', startDate: prev.dueDate || formatLocalISO(new Date()) },
                    isTemplate: !prev.recurrence,
                    dueDate: prev.recurrence ? (prev.dueDate || formatLocalISO(new Date())) : null
                  }))}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${localTask.recurrence ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-gray-200 dark:text-text-secondary text-text-secondary-light'}`}
                >
                  {localTask.recurrence ? 'ACTIVA' : 'DESACTIVADA'}
                </button>
              )}
            </div>

            {/* Info instancia recurrente */}
            {localTask.templateId && (() => {
              const template = allTasksMap[localTask.templateId];
              const rec = template?.recurrence ||
                (template?.parentTaskId ? allTasksMap[template.parentTaskId]?.recurrence : null);

              const formatRecurrence = () => {
                if (!rec) return null;
                const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
                const freq = rec.frequency || rec.type || rec.freq;
                if (!freq) return null;
                if (freq === 'daily') return 'Diaria — todos los días';
                if (freq === 'weekdays') return 'Semanal — Lun, Mar, Mié, Jue, Vie';
                if (freq === 'weekly') {
                  const days = (rec.weekDays || rec.days || []).map((d: number) => dayNames[d]).join(', ');
                  return `Semanal — ${days || 'todos los días'}`;
                }
                if (freq === 'monthly') {
                  const day = rec.monthDay || rec.day || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '?');
                  return `Mensual — día ${day}`;
                }
                if (freq === 'yearly') {
                  const yd = rec.yearDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : null);
                  const ym = rec.yearMonth || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getMonth() + 1 : null);
                  if (yd && ym) {
                    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
                    return `Anual — ${yd} de ${months[ym - 1]}`;
                  }
                  return 'Anual';
                }
                return freq;
              };

              const recDesc = formatRecurrence();

              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 dark:bg-turquesa/10 bg-turquesa/5 border border-turquesa/20 rounded-xl">
                    <RefreshCw size={14} className="text-turquesa shrink-0" />
                    <p className="text-xs dark:text-text-secondary text-text-secondary-light">
                      Esta tarea es una <span className="text-turquesa font-bold">instancia de una serie recurrente</span>. Los cambios solo afectan a este día concreto.
                    </p>
                  </div>
                  {recDesc && (
                    <div className="flex items-center gap-3 p-3 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl">
                      <RefreshCw size={12} className="text-turquesa shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Patrón de repetición</span>
                        <span className="text-xs font-bold text-turquesa">{recDesc}</span>
                        {rec.startDate && (
                          <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">
                            Desde {new Date(rec.startDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {!recDesc && (
                    <div className="flex items-center gap-3 p-3 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl">
                      <RefreshCw size={12} className="text-turquesa shrink-0" />
                      <span className="text-xs dark:text-text-secondary text-text-secondary-light">Parte de una serie recurrente</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Config recurrencia activa */}
            {localTask.recurrence && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Frecuencia</label>
                    <div className="flex dark:bg-bg-secondary bg-bg-secondary-light rounded-xl p-1 gap-1">
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
                          className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${localTask.recurrence?.frequency === f.id ? 'bg-turquesa dark:text-white text-text-main-light' : 'text-text-secondary hover:text-white'}`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Inicio de Serie</label>
                    <input
                      type="date"
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold dark:text-white text-text-main-light outline-none"
                      value={localTask.recurrence.startDate}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, startDate: e.target.value } }))}
                    />
                  </div>
                </div>

                {/* Hora para recurrentes */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Hora de ejecución (opcional)</label>
                  <div className="flex items-center gap-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl p-3">
                    <Clock size={14} className="text-azul shrink-0" />
                    <input
                      type="time"
                      value={localTask.dueTime || ''}
                      onChange={e => setLocalTask(prev => ({ ...prev, dueTime: e.target.value }))}
                      className="flex-1 bg-transparent text-sm font-bold text-azul outline-none"
                    />
                    {localTask.dueTime && (
                      <button
                        onClick={() => setLocalTask(prev => ({ ...prev, dueTime: '' }))}
                        className="p-1 text-rosa hover:bg-rosa/10 rounded-lg transition-all"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {localTask.recurrence.frequency === 'weekly' && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Días de ejecución</label>
                    <div className="flex justify-between gap-1">
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
                            className={`flex-1 py-1 px-1 aspect-square rounded-lg text-[9px] font-black border transition-all ${active ? 'bg-turquesa border-turquesa dark:text-white text-text-main-light' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {localTask.recurrence.frequency === 'monthly' && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día del mes (1-31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                      value={localTask.recurrence.monthDay || parseLocalISO(localTask.recurrence.startDate || formatLocalISO(new Date())).getDate()}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, monthDay: parseInt(e.target.value) || 1 } }))}
                    />
                  </div>
                )}

                {localTask.recurrence.frequency === 'yearly' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Día (1-31)</label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                        value={localTask.recurrence.yearDay || new Date().getDate()}
                        onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearDay: parseInt(e.target.value) || 1 } }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mes (1-12)</label>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                        value={localTask.recurrence.yearMonth || new Date().getMonth() + 1}
                        onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, yearMonth: parseInt(e.target.value) || 1 } }))}
                      />
                    </div>
                  </div>
                )}

                {/* Termina */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Termina:</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: undefined } }))}
                      className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${!localTask.recurrence.endDate ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'}`}
                    >
                      Nunca
                    </button>
                    <button
                      onClick={() => {
                        if (!localTask.recurrence!.endDate) {
                          const sixMonthsLater = new Date();
                          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                          setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: formatLocalISO(sixMonthsLater) } }));
                        }
                      }}
                      className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${localTask.recurrence.endDate ? 'bg-turquesa text-white' : 'dark:bg-bg-secondary bg-bg-secondary-light dark:text-text-secondary text-text-secondary-light'}`}
                    >
                      El
                    </button>
                  </div>
                  {localTask.recurrence.endDate && (
                    <input
                      type="date"
                      value={localTask.recurrence.endDate}
                      onChange={e => setLocalTask(prev => ({ ...prev, recurrence: { ...prev.recurrence!, endDate: e.target.value } }))}
                      className="w-full p-3 dark:bg-bg-secondary bg-bg-secondary-light border dark:border-border-main border-border-main-light rounded-xl text-xs font-bold text-turquesa outline-none text-center focus:ring-2 focus:ring-turquesa/20"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Subtareas */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black dark:text-white text-text-main-light uppercase tracking-[0.1em]">Pasos / Subtareas</h3>
              <button
                onClick={() => {
                  const nid = onAddTask(localTask.id);
                  if (nid) setFocusedSubtaskId(nid);
                }}
                className="flex items-center gap-2 p-3 bg-turquesa/10 hover:bg-turquesa/20 text-turquesa rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest"
              >
                <Plus size={14} /> Añadir Paso
              </button>
            </div>

            <div className="space-y-3">
              {subtasks.map((st: Task) => (
                <div key={st.id} className="flex gap-3 items-start dark:bg-bg-main/40 bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light group">
                  <button
                    onClick={() => handleUpdateSubtask(st.id, { status: st.status === 'completed' ? 'pending' : 'completed', modifiedAt: new Date().toISOString() })}
                    className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${st.status === 'completed' ? 'bg-turquesa border-turquesa text-white' : 'dark:border-border-main border-border-main-light hover:border-turquesa'}`}
                  >
                    {st.status === 'completed' && <Check size={10} />}
                  </button>
                  <div className="flex-1 space-y-3">
                    <input
                      autoFocus={st.id === focusedSubtaskId}
                      onFocus={() => { if (st.id === focusedSubtaskId) setFocusedSubtaskId(null); }}
                      className={`w-full bg-transparent text-sm font-bold dark:text-white text-text-main-light outline-none border-b dark:border-border-main border-border-main-light/20 focus:border-turquesa transition-all py-1 ${st.status === 'completed' ? 'line-through' : ''}`}
                      value={st.title}
                      onChange={e => handleUpdateSubtask(st.id, { title: e.target.value })}
                      placeholder="Título del paso..."
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!st.isTemplate && st.dueDate && (
                        <TimePickerChip
                          value={st.dueTime || ''}
                          onChange={(time: string) => handleUpdateSubtask(st.id, { dueTime: time })}
                        />
                      )}
                      <DatePickerChip
                        value={st.dueDate}
                        onChange={(date: string) => handleUpdateSubtask(st.id, { dueDate: date })}
                      />
                      {!st.templateId && (!st.subtasks || st.subtasks.length === 0) ? (
                        <RecurrencePickerChip
                          value={st.recurrence}
                          onChange={(rec: any) => handleUpdateSubtask(st.id, {
                            recurrence: rec || undefined,
                            isTemplate: !!rec,
                            dueDate: rec ? null : (st.dueDate || formatLocalISO(new Date())),
                            dueTime: st.dueTime
                          })}
                        />
                      ) : null}
                      <TagPickerChip
                        selectedTags={st.tags || []}
                        onChange={(tags: TagType[]) => handleUpdateSubtask(st.id, { tags })}
                      />
                      <DelegationChip
                        delegation={st.delegation}
                        people={people}
                        onChange={(delegation: any) => handleUpdateSubtask(st.id, { delegation })}
                        onAddPerson={onAddPerson}
                        onRenamePerson={onRenamePerson}
                        onDeletePerson={onDeletePerson}
                      />
                      <EstimatedTimeChip
                        value={st.estimatedMinutes || 0}
                        onChange={(val: number) => handleUpdateSubtask(st.id, { estimatedMinutes: val })}
                        variant="mini"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => onEditTask(st.id)}
                      className="p-2 dark:text-text-secondary text-text-secondary-light hover:text-turquesa"
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => onDeleteTask(st.id)}
                      className="p-2 dark:text-text-secondary text-text-secondary-light hover:text-rosa"
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {subtasks.length === 0 && (
                <div className="py-8 border-2 border-dashed dark:border-border-main border-border-main-light rounded-[2rem] flex flex-col items-center justify-center dark:text-text-secondary text-text-secondary-light italic">
                  <p className="text-xs">Sin subtareas configuradas</p>
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          <div className="space-y-3">
            <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest pl-1">Notas y Detalles</label>
            <textarea
              rows={4}
              className="w-full p-4 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl text-sm font-bold dark:text-white text-text-main-light outline-none focus:ring-2 focus:ring-turquesa/20 resize-none placeholder:text-text-secondary/30"
              placeholder="Anota cualquier detalle relevante..."
              value={localTask.notes || ''}
              onChange={e => setLocalTask(prev => ({ ...prev, notes: e.target.value }))}
            />
          </div>

          {/* Adjuntos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pl-1">
              <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Adjuntos</label>
              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border cursor-pointer transition-all text-[10px] font-black uppercase tracking-widest ${uploading ? 'opacity-50 cursor-not-allowed' : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa'}`}>
                <Paperclip size={12} />
                {uploading ? 'Subiendo...' : 'Adjuntar'}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !onUploadAttachment) return;
                    setUploading(true);
                    await onUploadAttachment(localTask.id, file);
                    setUploading(false);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {(localTask.attachments && localTask.attachments.length > 0) ? (
              <div className="space-y-2">
                {localTask.attachments.map((att: any) => {
                  const isImage = att.type?.startsWith('image/');
                  return (
                    <div key={att.id} className="flex items-center gap-3 p-3 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl group">
                      {isImage ? (
                        <img src={att.url} alt={att.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 cursor-pointer" onClick={() => window.open(att.url, '_blank')} />
                      ) : (
                        <div className="w-10 h-10 rounded-lg dark:bg-bg-card bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Paperclip size={16} className="text-turquesa" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold dark:text-white text-text-main-light truncate">{att.name}</p>
                        <p className="text-[10px] dark:text-text-secondary text-text-secondary-light">{att.size ? `${Math.round(att.size / 1024)}KB` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a href={att.url} target="_blank" rel="noopener noreferrer" className="w-7 h-7 flex items-center justify-center text-turquesa bg-turquesa/10 hover:bg-turquesa/20 rounded-lg transition-all">
                          <Eye size={12} />
                        </a>
                        <button
                          onClick={() => onDeleteAttachment && onDeleteAttachment(localTask.id, att.id, att.path)}
                          className="w-7 h-7 flex items-center justify-center text-rosa bg-rosa/10 hover:bg-rosa/20 rounded-lg transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-6 text-center border-2 border-dashed dark:border-border-main border-border-main-light rounded-2xl dark:text-text-secondary text-text-secondary-light opacity-40">
                <Paperclip size={20} className="mx-auto mb-2" />
                <p className="text-[10px] font-bold uppercase tracking-widest">Sin adjuntos</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-8 dark:bg-bg-main/20 bg-gray-100/50 border-t dark:border-border-main border-border-main-light flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 py-5 rounded-3xl text-sm font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light dark:hover:bg-bg-secondary hover:bg-gray-200 transition-all"
          >
            Cerrar
          </button>
          <button
            onClick={() => {
              const taskToSave = localTask.templateId
                ? { ...localTask, isException: true, existsInSupabase: true }
                : localTask;
              onSave(taskToSave);
              onClose();
            }}
            className="flex-[2] py-5 bg-gradient-to-r from-turquesa to-azul rounded-3xl text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-turquesa/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Guardar Cambios
          </button>
        </div>
      </motion.div>
    </div>
  );
}
