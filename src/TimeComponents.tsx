/**
 * TimeComponents.tsx
 * TimerDisplay, TimeManagementPanel, MonthDatePicker
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Check, X, Clock, Edit, Trash2, History, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Zap, Target } from 'lucide-react';
import { motion } from 'framer-motion';
import { Task, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { getTaskEstimatedCombo, getTaskRegisteredCombo, getTaskRegisteredSelf } from './utils';

export function TimerDisplay({ startTime, accumulatedSeconds }: { startTime: string, accumulatedSeconds: number }) {
  const [now, setNow] = useState(new Date().getTime());
 
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(interval);
  }, []);
 
  const totalSeconds = Math.floor((now - new Date(startTime).getTime()) / 1000) + (accumulatedSeconds || 0);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
 
  return (
    <span className="font-mono text-xs font-black text-white">
      {h > 0 ? `${h}h ` : ''}{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </span>
  );
}

export function TimeManagementPanel({ taskId, subtaskId, allTasksMap, timeEntries, onAddEntry, onDeleteEntry, onUpdateEntry, onClose }: any) {
  const [activeTab, setActiveTab] = useState<'register' | 'history'>('register');
  const task = subtaskId ? allTasksMap[subtaskId] : allTasksMap[taskId];
  const parentTask = allTasksMap[taskId];
  const hasSubtasks = parentTask.subtasks && parentTask.subtasks.length > 0;
  
  const entries = useMemo(() => {
    return timeEntries.filter((e: TimeEntry) => {
      if (subtaskId) return e.subtaskId === subtaskId;
      if (e.taskId === taskId) return true;
      const isSubtaskEntry = (Object.values(allTasksMap) as Task[]).some(t => t.id === e.taskId && t.parentTaskId === taskId);
      return isSubtaskEntry;
    }).sort((a: any, b: any) => parseLocalISO(b.date).getTime() - parseLocalISO(a.date).getTime());
  }, [timeEntries, taskId, subtaskId, allTasksMap]);
 
  const totalRegistered = getTaskRegisteredSelf(subtaskId || taskId, timeEntries);
  const comboRegistered = subtaskId ? totalRegistered : getTaskRegisteredCombo(taskId, allTasksMap, timeEntries);
  const estimated = subtaskId ? task.estimatedMinutes : getTaskEstimatedCombo(taskId, allTasksMap);
 
  const [newMinutes, setNewMinutes] = useState(estimated || 30);
  const [newDate, setNewDate] = useState(formatLocalISO(new Date()));
  const [newNote, setNewNote] = useState('');
  const [markComplete, setMarkComplete] = useState(false);
  
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState(0);
  const [editNote, setEditNote] = useState('');
 
  const startEdit = (entry: any) => {
    setEditingEntryId(entry.id);
    setEditMinutes(entry.duration);
    setEditNote(entry.note || '');
  };
 
  const saveEdit = () => {
    if (editingEntryId) {
      onUpdateEntry(editingEntryId, {
        duration: editMinutes,
        note: editNote
      });
      setEditingEntryId(null);
    }
  };
 
  return (
    <div className="fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[300] flex items-end justify-center">
      <motion.div 
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="w-full max-w-xl dark:bg-bg-main bg-white border-t border-x dark:border-border-main border-border-main-light rounded-t-[28px] p-3 shadow-2xl flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-black dark:text-white text-text-main-light uppercase tracking-tighter">
              {task?.title || 'Gestionar Tiempo'}
            </h2>
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">Panel de Control de Horas</p>
          </div>
          <button onClick={onClose} className="p-2 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl dark:hover:bg-bg-main hover:bg-gray-200 transition-all">
            <X size={18} className="dark:text-text-secondary text-text-secondary-light" />
          </button>
        </div>
 
        {/* Tab Navigation */}
        <div className="flex p-1 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-2xl mb-2">
          <button 
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 px-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === 'register' ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'}`}
          >
            <Plus size={14} /> Registro
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 px-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'}`}
          >
            <History size={14} /> Historial
          </button>
        </div>
 
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'register' ? (
            <div className="space-y-2 overflow-y-auto custom-scrollbar px-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[20px] relative overflow-hidden group">
                  <div className="absolute top-3 right-3 opacity-20"><Zap size={18} className="text-turquesa" /></div>
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-1">Total Registrado</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-turquesa">{comboRegistered}</span>
                    <span className="text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase">min</span>
                  </div>
                  {!subtaskId && hasSubtasks && (
                    <p className="text-[8px] font-bold dark:text-text-secondary text-text-secondary-light mt-1">Propio: {totalRegistered}m · Subtareas: {comboRegistered - totalRegistered}m</p>
                  )}
                </div>
 
                <div className="p-3 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[20px]">
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3 text-center">Plan v Realidad</p>
                  <div className="flex items-center justify-center gap-4 mb-3">
                    <span className="text-lg font-black dark:text-text-secondary text-text-secondary-light">{estimated}m</span>
                    <ArrowRight size={16} className="dark:text-text-secondary/30 text-text-secondary-light/30" />
                    <span className="text-lg font-black dark:text-white text-text-main-light">{comboRegistered}m</span>
                  </div>
                  <div className="h-1.5 dark:bg-bg-main bg-gray-200 border dark:border-border-main border-border-main-light rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${comboRegistered > estimated ? 'bg-rosa' : 'bg-turquesa'}`}
                      style={{ width: `${Math.min(100, (comboRegistered / Math.max(1, estimated)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
 
              <div className="p-3 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[20px] space-y-2">
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">¿Qué hiciste en esta sesión?</label>
                    <textarea 
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Describe brevemente tu progreso..."
                      className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-2 text-sm font-medium dark:text-white text-text-main-light placeholder:text-text-secondary/30 outline-none focus:border-turquesa/50 transition-all resize-none h-14"
                    />
                  </div>
 
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Minutos</label>
                      <input 
                        type="number"
                        value={newMinutes}
                        onChange={(e) => setNewMinutes(parseInt(e.target.value) || 0)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-2 text-lg font-black text-turquesa outline-none focus:border-turquesa/50 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Fecha</label>
                      <input 
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-2 text-xs font-black dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all uppercase"
                      />
                    </div>
                  </div>
                </div>
 
                <label className="flex items-center gap-3 cursor-pointer group px-1">
                  <div
                    onClick={() => setMarkComplete(v => !v)}
                    className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0 ${markComplete ? 'bg-turquesa border-turquesa' : 'dark:border-border-main border-border-main-light'}`}
                  >
                    {markComplete && <Check size={12} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-xs font-bold dark:text-text-secondary text-text-secondary-light group-hover:dark:text-white group-hover:text-text-main-light transition-colors">
                    Marcar tarea como completada
                  </span>
                </label>

                <button 
                  onClick={() => {
                    onAddEntry(taskId, subtaskId, newMinutes, newDate, newNote, markComplete);
                    setNewNote('');
                    setMarkComplete(false);
                  }}
                  className="w-full py-2 bg-turquesa hover:bg-turquesa/90 text-bg-main font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-turquesa/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  <Plus size={20} strokeWidth={3} />
                  Registrar Tiempo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-2 mb-6">
                 <div>
                   <h3 className="text-xs font-black dark:text-white text-text-main-light uppercase tracking-widest">Listado de Sesiones</h3>
                   <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase mt-1">Total acumulado: {comboRegistered}m</p>
                 </div>
                 <div className="text-right">
                    <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Ejecutado</span>
                    <p className="text-lg font-black text-turquesa">{comboRegistered}m</p>
                 </div>
              </div>
 
              <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar px-2 mb-4">
                {entries.length === 0 && (
                  <div className="py-20 text-center opacity-20">
                    <Clock size={48} className="mx-auto mb-4" />
                    <p className="font-bold uppercase tracking-widest text-xs">Sin registros aún</p>
                  </div>
                )}
                {entries.map((entry: any) => {
                  const isEditing = editingEntryId === entry.id;
                  const isForeignEntry = entry.taskId !== (subtaskId || taskId);
                  
                  // Formato de fecha dd-mm-yyyy
                  const displayDate = entry.date.split('-').reverse().join('-');
 
                  return (
                    <div key={entry.id} className="flex items-center justify-between p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-2xl group transition-all hover:border-turquesa/50">
                      <div className="flex items-center gap-4 flex-1">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 bg-turquesa/10 text-turquesa`}>
                           {entry.source === 'timer' ? <Clock size={20} /> : <Zap size={20} />}
                        </div>
                        <div className="flex-1">
                          {isEditing ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number" 
                                  value={editMinutes} 
                                  onChange={(e) => setEditMinutes(parseInt(e.target.value) || 0)}
                                  className="w-16 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-md p-1 text-xs font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa"
                                />
                                <span className="text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase">min</span>
                              </div>
                              <input 
                                type="text" 
                                value={editNote} 
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-md p-1 text-xs font-medium dark:text-white text-text-main-light outline-none focus:border-turquesa"
                                placeholder="Nota..."
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 mb-1">
                                 <span className="text-sm font-black dark:text-white text-text-main-light">{entry.duration}m</span>
                                 <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">{displayDate}</span>
                                  {isForeignEntry && (
                                    <span className="text-[8px] font-black dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light px-1.5 py-0.5 rounded-md dark:text-text-secondary text-text-secondary-light uppercase tracking-tighter truncate max-w-[100px]">
                                      {allTasksMap[entry.taskId]?.title || 'Subtarea'}
                                    </span>
                                  )}
                              </div>
                              {entry.note ? (
                                <p className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light italic">"{entry.note}"</p>
                              ) : (
                                <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light/30 uppercase tracking-widest">Sin nota</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        {isEditing ? (
                          <>
                            <button 
                              onClick={saveEdit}
                              className="p-2.5 text-turquesa hover:bg-turquesa/10 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Guardar"
                            >
                              <Check size={14} />
                            </button>
                            <button 
                              onClick={() => setEditingEntryId(null)}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-white dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Cancelar"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button 
                              onClick={() => startEdit(entry)}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-white dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Editar registro"
                            >
                              <Edit size={14} />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteEntry(entry.id);
                              }}
                              className="p-2.5 dark:text-text-secondary text-text-secondary-light hover:text-rosa dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light transition-all"
                              title="Eliminar registro"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export function MonthDatePicker({ value, onChange }: { value: string | null, onChange: (d: string | null) => void }) {
  const [viewDate, setViewDate] = useState(() => parseLocalISO(value || formatLocalISO(new Date())));
  
  const daysInMonth = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days = [];
    
    // Previous month days to align Monday
    const startDay = firstDay.getDay(); 
    const prevDaysCount = startDay === 0 ? 6 : startDay - 1;
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    
    for (let i = prevDaysCount - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }
    
    // Next month days to fill grid (6 weeks)
    const totalDays = 42; 
    const nextDaysCount = totalDays - days.length;
    for (let i = 1; i <= nextDaysCount; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }
    
    return days.map(d => {
      const dStr = formatLocalISO(d.date);
      return {
        ...d,
        str: dStr,
        isSelected: value === dStr,
        isToday: formatLocalISO(new Date()) === dStr,
        dayNum: d.date.getDate()
      };
    });
  }, [viewDate, value]);
 
  const weekHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
 
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
         <button onClick={() => setViewDate(prev => { 
           const n = new Date(prev); n.setMonth(n.getMonth() - 1); return n; 
         })} className="p-2 hover:bg-white/5 rounded-xl text-turquesa transition-all"><ChevronLeft size={20}/></button>
         <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white">
           {viewDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
         </span>
         <button onClick={() => setViewDate(prev => { 
           const n = new Date(prev); n.setMonth(n.getMonth() + 1); return n; 
         })} className="p-2 hover:bg-white/5 rounded-xl text-turquesa transition-all"><ChevronRight size={20}/></button>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {weekHeaders.map(h => (
          <div key={h} className="text-[9px] font-black text-text-secondary text-center py-2 uppercase tracking-widest">{h}</div>
        ))}
        {daysInMonth.map((d, i) => (
          <button
            key={`${d.str}-${i}`}
            onClick={() => onChange(d.str)}
            className={`flex flex-col items-center justify-center h-10 rounded-xl transition-all border text-xs font-bold ${
              d.isSelected 
                ? 'bg-turquesa border-turquesa text-white shadow-lg shadow-turquesa/20 z-10' 
                : d.isCurrentMonth
                  ? 'bg-bg-card border-border-main text-white hover:border-turquesa/50'
                  : 'bg-transparent border-transparent text-text-secondary/30 hover:text-text-secondary'
            }`}
          >
            {d.dayNum}
            {d.isToday && !d.isSelected && <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-turquesa" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// DELEGATION CHIP
// ============================================================
