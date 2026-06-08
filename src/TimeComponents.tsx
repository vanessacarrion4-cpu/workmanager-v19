/**
 * TimeComponents.tsx
 * TimerDisplay, TimeManagementPanel, MonthDatePicker
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Check, X, Clock, Edit, Trash2, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { Task, TimeEntry } from './types';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { getTaskEstimatedCombo } from './utils';

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

export function TimeManagementPanel({ taskId, subtaskId, instanceDate, allTasksMap, timeEntries, onAddEntry, onDeleteEntry, onUpdateEntry, onClose, fromModal = false }: any) {
  const [activeTab, setActiveTab] = useState<'register' | 'history'>('register');
  const task = subtaskId ? allTasksMap[subtaskId] : allTasksMap[taskId];
  const parentTask = allTasksMap[taskId];
  const hasSubtasks = parentTask?.subtasks && parentTask.subtasks.length > 0;

  // FIX instancias recurrentes: si viene instanceDate, filtrar solo entradas de ese día
  const entries = useMemo(() => {
    return timeEntries.filter((e: TimeEntry) => {
      if (subtaskId) return e.subtaskId === subtaskId;
      const matchesTask = e.taskId === taskId;
      const isSubtaskEntry = !matchesTask && (Object.values(allTasksMap) as Task[]).some(
        t => t.id === e.taskId && t.parentTaskId === taskId
      );
      if (!matchesTask && !isSubtaskEntry) return false;
      // Si hay instanceDate, filtrar por fecha Barcelona
      if (instanceDate) {
        const entryDate = new Date(e.createdAt || e.date)
          .toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        return entryDate === instanceDate;
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
  }, [timeEntries, taskId, subtaskId, instanceDate, allTasksMap]);

  const totalRegistered = useMemo(() => entries.reduce((acc: number, e: any) => acc + (e.duration || 0), 0), [entries]);
  const estimated = subtaskId ? (task?.estimatedMinutes || 0) : getTaskEstimatedCombo(taskId, allTasksMap);
  const pct = estimated > 0 ? Math.min(100, Math.round((totalRegistered / estimated) * 100)) : 0;
  const barColor = totalRegistered > estimated && estimated > 0 ? '#EC4899' : '#14B8A6';

  const [newMinutes, setNewMinutes] = useState(estimated || 30);
  const [newDate, setNewDate] = useState(instanceDate || formatLocalISO(new Date()));
  const [newNote, setNewNote] = useState('');
  const [markComplete, setMarkComplete] = useState(false);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState(0);
  const [editNote, setEditNote] = useState('');

  const startEdit = (entry: any) => { setEditingEntryId(entry.id); setEditMinutes(entry.duration); setEditNote(entry.note || ''); };
  const saveEdit = () => {
    if (editingEntryId) { onUpdateEntry(editingEntryId, { duration: editMinutes, note: editNote }); setEditingEntryId(null); }
  };

  return (
    <div className={`fixed inset-0 dark:bg-bg-main/80 bg-white/80 backdrop-blur-md z-[300] flex ${fromModal ? 'items-center' : 'items-end'} justify-center`}>
      <motion.div
        initial={fromModal ? { opacity: 0, scale: 0.95 } : { y: '100%' }}
        animate={fromModal ? { opacity: 1, scale: 1 } : { y: 0 }}
        exit={fromModal ? { opacity: 0, scale: 0.95 } : { y: '100%' }}
        className={`w-full max-w-lg dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light shadow-2xl flex flex-col max-h-[80vh] ${fromModal ? 'rounded-[28px] mx-4' : 'border-t border-x rounded-t-[28px]'}`}
      >
        {/* Header compacto */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black text-turquesa uppercase tracking-[0.2em]">Tiempo registrado</p>
            <h2 className="text-sm font-black dark:text-white text-text-main-light truncate">{task?.title || 'Gestionar Tiempo'}</h2>
          </div>
          {/* Stats inline */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 dark:bg-bg-main bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
              </div>
              <span className="text-[11px] font-black" style={{ color: barColor }}>{totalRegistered}m</span>
              <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">/ {estimated}m</span>
            </div>
          </div>
        </div>

        {/* Tabs + Cerrar — siempre visible */}
        <div className="flex items-center px-4 gap-1 mb-3 shrink-0">
          <button onClick={() => setActiveTab(activeTab === 'history' ? 'register' : 'history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all border ${
              activeTab === 'history'
                ? 'bg-turquesa text-white border-turquesa shadow-md shadow-turquesa/20'
                : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa/50'
            }`}
          >
            <History size={12} /> Historial ({entries.length})
          </button>
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1.5 dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light transition-all text-[11px] font-black uppercase tracking-widest"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
          {activeTab === 'register' ? (
            <div className="space-y-3">
              {/* Botón registrar — cierra el panel al guardar */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onAddEntry(taskId, subtaskId, newMinutes, newDate, newNote, markComplete);
                    onClose();
                  }}
                  className="flex-1 py-2 bg-turquesa hover:bg-turquesa/85 text-white font-black uppercase tracking-widest rounded-xl shadow-md shadow-turquesa/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98] text-[11px]"
                >
                  <Plus size={13} strokeWidth={3} /> Registrar
                </button>
              </div>

              {/* Minutos + Fecha */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Minutos</label>
                  <input
                    type="number"
                    value={newMinutes}
                    onChange={e => setNewMinutes(parseInt(e.target.value) || 0)}
                    className="w-full dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl p-2.5 text-lg font-black text-turquesa outline-none focus:border-turquesa/50 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Fecha</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    className="w-full dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl p-2.5 text-xs font-black dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all"
                  />
                </div>
              </div>

              {/* Nota */}
              <div className="space-y-1">
                <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Nota (opcional)</label>
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Describe brevemente tu progreso..."
                  rows={2}
                  className="w-full dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl p-2.5 text-sm font-medium dark:text-white text-text-main-light placeholder:dark:text-text-secondary/30 placeholder:text-text-secondary-light/30 outline-none focus:border-turquesa/50 transition-all resize-none"
                />
              </div>

              {/* Checkbox completar */}
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <div
                  onClick={() => setMarkComplete(v => !v)}
                  className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all shrink-0 ${markComplete ? 'bg-turquesa border-turquesa' : 'dark:border-border-main border-border-main-light'}`}
                >
                  {markComplete && <Check size={11} className="text-white" strokeWidth={3} />}
                </div>
                <span className="text-[11px] font-bold dark:text-text-secondary text-text-secondary-light group-hover:dark:text-white group-hover:text-text-main-light transition-colors">
                  Marcar tarea como completada
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.length === 0 && (
                <div className="py-16 text-center opacity-20">
                  <Clock size={36} className="mx-auto mb-3" />
                  <p className="font-bold uppercase tracking-widest text-xs">Sin registros{instanceDate ? ' para este día' : ''}</p>
                </div>
              )}
              {entries.map((entry: any) => {
                const isEditing = editingEntryId === entry.id;
                const displayDate = entry.date ? entry.date.split('-').reverse().join('-') : '—';
                return (
                  <div key={entry.id} className="flex items-center gap-3 p-3 dark:bg-bg-main bg-gray-50 border dark:border-border-main border-border-main-light rounded-xl group hover:border-turquesa/40 transition-all">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-turquesa/10 text-turquesa">
                      {entry.source === 'timer' ? <Clock size={14} /> : <Zap size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input type="number" value={editMinutes} onChange={e => setEditMinutes(parseInt(e.target.value) || 0)}
                            className="w-16 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-lg px-2 py-1 text-xs font-bold dark:text-white text-text-main-light outline-none focus:border-turquesa" />
                          <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">min</span>
                          <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Nota..."
                            className="flex-1 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-lg px-2 py-1 text-xs dark:text-white text-text-main-light outline-none focus:border-turquesa" />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-black dark:text-white text-text-main-light shrink-0">{entry.duration}m</span>
                          <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light shrink-0">{displayDate}</span>
                          {entry.note && <span className="text-[11px] dark:text-text-secondary/70 text-text-secondary-light/70 italic truncate">"{entry.note}"</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} className="w-7 h-7 flex items-center justify-center text-turquesa hover:bg-turquesa/10 rounded-lg transition-all"><Check size={13} /></button>
                          <button onClick={() => setEditingEntryId(null)} className="w-7 h-7 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-rosa rounded-lg transition-all"><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(entry)} className="w-7 h-7 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-turquesa rounded-lg transition-all"><Edit size={13} /></button>
                          <button onClick={e => { e.stopPropagation(); onDeleteEntry(entry.id); }} className="w-7 h-7 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-rosa rounded-lg transition-all"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
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
