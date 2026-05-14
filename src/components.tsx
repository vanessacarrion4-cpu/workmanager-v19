/**
 * components.tsx
 * Componentes compartidos usados en múltiples vistas.
 * Extraído de App.tsx/CalendarView.tsx - Sesión 3/4 del refactor.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Plus, CheckCircle2, Circle, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Trash2, Edit, Check, X, Clock, Eye, EyeOff, RefreshCw, GripVertical,
  Paperclip, Maximize2, Minimize2, ArrowUpLeft, ArrowDownRight, ChevronsUp,
  ChevronsDown, Tag, Copy, Play, Pause, MoreVertical, User, Users, Zap,
  Target, ArrowRight, Calendar as CalendarIcon, Compass, Grid2X2,
  ArrowUpRight, Dot, History, Globe, PlusCircle
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { WorkBlock, Task, TagType, TimeEntry, Person } from './types';
import { TAG_LABELS, COLORS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { isTaskCompleted, isTaskRepetitive, getTaskEstimatedCombo, getTaskEstimatedPending, getTaskRegisteredCombo, getTaskRegisteredSelf, formatMinutes } from './utils';
import { supabase } from './supabaseClient';

export function RecurrenceChoiceModal({ type, onClose, onConfirm }: { type: 'edit' | 'delete', onClose: () => void, onConfirm: (choice: 'instance' | 'series') => void }) {
  return (
    <div className="fixed inset-0 bg-bg-main/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-bg-card max-w-sm w-full rounded-[2.5rem] border border-border-main p-8 shadow-[0_30px_100px_rgba(0,0,0,0.6)] text-center"
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${type === 'edit' ? 'bg-azul/20 text-azul' : 'bg-rosa/20 text-rosa'}`}>
          {type === 'edit' ? <Edit size={32} /> : <Trash2 size={32} />}
        </div>
        <h3 className="text-2xl font-black text-white mb-2">
          {type === 'edit' ? '¿Qué quieres editar?' : '¿Qué quieres eliminar?'}
        </h3>
        <p className="text-sm font-bold text-text-secondary mb-8 leading-relaxed">
          Esta tarea es parte de una rutina recurrente. Elige si quieres afectar solo a este día o a toda la serie.
        </p>
 
        <div className="space-y-3">
          <button 
            onClick={() => onConfirm('instance')}
            className="w-full py-4 bg-bg-main hover:bg-bg-secondary rounded-2xl text-[10px] font-black uppercase tracking-widest text-white border border-border-main transition-all flex items-center justify-center gap-2"
          >
            {type === 'edit' ? 'Solo esta tarea' : 'Solo este día'}
          </button>
          <button 
            onClick={() => onConfirm('series')}
            className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all flex items-center justify-center gap-2 shadow-xl ${type === 'edit' ? 'bg-azul shadow-azul/20' : 'bg-rosa shadow-rosa/20'}`}
          >
            {type === 'edit' ? 'Toda la serie (Futuro)' : 'Toda la serie (Futuro)'}
          </button>
          <button 
            onClick={onClose}
            className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
 
 
 
// --- Block Modal ---
export function BlockModal({ block, onClose, onSave, onDelete }: { block: WorkBlock, onClose: () => void, onSave: (b: WorkBlock) => void, onDelete: (id: string) => void }) {
  const [localBlock, setLocalBlock] = useState<WorkBlock>(block);
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [showAllColors, setShowAllColors] = useState(false);
  
  const allIcons = [
    '🏢', '💰', '🏦', '📜', '🏠', '👥', '⚙️', '🛡️', '🗓️', '✅', '🔥', '🚀', '🧠', '🛠️', '🛒', '📞',
    '💼', '📊', '🌐', '📡', '🔒', '🔑', '🏷️', '📦', '📅', '📝', '🔔', '📢', '🔍', '📱', '💻', '🎥',
    '🎨', '🎵', '⚽', '🏆', '🍕', '☕', '✈️', '⚡', '🌙', '☀️', '🌈', '🍀', '💎', '📍', '🎁', '💡'
  ];
  
  const icons = showAllIcons ? allIcons : allIcons.slice(0, 16);
  const allColorThemes = Object.values(COLORS);
  const colorThemes = showAllColors ? allColorThemes : allColorThemes.slice(0, 7);
 
  return (
    <div className="fixed inset-0 bg-bg-main/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-xl dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[3rem] shadow-[0_30px_100px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b dark:border-border-main border-border-main-light flex items-center justify-between sticky top-0 dark:bg-bg-card bg-white z-10">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 dark:bg-bg-main bg-gray-100 rounded-2xl flex items-center justify-center text-3xl border dark:border-border-main border-border-main-light" style={{ borderColor: localBlock.color }}>
                {localBlock.icon}
              </div>
              <div>
                <h3 className="text-2xl font-black dark:text-white text-text-main-light">{!localBlock.name ? 'Nuevo Bloque' : localBlock.name}</h3>
                <p className="text-[10px] font-black uppercase dark:text-text-secondary text-text-secondary-light tracking-widest">Configuración de contexto</p>
              </div>
           </div>
           <button onClick={onClose} className="p-3 dark:hover:bg-bg-main hover:bg-gray-100 rounded-2xl transition-all dark:text-text-secondary text-text-secondary-light">
              <X size={24} />
           </button>
        </div>
 
        <div className="p-10 space-y-10 overflow-y-auto custom-scrollbar">
           <div className="flex items-center justify-between dark:bg-bg-main/20 bg-gray-100 p-6 rounded-3xl border dark:border-border-main border-border-main-light">
              <div>
                <h4 className="text-sm font-black dark:text-white text-text-main-light mb-1 uppercase tracking-widest">Estado del Bloque</h4>
                <p className="text-[9px] font-bold dark:text-text-secondary text-text-secondary-light uppercase">Los bloques inactivos no aparecen en el dashboard</p>
              </div>
              <button 
                onClick={() => setLocalBlock(prev => ({ ...prev, isActive: !prev.isActive }))}
                className={`flex items-center gap-3 px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all border-2 ${localBlock.isActive ? 'bg-turquesa/10 border-turquesa text-turquesa shadow-lg shadow-turquesa/10' : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
              >
                {localBlock.isActive ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                {localBlock.isActive ? 'ACTIVO' : 'INACTIVO'}
              </button>
           </div>
 
           <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light px-2">Nombre del Bloque</label>
              <input 
                type="text"
                autoFocus
                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-3xl p-6 text-xl font-bold dark:text-white text-text-main-light focus:ring-4 focus:ring-turquesa/20 outline-none transition-all placeholder:opacity-20"
                placeholder="Ej: Contabilidad central"
                value={localBlock.name}
                onChange={e => setLocalBlock(prev => ({ ...prev, name: e.target.value }))}
              />
           </div>
 
           <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Icono Visual</label>
                <button onClick={() => setShowAllIcons(!showAllIcons)} className="text-[9px] font-black text-turquesa uppercase tracking-widest hover:underline">
                  {showAllIcons ? 'Ver menos' : 'Ver todos'}
                </button>
              </div>
              <div className="grid grid-cols-8 gap-3">
                 {icons.map(icon => (
                   <button 
                    key={icon}
                    onClick={() => setLocalBlock(prev => ({ ...prev, icon }))}
                    className={`aspect-square flex items-center justify-center text-2xl rounded-2xl border transition-all ${localBlock.icon === icon ? 'bg-turquesa/20 border-turquesa scale-110 shadow-lg' : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:hover:border-white/20 hover:border-gray-300'}`}
                   >
                     {icon}
                   </button>
                 ))}
              </div>
           </div>
 
           <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Color del Bloque</label>
                <button onClick={() => setShowAllColors(!showAllColors)} className="text-[9px] font-black text-turquesa uppercase tracking-widest hover:underline">
                  {showAllColors ? 'Ver menos' : 'Ver todos'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                 {colorThemes.map((theme, idx) => (
                   <button 
                    key={idx}
                    onClick={() => setLocalBlock(prev => ({ ...prev, color: theme.main, pastelColor: theme.pastel }))}
                    className={`w-10 h-10 rounded-full border-4 transition-all ${localBlock.color === theme.main ? 'border-white scale-125 shadow-xl' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: theme.main }}
                   />
                 ))}
              </div>
           </div>
        </div>
 
        <div className="p-8 dark:bg-bg-main/20 bg-gray-100/50 border-t dark:border-border-main border-border-main-light flex items-center justify-between gap-4 sticky bottom-0 z-10 backdrop-blur-md">
           {localBlock.id.startsWith('b-') ? (
             <div />
           ) : (
             <button 
              onClick={() => { onDelete(localBlock.id); onClose(); }}
              className="px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-rosa hover:bg-rosa/10 transition-all flex items-center gap-2"
             >
               <Trash2 size={16} /> Eliminar
             </button>
           )}
           
           <div className="flex gap-4">
             <button onClick={onClose} className="px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all">Cancelar</button>
             <button 
                disabled={!localBlock.name}
                onClick={() => onSave(localBlock)}
                className="px-10 py-4 rounded-2xl text-xs font-black uppercase tracking-widest bg-turquesa text-white shadow-2xl shadow-turquesa/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 disabled:opacity-50 disabled:scale-100"
             >
               <LayoutDashboard size={18} />
               Guardar Bloque
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
 
// --- Helpers ---
export function getTagColor(tag: TagType) {
  switch (tag) {
    case 'con_hora': return 'turquesa';
    case 'focus': return 'azul';
    case 'dirección': return 'morado';
    case 'espera': return 'naranja';
    case 'resto': return 'turquesa';
    default: return 'text-secondary';
  }
}
 
// --- NEW OVERHAUL COMPONENTS ---
 
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
 
export function DashboardHarmonicCalendar({ activeDate, onSetDate, onClose }: any) {
  const [currentMonth, setCurrentMonth] = useState(() => parseLocalISO(activeDate));
  
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const totalDays = daysInMonth(year, month);
  const startDay = (firstDayOfMonth(year, month) + 6) % 7; // 0=lun...6=dom
  
  const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
 
  const prevMonthDays = daysInMonth(year, month - 1);
  
  const days = [];
  for (let i = startDay - 1; i >= 0; i--) {
     days.push({ day: prevMonthDays - i, current: false, date: new Date(year, month - 1, prevMonthDays - i) });
  }
  for (let i = 1; i <= totalDays; i++) {
     days.push({ day: i, current: true, date: new Date(year, month, i) });
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
     days.push({ day: i, current: false, date: new Date(year, month + 1, i) });
  }
 
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between px-1">
        <button 
          onClick={() => setCurrentMonth(new Date(year, month - 1))} 
          className="w-8 h-8 flex items-center justify-center hover:bg-bg-main rounded-lg transition-all text-text-secondary hover:text-white"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-black text-xs uppercase tracking-[0.2em] text-white">
          {monthNames[month]} {year}
        </span>
        <button 
          onClick={() => setCurrentMonth(new Date(year, month + 1))} 
          className="w-8 h-8 flex items-center justify-center hover:bg-bg-main rounded-lg transition-all text-text-secondary hover:text-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {dayNames.map(d => (
          <div key={d} className="text-[10px] font-black text-text-secondary/40 text-center py-2 uppercase tracking-widest">{d}</div>
        ))}
        {days.map((d, i) => {
          const dateStr = formatLocalISO(d.date);
          const isSelected = dateStr === activeDate;
          const isToday = dateStr === formatLocalISO(new Date());
          
          return (
            <button 
              key={i}
              onClick={() => {
                onSetDate(dateStr);
                onClose();
              }}
              className={`
                aspect-square flex flex-col items-center justify-center rounded-xl text-[11px] font-bold transition-all relative
                ${isSelected ? 'bg-turquesa text-white shadow-lg shadow-turquesa/20 scale-105 z-10' : 'bg-bg-main/50'}
                ${!isSelected && d.current ? 'text-text-main hover:bg-turquesa/10 hover:text-turquesa border border-border-main/30' : ''}
                ${!d.current ? 'text-text-secondary/20 border-none bg-transparent' : ''}
                ${isToday && !isSelected ? 'border-turquesa/50' : ''}
              `}
            >
              <span className={!d.current ? 'opacity-20' : ''}>{d.day}</span>
              {isToday && !isSelected && (
                <div className="absolute bottom-1.5 w-1 h-1 bg-turquesa rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
 
export function TaskCard({ 
  task, 
  variant, 
  allTasksMap,
  people = [],
  blocks, 
  timeEntries, 
  activeTimer,
  onStartTimer,
  onStopTimer,
  onToggleStatus, 
  onUpdateTask,
  onEditTask,
  editingTaskId,
  inlineEditingTaskId,
  setInlineEditingTaskId,
  onOpenTimePanel,
  // Navigation / Actions
  onAddTask,
  onDelete,
  onPromote,
  onDemote,
  onReorderSubtasks,
  onToggleExpand,
  level = 1,
  rootTaskId = null,
  hideCompleted = false,
  subtasksForGroup = null,
  forceExpanded = null,
  onAddPerson = null,
  onRenamePerson = null,
  onDeletePerson = null,
  onRecurrenceDateChange = null,
  taskIndex = null,
  taskCount = null,
  onMoveUp = null,
  onMoveDown = null,
  selectionMode = false,
  selectedTaskIds = new Set(),
  onToggleTaskSelection = null,
  inMeeting = false,
  meetingItems = null,
  onUpdateMeetingItems = null,
  searchQuery = '',
}: any) {
  if (!task || task.isDeleted) return null;
  const currentRootId = rootTaskId || task.id;
  const block = blocks.find((b: any) => b.id === task.blockId) || blocks[0] || { color: '#14B8A6', icon: '📋', name: 'General' };
  const hasSubtasks = (task.subtasks && task.subtasks.length > 0) || (subtasksForGroup && subtasksForGroup.length > 0);
  const isExpanded = forceExpanded !== null ? forceExpanded : (task.isExpanded ?? true);

  // Highlight helper: resalta el texto coincidente con fondo amarillo
  const HighlightText = ({ text }: { text: string }) => {
    if (!searchQuery) return <>{text}</>;
    const q = searchQuery.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ backgroundColor: '#facc15', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };
  
  // En Dashboard con subtasksForGroup: solo sumar las subtareas de ese grupo
  // En Bloques: sumar todas las subtareas
  const totalEstimated = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: contenedor dividido por grupos - solo sumar subtareas PENDIENTES del grupo
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskEstimatedPending(subId, allTasksMap);
      }, 0);
    } else {
      // Bloques o tarea normal: sumar PENDIENTES
      return getTaskEstimatedPending(task.id, allTasksMap);
    }
  })();
  
  const totalRegistered = (() => {
    if (subtasksForGroup !== null) {
      // Dashboard: solo tiempo de subtareas del grupo
      return subtasksForGroup.reduce((acc: number, subId: string) => {
        return acc + getTaskRegisteredCombo(subId, allTasksMap, timeEntries);
      }, 0);
    } else {
      // Bloques o tarea normal: sumar todo
      return getTaskRegisteredCombo(task.id, allTasksMap, timeEntries);
    }
  })();
  
  const isTimerRunning = activeTimer?.entityId === task.id;
  const [dragX, setDragX] = useState(0);
 
  if (variant === 'COMPACT') {
    const [showMovePicker, setShowMovePicker] = useState(false);
    const [showMoveCalendar, setShowMoveCalendar] = useState(false);

    const handleMoveTask = (newDate: string | null) => {
      if (!newDate || newDate === task.dueDate) { setShowMovePicker(false); setShowMoveCalendar(false); return; }
      const updated = {
        ...task,
        dueDate: newDate,
        instanceDate: task.instanceDate || task.dueDate,
        isException: !!task.templateId,
        modifiedAt: new Date().toISOString()
      };
      onUpdateTask(updated);
      setShowMovePicker(false);
      setShowMoveCalendar(false);
    };

    return (
      <div className="relative">
        <div className="flex items-center gap-2 p-2 dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-xl transition-all group">
          <div className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: block.color }} />
          <span className="text-[11px] font-bold dark:text-white text-text-main-light truncate flex-1 uppercase tracking-tight"><HighlightText text={task.title} /></span>
          {(task.templateId || task.recurrence) && <RefreshCw size={10} className="text-turquesa shrink-0" />}
          {task.attachments && task.attachments.length > 0 && (
            <span title={`${task.attachments.length} adjunto${task.attachments.length > 1 ? 's' : ''}`} className="flex items-center gap-0.5 shrink-0">
              <Paperclip size={10} className="text-azul" />
              {task.attachments.length > 1 && <span className="text-[9px] font-black text-azul">{task.attachments.length}</span>}
            </span>
          )}
          <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light shrink-0">
            {formatMinutes(totalEstimated)}
          </span>
          {/* Botones de acción */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onEditTask(task.id); }}
              className="w-7 h-7 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20"
              title="Editar tarea"
            >
              <Edit size={13} />
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMovePicker(!showMovePicker); setShowMoveCalendar(false); }}
                className="w-7 h-7 flex items-center justify-center text-azul bg-azul/5 hover:bg-azul/10 rounded-lg transition-all border border-azul/20"
                title="Mover a otro día"
              >
                <CalendarIcon size={13} />
              </button>

              <AnimatePresence>
                {showMovePicker && (
                  <>
                    <div className="fixed inset-0 z-[210]" onClick={() => { setShowMovePicker(false); setShowMoveCalendar(false); }} />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                      className="fixed bottom-4 right-4 z-[220] bg-bg-card border border-border-main rounded-2xl shadow-2xl p-4 w-[220px]"
                    >
                      {!showMoveCalendar ? (
                        <div className="space-y-2">
                          {task.templateId && (
                            <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest text-center pb-1 border-b border-border-main/50">
                              Solo esta instancia
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveTask(formatLocalISO(new Date())); }}
                              className="flex flex-col items-center gap-1 p-3 bg-bg-main rounded-xl border border-border-main hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                              <span className="text-[8px] text-text-secondary">{new Date().getDate()}</span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); const m = new Date(); m.setDate(m.getDate() + 1); handleMoveTask(formatLocalISO(m)); }}
                              className="flex flex-col items-center gap-1 p-3 bg-bg-main rounded-xl border border-border-main hover:border-turquesa transition-all group"
                            >
                              <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                              <span className="text-[8px] text-text-secondary">{(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.getDate(); })()}</span>
                            </button>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowMoveCalendar(true); }}
                            className="w-full flex items-center justify-between p-3 bg-bg-main rounded-xl border border-border-main hover:border-azul transition-all group"
                          >
                            <span className="text-[10px] font-black text-white uppercase tracking-widest group-hover:text-azul">Elegir fecha</span>
                            <CalendarIcon size={14} className="text-text-secondary group-hover:text-azul" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between px-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowMoveCalendar(false); }}
                              className="text-[10px] font-black text-turquesa uppercase tracking-widest hover:underline flex items-center gap-1"
                            >
                              <ChevronLeft size={12} /> Volver
                            </button>
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Mensual</span>
                          </div>
                          <MonthDatePicker
                            value={task.dueDate}
                            onChange={(d) => { handleMoveTask(d); }}
                          />
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    );
  }
 
  return (
    <div className="group relative">
      <div>
        <div
          className={`relative transition-all hover:dark:bg-white/[0.02] hover:bg-black/[0.02] ${task.status === 'completed' ? 'opacity-50' : ''} ${selectionMode && selectedTaskIds.has(task.id) ? 'dark:bg-azul/15 bg-azul/10 rounded-[1.5rem]' : ''} ${selectionMode ? 'cursor-pointer' : ''} ${searchQuery && task.title.toLowerCase().includes(searchQuery.toLowerCase()) ? 'dark:bg-yellow-400/5 bg-yellow-400/10 rounded-2xl' : ''}`}
          style={selectionMode && selectedTaskIds.has(task.id) ? { 
            outline: '3px solid #3B82F6', 
            outlineOffset: '-1px', 
            borderRadius: '1.5rem'
          } : searchQuery && task.title.toLowerCase().includes(searchQuery.toLowerCase()) ? {
            outline: '2px solid #facc15',
            outlineOffset: '-1px',
            borderRadius: '1rem'
          } : undefined}
          onClickCapture={selectionMode && onToggleTaskSelection ? (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('input') || target.closest('select') || target.closest('textarea')) return;
            e.stopPropagation();
            const isContainer = !!(task.subtasks && task.subtasks.length > 0);
            onToggleTaskSelection(task.id, isContainer);
          } : undefined}
        >
          {/* Main Row */}
          <div className="flex items-center gap-2 px-4 py-2.5 pl-3">

            {/* Flechitas reordenar - hover */}
            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => onMoveUp && onMoveUp()}
                disabled={taskIndex === 0}
                className={`w-5 h-5 flex items-center justify-center rounded-md transition-all ${taskIndex === 0 ? 'text-text-secondary/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`}
                title="Subir"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => onMoveDown && onMoveDown()}
                disabled={taskIndex === taskCount - 1}
                className={`w-5 h-5 flex items-center justify-center rounded-md transition-all ${taskIndex === taskCount - 1 ? 'text-text-secondary/20 cursor-not-allowed' : 'dark:text-text-secondary text-text-secondary-light hover:text-turquesa hover:bg-turquesa/10'}`}
                title="Bajar"
              >
                <ChevronDown size={12} />
              </button>
            </div>

            {/* Barra color bloque - inline entre flechas y checkbox */}
            <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: block.color }} />

            {/* Checkbox completar - siempre visible */}
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleStatus(task.id); }}
              className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all shadow-lg shrink-0 ${
                selectionMode && selectedTaskIds.has(task.id)
                  ? 'bg-azul/20 border-2 border-azul text-azul'
                  : task.status === 'completed' 
                    ? 'bg-turquesa text-white' 
                    : 'dark:bg-bg-main bg-white border-2 dark:border-border-main border-border-main-light text-transparent hover:border-turquesa'
              }`}
            >
              {selectionMode && selectedTaskIds.has(task.id) 
                ? <Check size={12} />
                : <CheckCircle2 size={12} />
              }
            </button>

            {/* Contenido: título + chips */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-1">
                {/* Fila título */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <div className="relative flex-1 min-w-0">
                      <input 
                        autoFocus={editingTaskId === task.id || inlineEditingTaskId === task.id}
                        className={`text-[13px] font-black dark:text-white text-text-main-light bg-transparent outline-none min-w-0 w-full truncate dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/20 capitalize tracking-normal ${task.status === 'completed' ? 'line-through' : ''}`}
                        value={task.title}
                        onChange={(e) => onUpdateTask({ ...task, title: e.target.value })}
                        onBlur={() => { 
                          if(editingTaskId === task.id) onEditTask(null);
                          if(inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
                        }}
                        onKeyDown={(e) => { 
                          if(e.key === 'Enter') {
                            if(editingTaskId === task.id) onEditTask(null);
                            if(inlineEditingTaskId === task.id) setInlineEditingTaskId(null);
                          }
                        }}
                        placeholder="Título de la tarea..."
                      />
                    </div>
                    {/* Badge circular subtareas pendientes */}
                    {hasSubtasks && (() => {
                      const subIds: string[] = subtasksForGroup || task.subtasks || [];
                      const pendingCount = subIds.filter((sid: string) => {
                        const s = allTasksMap[sid];
                        return s && !s.isDeleted && s.status !== 'completed';
                      }).length;
                      return (
                        <button
                          data-testid="expand-button"
                          onClick={(e) => {
                            console.log('[BOTÓN ROSA] Click en botón, taskId:', task.id);
                            e.stopPropagation();
                            e.preventDefault();
                            onToggleExpand(task.id);
                            console.log('[BOTÓN ROSA] onToggleExpand llamado');
                          }}
                          className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center bg-rosa/20 border border-rosa/40 text-rosa transition-all hover:bg-rosa/30 cursor-pointer"
                        >
                          {String(pendingCount)}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* Fila chips - incluye badge bloque al inicio */}
                <div className="flex flex-wrap items-center gap-1">
                  <TaskTypeChip 
                    value={task.taskType || (isTaskRepetitive(task.id, allTasksMap) ? 'core' : 'adhoc')} 
                    onChange={(val: string) => onUpdateTask({ ...task, taskType: val })} 
                    isCompact={true}
                  />
                  {!hasSubtasks && (
                    <DatePickerChip 
                        value={task.dueDate} 
                        onChange={(date: string) => {
                          if (task.templateId) {
                            onRecurrenceDateChange && onRecurrenceDateChange(task, date);
                          } else {
                            onUpdateTask({ ...task, dueDate: date });
                          }
                        }} 
                      />
                    )}
                  {!hasSubtasks && !inMeeting && (
                    <TimePickerChip
                      value={task.dueTime || ''}
                      onChange={(time: string) => onUpdateTask({ ...task, dueTime: time })}
                    />
                  )}
                  {/* Chip recurrencia informativo para instancias */}
                  {task.templateId && !hasSubtasks && (() => {
                    const tmpl = allTasksMap[task.templateId];
                    const rec = tmpl?.recurrence;
                    if (!rec) return null;
                    const freq = rec.frequency || rec.type;
                    const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                    let label = '';
                    if (freq === 'daily') label = 'Diaria';
                    else if (freq === 'weekdays') label = 'L-V';
                    else if (freq === 'weekly') {
                      const days = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ');
                      label = days || 'Sem';
                    }
                    else if (freq === 'monthly') {
                      const day = rec.monthDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '');
                      label = `Mes ${day || ''}`;
                    }
                    else if (freq === 'yearly') {
                      if (rec.startDate) {
                        const d = new Date(rec.startDate + 'T12:00:00');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        label = `Año ${dd}-${mm}`;
                      } else label = 'Año';
                    }
                    else label = freq;
                    return (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg border dark:border-turquesa/30 border-turquesa/40 dark:bg-turquesa/10 bg-turquesa/5 shrink-0" title="Tarea recurrente">
                        <RefreshCw size={9} className="text-turquesa shrink-0" />
                        <span className="text-[10px] font-black text-turquesa uppercase tracking-wide">{label}</span>
                      </div>
                    );
                  })()}
                  {/* Chip recurrencia para templates (Delegadas, Vista Bloques) */}
                  {task.isTemplate && task.recurrence && !task.templateId && !hasSubtasks && (() => {
                    const rec = task.recurrence;
                    const freq = rec.frequency || rec.type;
                    const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
                    let label = '';
                    if (freq === 'daily') label = 'Diaria';
                    else if (freq === 'weekdays') label = 'L-V';
                    else if (freq === 'weekly') {
                      const days = (rec.weekDays || []).map((d: number) => dayNames[d]).join(' ');
                      label = days || 'Sem';
                    }
                    else if (freq === 'monthly') {
                      const day = rec.monthDay || (rec.startDate ? new Date(rec.startDate + 'T12:00:00').getDate() : '');
                      label = `Mes ${day || ''}`;
                    }
                    else if (freq === 'yearly') {
                      if (rec.startDate) {
                        const d = new Date(rec.startDate + 'T12:00:00');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        label = `Año ${dd}-${mm}`;
                      } else label = 'Año';
                    }
                    else label = freq;
                    return (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg border dark:border-turquesa/30 border-turquesa/40 dark:bg-turquesa/10 bg-turquesa/5 shrink-0" title="Tarea recurrente">
                        <RefreshCw size={9} className="text-turquesa shrink-0" />
                        <span className="text-[10px] font-black text-turquesa uppercase tracking-wide">{label}</span>
                      </div>
                    );
                  })()}
                  {!hasSubtasks && !task.templateId && (
                    <RecurrencePickerChip 
                      value={task.recurrence}
                      onChange={(rec: any) => onUpdateTask({ 
                        ...task, 
                        recurrence: rec || undefined,
                        isTemplate: !!rec,
                        dueDate: rec ? null : (task.dueDate || formatLocalISO(new Date())),
                        dueTime: task.dueTime
                      })}
                    />
                  )}
                  {!hasSubtasks && (
                    <TagPickerChip 
                      selectedTags={task.tags} 
                      onChange={(tags: TagType[]) => onUpdateTask({ ...task, tags })} 
                    />
                  )}
                  {!hasSubtasks && (
                    <DelegationChip
                      delegation={task.delegation}
                      people={people || []}
                      onChange={(delegation: any) => onUpdateTask({ ...task, delegation })}
                      onAddPerson={onAddPerson}
                      onRenamePerson={onRenamePerson}
                      onDeletePerson={onDeletePerson}
                      onRecurrenceDateChange={onRecurrenceDateChange}
                    />
                  )}
                  {!inMeeting && <EstimatedTimeChip 
                    value={hasSubtasks ? totalEstimated : task.estimatedMinutes} 
                    onChange={(val: number) => { if (!hasSubtasks) onUpdateTask({ ...task, estimatedMinutes: val }); }} 
                    readonly={hasSubtasks}
                    variant={level > 1 ? 'mini' : 'default'}
                  />}
                  {!inMeeting && <RegisteredTimeChip 
                    value={totalRegistered} 
                    estimated={totalEstimated}
                    onClick={() => onOpenTimePanel(currentRootId, level === 1 ? null : task.id)} 
                  />}
                  {!inMeeting && <button 
                    onClick={() => isTimerRunning ? onStopTimer() : onStartTimer(currentRootId, level === 1 ? null : task.id)}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${isTimerRunning ? 'bg-rosa text-white' : 'dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light text-turquesa hover:bg-turquesa/10'}`}
                  >
                    {isTimerRunning ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                  </button>}

                  {/* Block picker - clickable chip to change context */}
                  {variant === 'FULL' ? (
                    // In Bloques: small discrete chip
                    <BlockPickerChip 
                      value={task.blockId}
                      blocks={blocks}
                      onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                    />
                  ) : (
                    // In Dashboard: full chip with icon and name
                    <BlockPickerChip 
                      value={task.blockId}
                      blocks={blocks}
                      onChange={(blockId: string) => onUpdateTask({ ...task, blockId })}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Botones acción - una sola fila */}
            <div className="flex flex-col gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => onEditTask(task.id)} 
                  className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20"
                  title="Editar"
                >
                  <Edit size={12} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} 
                  className="w-6 h-6 flex items-center justify-center text-rosa bg-rosa/5 hover:bg-rosa/10 rounded-lg transition-all border border-rosa/20"
                  title="Eliminar"
                >
                  <Trash2 size={12} />
                </button>
                {level < 3 && (
                  <button 
                    onClick={() => onAddTask(task.id, task.blockId)} 
                    className="w-6 h-6 flex items-center justify-center text-turquesa bg-turquesa/5 hover:bg-turquesa/10 rounded-lg transition-all border border-turquesa/20" 
                    title="Añadir subtarea"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {task.parentTaskId && (
                  <button 
                    onClick={() => onPromote(task.id)} 
                    title="Subir un nivel" 
                    className="w-6 h-6 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-turquesa dark:bg-bg-main bg-white rounded-lg border dark:border-border-main border-border-main-light transition-all"
                  >
                    <ArrowUpLeft size={12} />
                  </button>
                )}
                <button 
                  onClick={() => onDemote(task.id)} 
                  title="Bajar un nivel" 
                  className="w-6 h-6 flex items-center justify-center dark:text-text-secondary text-text-secondary-light hover:text-azul dark:bg-bg-main bg-white rounded-lg border dark:border-border-main border-border-main-light transition-all"
                >
                  <ArrowDownRight size={12} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Subtasks */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div 
              key={`subtasks-${task.id}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-l-2 dark:border-border-main/20 border-border-main-light/20 space-y-0 ${level === 1 ? "ml-5 pl-3" : "ml-7 pl-4"}`}
            >
              {hasSubtasks && (
                <Reorder.Group 
                  axis="y" 
                  values={(subtasksForGroup || task.subtasks).filter((sid: string) => {
                    if (!hideCompleted) return true;
                    const sub = allTasksMap[sid];
                    if (!sub) return true;
                    return sub.status !== 'completed';
                  })}
                  onReorder={(newIds: string[]) => onReorderSubtasks(task.id, newIds)}
                  className="space-y-0 divide-y dark:divide-border-main/20 divide-border-main-light/20"
                >
                  {(subtasksForGroup || task.subtasks)
                    .filter((subId: string) => {
                      if (!hideCompleted) return true;
                      const sub = allTasksMap[subId];
                      if (!sub) return true;
                      return sub.status !== 'completed';
                    })
                    .map((subId: string, idx: number, visibleSubs: string[]) => (
                    <Reorder.Item key={subId} value={subId} as="div" whileDrag={{ scale: 1.01, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }} style={{ cursor: 'grab' }}>
                      <TaskCard 
                        task={allTasksMap[subId]}
                        variant={variant}
                        allTasksMap={allTasksMap}
                        people={people}
                        onAddPerson={onAddPerson}
                        blocks={blocks}
                        timeEntries={timeEntries}
                        activeTimer={activeTimer}
                        onStartTimer={onStartTimer}
                        onStopTimer={onStopTimer}
                        onToggleStatus={onToggleStatus}
                        onUpdateTask={onUpdateTask}
                        onEditTask={onEditTask}
                        editingTaskId={editingTaskId}
                        inlineEditingTaskId={inlineEditingTaskId}
                        setInlineEditingTaskId={setInlineEditingTaskId}
                        onOpenTimePanel={onOpenTimePanel}
                        onAddTask={onAddTask}
                        onDelete={onDelete}
                        onPromote={onPromote}
                        onDemote={onDemote}
                        onReorderSubtasks={onReorderSubtasks}
                        onToggleExpand={onToggleExpand}
                        onRecurrenceDateChange={onRecurrenceDateChange}
                        level={level + 1}
                        rootTaskId={currentRootId}
                        hideCompleted={hideCompleted}
                        inMeeting={inMeeting}
                        meetingItems={meetingItems}
                        onUpdateMeetingItems={onUpdateMeetingItems}
                        selectionMode={selectionMode}
                        selectedTaskIds={selectedTaskIds}
                        onToggleTaskSelection={onToggleTaskSelection}
                        taskIndex={idx}
                        taskCount={visibleSubs.length}
                        onMoveUp={() => {
                          if (idx === 0) return;
                          const reordered = [...visibleSubs];
                          [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
                          console.log('[MOVE] MoveUp subtask', subId, 'parent:', task.id, 'reordered:', reordered);
                          onReorderSubtasks(task.id, reordered);
                        }}
                        onMoveDown={() => {
                          if (idx === visibleSubs.length - 1) return;
                          const reordered = [...visibleSubs];
                          [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
                          onReorderSubtasks(task.id, reordered);
                        }}
                        searchQuery={searchQuery}
                      />
                      {/* Nota de subtarea en reunión */}
                      {inMeeting && meetingItems && onUpdateMeetingItems && (
                        <div className="px-4 pb-2 ml-5 border-t dark:border-border-main/20 border-border-main-light/20">
                          <textarea
                            value={meetingItems.find((i: any) => i.taskId === subId)?.note || ''}
                            onChange={e => {
                              const existing = meetingItems.find((i: any) => i.taskId === subId);
                              if (existing) {
                                onUpdateMeetingItems(meetingItems.map((i: any) => i.taskId === subId ? { ...i, note: e.target.value } : i));
                              } else {
                                onUpdateMeetingItems([...meetingItems, { taskId: subId, note: e.target.value, isSubtask: true }]);
                              }
                            }}
                            placeholder="Nota sobre esta subtarea..."
                            rows={1}
                            onInput={(e: any) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            className="w-full dark:bg-transparent bg-transparent border-none text-sm dark:text-text-secondary text-text-secondary-light dark:placeholder:text-text-secondary/20 placeholder:text-text-secondary-light/30 outline-none resize-none overflow-hidden mt-1"
                          />
                        </div>
                      )}
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
 
// --- Inline Editing Chips ---
export function TaskTypeChip({ value, onChange, isCompact = false }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isCore = value === 'core';

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(!show);
  };
  
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`h-6 px-2 py-0.5 rounded-lg flex items-center justify-center gap-1 border transition-all ${
          isCore 
            ? 'bg-turquesa/10 border-turquesa/40 text-turquesa shadow-sm shadow-turquesa/20 hover:border-turquesa' 
            : 'bg-rosa/10 border-rosa/30 text-rosa shadow-sm shadow-rosa/20 hover:border-rosa'
        }`}
        title={isCore ? 'Puesto de Trabajo (CORE)' : 'Tarea Puntual (Ad-hoc)'}
      >
        {isCore ? (
          <>
            <Compass size={10} strokeWidth={2.5} />
            {!isCompact && <span className="text-[8px] font-black uppercase tracking-widest leading-none">Core</span>}
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-current shadow-[0_0_8px_rgba(251,113,133,0.4)]" />
            {!isCompact && <span className="text-[8px] font-black uppercase tracking-widest leading-none ml-0.5">Ad-hoc</span>}
          </>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl p-2 shadow-2xl z-[220] backdrop-blur-xl w-48 overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <div className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest px-2 mb-2">Tipo de Tarea</div>
              <div className="space-y-1">
                <button 
                  onClick={() => { onChange('core'); setShow(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    isCore 
                      ? 'bg-turquesa text-white' 
                      : 'dark:hover:bg-white/5 hover:bg-bg-main-light/50 dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
                  }`}
                >
                  <Compass size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Puesto (CORE)</span>
                </button>
                <button 
                  onClick={() => { onChange('adhoc'); setShow(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    !isCore 
                      ? 'bg-rosa text-white' 
                      : 'dark:hover:bg-white/5 hover:bg-bg-main-light/50 dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light'
                  }`}
                >
                  <div className="w-2 h-2 bg-current rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Puntual (AD-HOC)</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
export function TimePickerChip({ value, onChange }: any) {
  const [show, setShow] = useState(false);
  const [inputVal, setInputVal] = React.useState(value || '');
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  React.useEffect(() => { setInputVal(value || ''); }, [value]);

  const handleConfirm = () => {
    onChange(inputVal);
    setShow(false);
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(s => !s);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all flex items-center gap-1 ${
          value
            ? 'bg-azul/10 border-azul text-azul shadow-sm'
            : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul'
        }`}
        title={value ? `Hora: ${value}` : 'Añadir hora'}
      >
        <Clock size={9} />
        {value && <span>{value}</span>}
      </button>
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={handleConfirm} />
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[160px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Hora ejecución</p>
              <input
                type="time"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onClick={e => e.stopPropagation()}
                onFocus={e => e.stopPropagation()}
                className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-bold text-azul outline-none focus:border-azul/50 text-center"
                autoFocus
              />
              <div className="flex gap-2 mt-3">
                <button onClick={handleConfirm} className="flex-1 py-2 rounded-xl bg-azul text-white text-[10px] font-black uppercase tracking-widest hover:bg-azul/80 transition-all">OK</button>
                {value && <button onClick={() => { onChange(''); setShow(false); }} className="px-3 py-2 rounded-xl text-rosa bg-rosa/10 hover:bg-rosa/20 transition-all"><Trash2 size={12} /></button>}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DatePickerChip({ value, onChange, dropUp = false }: any) {
  const [show, setShow] = useState(false);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isSinFecha = !value;
  const label = isSinFecha ? 'Sin fecha' : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseLocalISO(value));

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(s => !s);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleToggle}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all ${
          isSinFecha 
            ? 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light' 
            : 'bg-turquesa/10 border-turquesa text-turquesa shadow-sm'
        }`}
      >
        {label}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => { setShow(false); setShowFullCalendar(false); }} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[220px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               {!showFullCalendar ? (
                 <div className="space-y-2">
                   <div className="grid grid-cols-2 gap-2">
                     <button 
                       onClick={() => { onChange(formatLocalISO(new Date())); setShow(false); }} 
                       className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                     >
                       <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Hoy</span>
                       <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{new Date().getDate()}</span>
                     </button>
                     <button 
                       onClick={() => { 
                         const m = new Date(); m.setDate(m.getDate() + 1); 
                         onChange(formatLocalISO(m)); setShow(false); 
                       }} 
                       className="flex flex-col items-center gap-1 p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                     >
                       <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Mañana</span>
                       <span className="text-[8px] dark:text-text-secondary text-text-secondary-light">{(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.getDate(); })()}</span>
                     </button>
                   </div>
                   
                   <button 
                     onClick={() => setShowFullCalendar(true)}
                     className="w-full flex items-center justify-between p-3 dark:bg-bg-main bg-white rounded-xl border dark:border-border-main border-border-main-light hover:border-turquesa transition-all group"
                   >
                     <span className="text-[10px] font-black dark:text-white text-text-main-light uppercase tracking-widest group-hover:text-turquesa">Calendario</span>
                     <CalendarIcon size={14} className="dark:text-text-secondary text-text-secondary-light group-hover:text-turquesa" />
                   </button>
 
                   <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 my-1" />
 
                   <button 
                     onClick={() => { onChange(''); setShow(false); }} 
                     className="w-full flex items-center justify-center gap-2 p-3 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                   >
                     <Trash2 size={12} />
                     <span className="text-[10px] font-black uppercase tracking-widest">Quitar Fecha</span>
                   </button>
                 </div>
               ) : (
                 <div className="space-y-4">
                   <div className="flex items-center justify-between px-1">
                     <button 
                       onClick={() => setShowFullCalendar(false)}
                       className="text-[10px] font-black text-turquesa uppercase tracking-widest hover:underline flex items-center gap-1"
                     >
                       <ChevronLeft size={12} /> Volver
                     </button>
                     <span className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest">Mensual</span>
                   </div>
                   <MonthDatePicker 
                     value={value}
                     onChange={(d) => {
                       onChange(d);
                       setShow(false);
                       setShowFullCalendar(false);
                     }}
                   />
                 </div>
               )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
export function RecurrencePickerChip({ value, onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const frequencies = [
    { id: 'daily', label: 'Diaria' },
    { id: 'weekdays', label: 'L-V' },
    { id: 'weekly', label: 'Semanal' },
    { id: 'monthly', label: 'Mensual' },
    { id: 'yearly', label: 'Anual' },
  ];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({
        top: rect.bottom + 8,
        left: rect.left,
        maxHeight: spaceBelow
      });
    }
    setShow(!show);
  };
 
  const getLabel = () => {
    if (!value) return null;
    const { frequency, startDate, weekDays } = value;
    switch (frequency) {
      case 'daily': return 'Diaria';
      case 'weekdays': return 'L-V';
      case 'weekly': {
        const daysShort = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        if (!weekDays || weekDays.length === 0) {
          const dStr = startDate || formatLocalISO(new Date());
          const d = parseLocalISO(dStr);
          const specDay = (d.getDay() + 6) % 7; // 0=Lunes...6=Domingo
          return `Sem - ${daysShort[specDay]}`;
        }
        return `Sem - ${weekDays.map((d: number) => daysShort[d]).join(',')}`;
      }
      case 'monthly': {
        const dayNum = value.monthDay || parseLocalISO(value.startDate || formatLocalISO(new Date())).getDate();
        return `Mensual - Día ${dayNum}`;
      }
      default: return frequency;
    }
  };
 
  const handleDayToggle = (day: number) => {
    const current = value?.weekDays || [];
    const next = current.includes(day) 
      ? current.filter((d: number) => d !== day)
      : [...current, day];
    onChange({ ...(value || { frequency: 'weekly', startDate: formatLocalISO(new Date()) }), weekDays: next });
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`flex items-center justify-center transition-all group/rec h-6 rounded-lg ${
          value 
            ? 'px-2 py-0.5 bg-azul/10 border-2 border-azul text-azul hover:bg-azul/20 whitespace-nowrap shadow-sm' 
            : 'w-6 dark:bg-bg-main bg-white dark:border-border-main border-gray-300 dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul border-2'
        }`}
        title={value ? "Cambiar Recurrencia" : "Activar Recurrencia"}
      >
        <RefreshCw size={10} className={value ? "" : "opacity-50"} />
        {value && (
          <span className="text-[9px] font-black uppercase tracking-widest ml-1.5">
            {getLabel()}
          </span>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-3 z-[220] min-w-[240px] space-y-3 overflow-y-auto"
              style={{
                top: `${modalPos.top}px`,
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                {frequencies.map(f => (
                  <button
                    key={f.id}
                    onClick={() => {
                      const today = new Date();
                      const baseRec = value || { frequency: f.id, startDate: formatLocalISO(today) };
                      const updates: any = { frequency: f.id };
                      if (f.id === 'weekly' && (!baseRec.weekDays || baseRec.weekDays.length === 0)) {
                        updates.weekDays = [(today.getDay() + 6) % 7];
                      }
                      if (f.id === 'monthly' && !baseRec.monthDay) {
                        updates.monthDay = today.getDate();
                      }
                      onChange({ ...baseRec, ...updates });
                    }}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all text-center ${
                      value?.frequency === f.id 
                        ? 'bg-azul text-white' 
                        : 'dark:text-text-secondary text-text-secondary-light dark:bg-white/5 bg-bg-main-light/50 dark:hover:text-white hover:text-text-main-light'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
 
              {value?.frequency === 'weekly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Días de la semana:</p>
                  <div className="flex gap-1 justify-between">
                    {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => {
                      const dayNum = i;
                      const isSelected = (value.weekDays || []).includes(dayNum);
                      return (
                        <button
                          key={d}
                          onClick={() => handleDayToggle(dayNum)}
                          className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${
                            isSelected 
                              ? 'bg-morado text-white' 
                              : 'dark:bg-bg-main bg-white dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light border dark:border-border-main border-border-main-light'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
 
              {value?.frequency === 'monthly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Día del mes (1-31):</p>
                  <input 
                    type="number"
                    min="1"
                    max="31"
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                    value={value.monthDay || parseLocalISO(value.startDate || formatLocalISO(new Date())).getDate()}
                    onChange={e => onChange({ ...value, monthDay: parseInt(e.target.value) || 1 })}
                  />
                </div>
              )}

              {value?.frequency === 'yearly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light space-y-2">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Día del año:</p>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1">
                      <p className="text-[8px] dark:text-text-secondary text-text-secondary-light mb-1">Mes (1-12)</p>
                      <input 
                        type="number"
                        min="1"
                        max="12"
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                        value={value.yearMonth || new Date().getMonth() + 1}
                        onChange={e => onChange({ ...value, yearMonth: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[8px] dark:text-text-secondary text-text-secondary-light mb-1">Día (1-31)</p>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                        value={value.yearDay || new Date().getDate()}
                        onChange={e => onChange({ ...value, yearDay: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                </div>
              )}
 
              {/* Sección Termina */}
              {value && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light space-y-2">
                  <p className="text-[8px] font-black text-azul uppercase mb-2">Termina:</p>
                  
                  {/* Nunca */}
                  <button
                    onClick={() => onChange({ ...value, endDate: null })}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      !value.endDate
                        ? 'bg-azul text-white'
                        : 'dark:bg-bg-main bg-white dark:text-text-secondary text-text-secondary-light border dark:border-border-main border-border-main-light'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                      !value.endDate ? 'border-white' : 'dark:border-border-main border-border-main-light'
                    }`}>
                      {!value.endDate && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    Nunca
                  </button>

                  {/* Fecha concreta - directamente el input */}
                  <div className="space-y-1">
                    <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light uppercase px-1">Fecha fin:</p>
                    <input
                      type="date"
                      value={value.endDate || ''}
                      onChange={e => onChange({ ...value, endDate: e.target.value || null })}
                      onClick={() => {
                        if (!value.endDate) {
                          const sixMonthsLater = new Date();
                          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                          onChange({ ...value, endDate: formatLocalISO(sixMonthsLater) });
                        }
                      }}
                      className={`w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] font-black outline-none text-center transition-all ${
                        value.endDate 
                          ? 'text-azul focus:ring-2 focus:ring-azul/20' 
                          : 'dark:text-text-secondary/40 text-text-secondary-light/40'
                      }`}
                    />
                  </div>
                </div>
              )}

              <div className="h-px dark:bg-border-main bg-border-main-light" />
              <button
                onClick={() => {
                  onChange(value ? null : { frequency: 'daily', startDate: formatLocalISO(new Date()) });
                  if (value) setShow(false);
                }}
                className={`w-full text-center py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${value ? 'text-rosa border-rosa/20 hover:bg-rosa/10' : 'text-turquesa border-turquesa/20 hover:bg-turquesa/10'}`}
              >
                {value ? 'Quitar Recurrencia' : 'Activar Recurrencia'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
export function TagPickerChip({ selectedTags = [], onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tags: TagType[] = ['con_hora', 'focus', 'dirección', 'espera', 'resto'];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    setShow(!show);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className="flex items-center gap-1 cursor-pointer"
      >
        {selectedTags.length > 0 ? (
          <div className="flex -space-x-1.5 h-6 items-center">
            {selectedTags.map((t: any) => (
              <span key={t} className="w-5 h-5 rounded-md dark:bg-bg-card bg-white border-2 border-naranja flex items-center justify-center shadow-md ring-2 dark:ring-bg-main ring-white">
                <span className="text-[11px]">{TAG_LABELS[t].icon}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="w-6 h-6 rounded-lg dark:bg-bg-main bg-white border-2 dark:border-border-main/30 border-naranja/50 flex items-center justify-center opacity-40 hover:opacity-70 dark:hover:border-border-main hover:border-naranja transition-all" title="Sin categoría">
            <span className="text-[11px]">🏷️</span>
          </div>
        )}
      </button>
 
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[240px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3 pl-1">Categorías</p>
               <div className="grid grid-cols-5 gap-2">
                 {tags.map(t => {
                   const active = selectedTags.includes(t);
                   return (
                     <button
                       key={t}
                       onClick={() => {
                         const next = active ? [] : [t];
                         onChange(next);
                         setShow(false);
                       }}
                       className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all border ${
                         active 
                           ? 'bg-turquesa border-turquesa shadow-lg shadow-turquesa/20 text-white' 
                           : 'dark:bg-bg-main bg-white dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa'
                       }`}
                       title={TAG_LABELS[t].label}
                     >
                       {TAG_LABELS[t].icon}
                     </button>
                   );
                 })}
               </div>
               {selectedTags.length > 0 && (
                 <button
                   onClick={() => { onChange([]); setShow(false); }}
                   className="w-full mt-2 flex items-center justify-center gap-2 p-2 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                 >
                   <X size={12} />
                   <span className="text-[9px] font-black uppercase tracking-widest">Sin etiqueta (Resto)</span>
                 </button>
               )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
export function EstimatedTimeChip({ value, onChange, variant = 'default', readonly = false }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = formatMinutes(value);
  const isMini = variant === 'mini';

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!readonly && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
    }
    if (!readonly) setShow(!show);
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`${isMini ? 'h-6 px-1.5 py-0.5' : 'h-6 px-2 py-0.5'} rounded-lg bg-azul/10 border-2 border-azul/50 text-azul font-black uppercase tracking-widest transition-all flex items-center gap-1 shadow-sm ${readonly ? 'opacity-60 cursor-default' : 'hover:bg-azul/20'}`}
        title={readonly ? 'Suma de subtareas' : 'Editar tiempo estimado'}
      >
        <Clock size={9} />
        <span className="text-[11px]">{label}</span>
      </button>

      <AnimatePresence>
        {show && !readonly && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="fixed bg-bg-card border border-border-main rounded-2xl shadow-2xl p-5 z-[220] min-w-[280px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
               <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4 pl-1">Tiempo Estimado (min)</p>
               <div className="flex gap-4 items-center mb-6">
                 <Zap size={20} className="text-azul" />
                 <input 
                  type="number"
                  className="w-full bg-bg-main p-4 rounded-2xl border border-border-main text-2xl font-black text-white outline-none focus:ring-4 focus:ring-azul/20 transition-all"
                  value={value}
                  onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                 />
               </div>
               <div className="grid grid-cols-4 gap-2">
                 {[15, 30, 45, 60, 90, 120].map(v => (
                   <button 
                     key={v} 
                     onClick={() => { onChange(v); setShow(false); }}
                     className="p-2 bg-bg-main rounded-lg text-[10px] font-black text-white border border-border-main hover:border-azul transition-all"
                   >
                     {v}m
                   </button>
                 ))}
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 
export function RegisteredTimeChip({ value, estimated, onClick }: any) {
  const label = formatMinutes(value);
  let colorClass = "text-turquesa bg-turquesa/10 border-turquesa/50";
  if (value > estimated) colorClass = "text-rosa bg-rosa/10 border-rosa/50 animate-pulse";
  else if (value >= estimated * 0.9) colorClass = "text-naranja bg-naranja/10 border-naranja/50";
 
  return (
    <button 
      onClick={onClick}
      className={`h-6 px-2 py-0.5 rounded-lg font-black uppercase tracking-widest transition-all border-2 shadow-sm flex items-center gap-1 ${colorClass}`}
    >
      <Target size={9} />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
 
// --- Time Management Panel ---
 
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
 
  const [newMinutes, setNewMinutes] = useState(30);
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
        className="w-full max-w-xl dark:bg-bg-main bg-white border-t border-x dark:border-border-main border-border-main-light rounded-t-[40px] p-4 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black dark:text-white text-text-main-light uppercase tracking-tighter">
              {task?.title || 'Gestionar Tiempo'}
            </h2>
            <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-[0.2em]">Panel de Control de Horas</p>
          </div>
          <button onClick={onClose} className="p-2 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl dark:hover:bg-bg-main hover:bg-gray-200 transition-all">
            <X size={18} className="dark:text-text-secondary text-text-secondary-light" />
          </button>
        </div>
 
        {/* Tab Navigation */}
        <div className="flex p-1 dark:bg-bg-card bg-gray-100 border dark:border-border-main border-border-main-light rounded-2xl mb-4">
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
            <div className="space-y-4 overflow-y-auto custom-scrollbar px-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px] relative overflow-hidden group">
                  <div className="absolute top-3 right-3 opacity-20"><Zap size={18} className="text-turquesa" /></div>
                  <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-1">Total Registrado</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-turquesa">{comboRegistered}</span>
                    <span className="text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase">min</span>
                  </div>
                  {!subtaskId && hasSubtasks && (
                    <p className="text-[8px] font-bold dark:text-text-secondary text-text-secondary-light mt-1">Propio: {totalRegistered}m · Subtareas: {comboRegistered - totalRegistered}m</p>
                  )}
                </div>
 
                <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px]">
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
 
              <div className="p-4 dark:bg-bg-card bg-gray-50 border dark:border-border-main border-border-main-light rounded-[24px] space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">¿Qué hiciste en esta sesión?</label>
                    <textarea 
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Describe brevemente tu progreso..."
                      className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-sm font-medium dark:text-white text-text-main-light placeholder:text-text-secondary/30 outline-none focus:border-turquesa/50 transition-all resize-none h-20"
                    />
                  </div>
 
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Minutos</label>
                      <input 
                        type="number"
                        value={newMinutes}
                        onChange={(e) => setNewMinutes(parseInt(e.target.value) || 0)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-xl font-black text-turquesa outline-none focus:border-turquesa/50 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest ml-1">Fecha</label>
                      <input 
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-2xl p-3 text-xs font-black dark:text-white text-text-main-light outline-none focus:border-turquesa/50 transition-all uppercase"
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
                  className="w-full py-3 bg-turquesa hover:bg-turquesa/90 text-bg-main font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-turquesa/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
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
// --- Block Picker Chip ---

export function BlockPickerChip({ value, blocks = [], onChange }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0, maxHeight: 500 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedBlock = blocks.find((b: any) => b.id === value);

  const toggleShow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ 
        top: rect.bottom + 8, 
        left: rect.left,
        maxHeight: spaceBelow > 400 ? spaceBelow : 400
      });
    }
    setShow(!show);
  };

  const handleSelect = (blockId: string) => {
    onChange(blockId);
    setShow(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleShow}
        className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full border tracking-tighter whitespace-nowrap shadow-sm dark:bg-bg-main bg-white dark:border-border-main border-border-main-light flex items-center gap-1.5 shrink-0 hover:shadow-md transition-all"
        style={{ color: selectedBlock?.color || '#64748b' }}
        title="Cambiar contexto"
      >
        <span>{selectedBlock?.icon || '📁'}</span>
        {selectedBlock?.name && <span>{selectedBlock.name}</span>}
        <ChevronDown size={10} />
      </button>

      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[240px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Cambiar Contexto</p>
              <div className="space-y-1">
                {blocks.filter((b: any) => b.isActive).map((block: any) => (
                  <button
                    key={block.id}
                    onClick={() => handleSelect(block.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                      value === block.id
                        ? 'bg-turquesa text-white'
                        : 'dark:hover:bg-bg-main hover:bg-gray-100 dark:text-white text-text-main-light'
                    }`}
                  >
                    <div 
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ backgroundColor: `${block.color}20`, color: block.color }}
                    >
                      {block.icon}
                    </div>
                    {block.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Delegation Chip ---

export function DelegationChip({ delegation, people = [], onChange, onAddPerson, onRenamePerson, onDeletePerson, onOpen = null, onClose = null, allTasksMap = {} }: any) {
  const [show, setShow] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const person = delegation ? people.find((p: any) => p.id === delegation.personId) : null;

  const toggleShow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20; // 20px margin
      setModalPos({ 
        top: rect.bottom + 8, 
        left: rect.left,
        maxHeight: spaceBelow
      });
    }
    const next = !show;
    setShow(next);
    if (next) { onOpen && onOpen(); } else { onClose && onClose(); }
  };

  const handleSelect = (personId: string) => {
    onChange({ personId, delegatedAt: formatLocalISO(new Date()) });
    setShow(false);
    onClose && onClose();
  };

  const handleRemove = () => {
    onChange(undefined);
    setShow(false);
    onClose && onClose();
  };

  const handleAddPerson = () => {
    if (!newName.trim()) return;
    const newPerson: any = { id: `p-${Date.now()}`, name: newName.trim(), createdAt: new Date().toISOString() };
    if (onAddPerson) onAddPerson(newPerson);
    setNewName('');
    onChange({ personId: newPerson.id, delegatedAt: formatLocalISO(new Date()) });
    setShow(false);
    onClose && onClose();
  };

  const handleStartEdit = (p: any) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const handleSaveEdit = () => {
    if (editingName.trim() && onRenamePerson) onRenamePerson(editingId, editingName.trim());
    setEditingId(null);
    setEditingName('');
  };

  const handleDeletePerson = (personId: string) => {
    const tasksAssigned = Object.values(allTasksMap).filter((t: any) =>
      t && !t.isDeleted && t.delegation?.personId === personId
    );
    if (tasksAssigned.length > 0) {
      alert(`Esta persona tiene ${tasksAssigned.length} tarea${tasksAssigned.length > 1 ? 's' : ''} asignada${tasksAssigned.length > 1 ? 's' : ''}. Reasígnalas primero antes de eliminarla.`);
      return;
    }
    if (confirm('¿Eliminar esta persona del equipo?')) {
      if (delegation?.personId === personId) onChange(undefined);
      if (onDeletePerson) onDeletePerson(personId);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleShow}
        className={`h-6 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 transition-all flex items-center gap-1 ${
          person
            ? 'bg-morado/10 border-morado text-morado shadow-sm'
            : 'dark:bg-bg-main bg-white dark:border-border-main/30 border-morado/50 dark:text-text-secondary/40 text-text-secondary-light/40 dark:hover:text-text-secondary hover:text-text-secondary-light dark:hover:border-border-main hover:border-morado transition-all'
        }`}
        title={person ? `Delegado a ${person.name}` : 'Delegar tarea'}
      >
        <User size={10} />
        {person && <span>{person.name}</span>}
      </button>

      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => { setShow(false); onClose && onClose(); }} />
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              onClick={e => e.stopPropagation()}
              className="fixed dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl p-4 z-[220] min-w-[220px] overflow-y-auto"
              style={{ 
                top: `${modalPos.top}px`, 
                left: `${modalPos.left}px`,
                maxHeight: `${modalPos.maxHeight || 500}px`
              }}
            >
              <p className="text-[9px] font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">Delegar a</p>
              <div className="space-y-1 mb-3">
                {people.length === 0 && (
                  <p className="text-[10px] dark:text-text-secondary/50 text-text-secondary-light/50 text-center py-2">Sin personas en el equipo</p>
                )}
                {people.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-1 group/dp">
                    {editingId === p.id ? (
                      <div className="flex-1 flex items-center gap-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') { setEditingId(null); setEditingName(''); } }}
                          onClick={e => e.stopPropagation()}
                          onFocus={e => e.stopPropagation()}
                          autoFocus
                          className="flex-1 dark:bg-bg-main bg-white border border-turquesa rounded-lg px-2 py-1.5 text-[11px] dark:text-white text-text-main-light outline-none"
                        />
                        <button onClick={handleSaveEdit} className="w-6 h-6 flex items-center justify-center text-turquesa hover:bg-turquesa/10 rounded-lg transition-all" title="Guardar">
                          <Check size={12} />
                        </button>
                        <button onClick={() => { setEditingId(null); setEditingName(''); }} className="w-6 h-6 flex items-center justify-center text-rosa hover:bg-rosa/10 rounded-lg transition-all" title="Cancelar">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSelect(p.id)}
                          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                            delegation?.personId === p.id
                              ? 'bg-morado text-white'
                              : 'dark:hover:bg-bg-main hover:bg-gray-100 dark:text-white text-text-main-light'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-lg bg-morado/20 flex items-center justify-center text-morado text-[10px] font-black shrink-0">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          {p.name}
                        </button>
                        {onRenamePerson && (
                          <button
                            onClick={e => { e.stopPropagation(); handleStartEdit(p); }}
                            className="w-6 h-6 flex items-center justify-center text-turquesa/40 hover:text-turquesa hover:bg-turquesa/10 rounded-lg transition-all opacity-0 group-hover/dp:opacity-100"
                            title="Editar"
                          >
                            <Edit size={10} />
                          </button>
                        )}
                        {onDeletePerson && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDeletePerson(p.id); }}
                            className="w-6 h-6 flex items-center justify-center text-rosa/40 hover:text-rosa hover:bg-rosa/10 rounded-lg transition-all opacity-0 group-hover/dp:opacity-100"
                            title="Eliminar"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 mb-3" />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.stopPropagation()}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleAddPerson(); }}
                  placeholder="Nueva persona..."
                  className="flex-1 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-morado/50"
                />
                <button
                  onClick={handleAddPerson}
                  className="w-8 h-8 flex items-center justify-center bg-morado/10 hover:bg-morado/20 border border-morado/30 text-morado rounded-xl transition-all"
                >
                  <Plus size={14} />
                </button>
              </div>
              {delegation && (
                <>
                  <div className="h-px dark:bg-border-main/50 bg-border-main-light/50 my-3" />
                  <button
                    onClick={handleRemove}
                    className="w-full flex items-center justify-center gap-2 p-2 bg-rosa/5 rounded-xl border border-rosa/20 text-rosa hover:bg-rosa/10 transition-all"
                  >
                    <X size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest">Quitar delegación</span>
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// DELEGADAS VIEW
// ============================================================
// ========== SEARCH VIEW ==========
export function SearchView({ searchText, setSearchText, searchFilters, setSearchFilters, tasks, allTasksMap, blocks, onEditTask, onToggle, onDelete, onUpdateTask }: any) {
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tasks.forEach((t: Task) => {
      (t.tags || []).forEach((tag: string) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks]);

  const filteredResults = useMemo(() => {
    return tasks.filter((t: Task) => {
      // Text search (contains)
      if (searchText && !t.title.toLowerCase().includes(searchText.toLowerCase())) return false;
      
      // Tag filter
      if (searchFilters.tags.length > 0) {
        const hasTag = searchFilters.tags.some(tag => (t.tags || []).includes(tag));
        if (!hasTag) return false;
      }
      
      // Status filter
      if (searchFilters.status === 'pending' && t.status === 'completed') return false;
      if (searchFilters.status === 'completed' && t.status !== 'completed') return false;
      
      // Type filter
      if (searchFilters.taskType === 'core' && t.taskType !== 'core') return false;
      if (searchFilters.taskType === 'adhoc' && t.taskType !== 'adhoc') return false;
      
      // Due date range
      if (searchFilters.dueDateRange.start && (!t.dueDate || t.dueDate < searchFilters.dueDateRange.start)) return false;
      if (searchFilters.dueDateRange.end && (!t.dueDate || t.dueDate > searchFilters.dueDateRange.end)) return false;
      
      // Created date range
      if (searchFilters.createdRange.start && (!t.createdAt || t.createdAt < searchFilters.createdRange.start)) return false;
      if (searchFilters.createdRange.end && (!t.createdAt || t.createdAt > searchFilters.createdRange.end)) return false;
      
      // Completed date range
      if (searchFilters.completedRange.start && (!t.completedAt || t.completedAt < searchFilters.completedRange.start)) return false;
      if (searchFilters.completedRange.end && (!t.completedAt || t.completedAt > searchFilters.completedRange.end)) return false;
      
      // Recurrence filter
      if (searchFilters.recurrence === 'recurring' && !t.isTemplate) return false;
      if (searchFilters.recurrence === 'instances' && !t.templateId) return false;
      if (searchFilters.recurrence === 'manual' && (t.isTemplate || t.templateId)) return false;
      
      // Estimated time filter
      if (searchFilters.hasEstimatedTime && (!t.estimatedMinutes || t.estimatedMinutes === 0)) return false;
      if (t.estimatedMinutes && t.estimatedMinutes < searchFilters.estimatedTimeRange.min) return false;
      if (t.estimatedMinutes && t.estimatedMinutes > searchFilters.estimatedTimeRange.max) return false;
      
      return true;
    });
  }, [tasks, searchText, searchFilters]);

  const groupedResults = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    filteredResults.forEach((t: Task) => {
      const block = blocks.find((b: any) => b.id === t.blockId) || { id: 'unknown', name: 'Sin bloque', color: '#666' };
      if (!groups[block.id]) groups[block.id] = [];
      groups[block.id].push(t);
    });
    return groups;
  }, [filteredResults, blocks]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black dark:text-white text-text-main-light">Búsqueda</h1>
          <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-1">
            {filteredResults.length} {filteredResults.length === 1 ? 'resultado' : 'resultados'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filters Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          {/* Text Search */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-2">
              Buscar texto
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Escribe aquí..."
              className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-sm dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
            />
          </div>

          {/* Tag Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-2">
              Etiquetas
            </label>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => {
                    setSearchFilters((prev: any) => ({
                      ...prev,
                      tags: prev.tags.includes(tag) ? prev.tags.filter((t: string) => t !== tag) : [...prev.tags, tag]
                    }));
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    searchFilters.tags.includes(tag)
                      ? 'bg-turquesa text-white'
                      : 'dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light'
                  }`}
                >
                  {TAG_LABELS[tag as TagType] || tag}
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-2">
              Estado
            </label>
            <div className="flex gap-2">
              {['all', 'pending', 'completed'].map(status => (
                <button
                  key={status}
                  onClick={() => setSearchFilters((prev: any) => ({ ...prev, status }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    searchFilters.status === status
                      ? 'bg-turquesa text-white'
                      : 'dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light'
                  }`}
                >
                  {status === 'all' ? 'Todas' : status === 'pending' ? 'Pendientes' : 'Completadas'}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-2">
              Tipo
            </label>
            <div className="flex gap-2">
              {['all', 'core', 'adhoc'].map(type => (
                <button
                  key={type}
                  onClick={() => setSearchFilters((prev: any) => ({ ...prev, taskType: type }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    searchFilters.taskType === type
                      ? 'bg-turquesa text-white'
                      : 'dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light'
                  }`}
                >
                  {type === 'all' ? 'Todas' : type === 'core' ? 'Core' : 'Ad-hoc'}
                </button>
              ))}
            </div>
          </div>

          {/* Recurrence Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-2">
              Recurrencia
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'all', label: 'Todas' },
                { id: 'recurring', label: 'Recurrentes' },
                { id: 'instances', label: 'Instancias' },
                { id: 'manual', label: 'Manuales' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setSearchFilters((prev: any) => ({ ...prev, recurrence: opt.id }))}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${
                    searchFilters.recurrence === opt.id
                      ? 'bg-turquesa text-white'
                      : 'dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Due Date Range Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">
              Fecha de ejecución
            </label>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Desde</label>
                <input
                  type="date"
                  value={searchFilters.dueDateRange.start}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    dueDateRange: { ...prev.dueDateRange, start: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Hasta</label>
                <input
                  type="date"
                  value={searchFilters.dueDateRange.end}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    dueDateRange: { ...prev.dueDateRange, end: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
            </div>
          </div>

          {/* Created Date Range Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">
              Fecha de creación
            </label>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Desde</label>
                <input
                  type="date"
                  value={searchFilters.createdRange.start}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    createdRange: { ...prev.createdRange, start: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Hasta</label>
                <input
                  type="date"
                  value={searchFilters.createdRange.end}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    createdRange: { ...prev.createdRange, end: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
            </div>
          </div>

          {/* Completed Date Range Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">
              Fecha de completado
            </label>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Desde</label>
                <input
                  type="date"
                  value={searchFilters.completedRange.start}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    completedRange: { ...prev.completedRange, start: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Hasta</label>
                <input
                  type="date"
                  value={searchFilters.completedRange.end}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    completedRange: { ...prev.completedRange, end: e.target.value }
                  }))}
                  className="w-full px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                />
              </div>
            </div>
          </div>

          {/* Estimated Time Filter */}
          <div className="dark:bg-bg-card bg-white p-4 rounded-2xl border dark:border-border-main border-border-main-light">
            <label className="block text-xs font-black dark:text-text-secondary text-text-secondary-light uppercase tracking-widest mb-3">
              Tiempo estimado
            </label>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={searchFilters.hasEstimatedTime}
                  onChange={(e) => setSearchFilters((prev: any) => ({
                    ...prev,
                    hasEstimatedTime: e.target.checked
                  }))}
                  className="w-4 h-4 rounded border-2 dark:border-border-main border-border-main-light dark:bg-bg-secondary bg-gray-100 checked:bg-turquesa checked:border-turquesa"
                />
                <span className="text-xs dark:text-white text-text-main-light">Solo tareas con tiempo</span>
              </label>
              <div>
                <label className="text-[10px] dark:text-text-secondary text-text-secondary-light mb-1 block">Rango (minutos)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={searchFilters.estimatedTimeRange.min}
                    onChange={(e) => setSearchFilters((prev: any) => ({
                      ...prev,
                      estimatedTimeRange: { ...prev.estimatedTimeRange, min: parseInt(e.target.value) || 0 }
                    }))}
                    className="flex-1 px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={searchFilters.estimatedTimeRange.max}
                    onChange={(e) => setSearchFilters((prev: any) => ({
                      ...prev,
                      estimatedTimeRange: { ...prev.estimatedTimeRange, max: parseInt(e.target.value) || 999 }
                    }))}
                    className="flex-1 px-3 py-2 dark:bg-bg-secondary bg-gray-100 border dark:border-border-main border-border-main-light rounded-xl text-xs dark:text-white text-text-main-light focus:outline-none focus:ring-2 focus:ring-turquesa"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Reset Filters */}
          <button
            onClick={() => {
              setSearchText('');
              setSearchFilters({
                tags: [],
                status: 'all',
                taskType: 'all',
                dueDateRange: { start: '', end: '' },
                createdRange: { start: '', end: '' },
                completedRange: { start: '', end: '' },
                recurrence: 'all',
                hasEstimatedTime: false,
                estimatedTimeRange: { min: 0, max: 999 }
              });
            }}
            className="w-full py-3 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light transition-all font-black text-sm"
          >
            Limpiar filtros
          </button>
        </div>

        {/* Results */}
        <div className="lg:col-span-3 space-y-6">
          {filteredResults.length === 0 ? (
            <div className="dark:bg-bg-card bg-white p-12 rounded-2xl border dark:border-border-main border-border-main-light text-center">
              <Search size={48} className="mx-auto dark:text-text-secondary text-text-secondary-light mb-4" />
              <p className="text-lg font-bold dark:text-text-secondary text-text-secondary-light">
                No se encontraron resultados
              </p>
              <p className="text-sm dark:text-text-secondary text-text-secondary-light mt-2">
                Intenta ajustar los filtros
              </p>
            </div>
          ) : (
            Object.entries(groupedResults).map(([blockId, blockTasks]) => {
              const block = blocks.find((b: any) => b.id === blockId) || { id: 'unknown', name: 'Sin bloque', color: '#666', icon: '📋' };
              return (
                <div key={blockId} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full" style={{ backgroundColor: block.color }} />
                    <span className="text-sm font-black uppercase tracking-wider dark:text-white text-text-main-light">
                      {block.icon} {block.name}
                    </span>
                    <span className="text-xs dark:text-text-secondary text-text-secondary-light">
                      {blockTasks.length} {blockTasks.length === 1 ? 'tarea' : 'tareas'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {blockTasks.map((task: Task) => (
                      <div
                        key={task.id}
                        className="dark:bg-bg-card bg-white p-4 rounded-xl border dark:border-border-main border-border-main-light hover:dark:border-turquesa hover:border-turquesa transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => onToggle(task.id)}
                            className="mt-1 shrink-0"
                          >
                            {task.status === 'completed' ? (
                              <CheckCircle2 size={20} className="text-turquesa" />
                            ) : (
                              <Circle size={20} className="dark:text-text-secondary text-text-secondary-light" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <h3 className={`font-bold text-sm dark:text-white text-text-main-light ${task.status === 'completed' ? 'line-through opacity-50' : ''}`}>
                              {task.title}
                            </h3>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {task.dueDate && (
                                <span className="text-xs px-2 py-1 rounded-lg dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light">
                                  📅 {new Date(task.dueDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                              {task.estimatedMinutes > 0 && (
                                <span className="text-xs px-2 py-1 rounded-lg dark:bg-bg-secondary bg-gray-100 dark:text-text-secondary text-text-secondary-light">
                                  ⏱️ {formatMinutes(task.estimatedMinutes)}
                                </span>
                              )}
                              {(task.tags || []).map((tag: string) => (
                                <span key={tag} className="text-xs px-2 py-1 rounded-lg bg-turquesa/20 text-turquesa font-bold">
                                  {TAG_LABELS[tag as TagType]?.label || tag}
                                </span>
                              ))}
                              {task.templateId && (
                                <span className="text-xs px-2 py-1 rounded-lg bg-turquesa/20 text-turquesa font-bold flex items-center gap-1">
                                  <RefreshCw size={10} /> Instancia
                                </span>
                              )}
                              {task.isTemplate && (
                                <span className="text-xs px-2 py-1 rounded-lg bg-morado/20 text-morado font-bold flex items-center gap-1">
                                  <RefreshCw size={10} /> Template
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => onEditTask(task.id)}
                              className="p-2 dark:bg-bg-secondary bg-gray-100 rounded-lg dark:text-text-secondary text-text-secondary-light hover:dark:text-white hover:text-text-main-light transition-all"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => onDelete(task.id)}
                              className="p-2 dark:bg-bg-secondary bg-gray-100 rounded-lg dark:text-text-secondary text-text-secondary-light hover:text-rosa transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </motion.div>
  );
}


export function BulkActionBar({ 
  count, 
  onDelegate, 
  onChangeDate, 
  onComplete, 
  onChangeTime, 
  onDuplicate, 
  onDelete, 
  onCancel,
  isMobile = false 
}: any) {
  return (
    <div className={`${isMobile ? 'fixed bottom-0 left-0 right-0' : 'sticky top-0'} z-50 dark:bg-bg-card bg-white border-t dark:border-border-main border-border-main-light shadow-2xl`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-full bg-azul/20 border-2 border-azul flex items-center justify-center">
            <Check size={12} className="text-azul" />
          </div>
          <span className="text-sm font-black dark:text-white text-text-main-light">
            {count} seleccionada{count !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onDelegate} className="px-3 py-2 rounded-xl bg-morado/10 border border-morado/30 text-morado hover:bg-morado/20 transition-all flex items-center gap-1.5 text-xs font-bold" title="Delegar">
            <Users size={14} />{!isMobile && <span>Delegar</span>}
          </button>
          <button onClick={onChangeDate} className="px-3 py-2 rounded-xl bg-turquesa/10 border border-turquesa/30 text-turquesa hover:bg-turquesa/20 transition-all flex items-center gap-1.5 text-xs font-bold" title="Cambiar fecha">
            <CalendarIcon size={14} />{!isMobile && <span>Fecha</span>}
          </button>
          <button onClick={onComplete} className="px-3 py-2 rounded-xl bg-azul/10 border border-azul/30 text-azul hover:bg-azul/20 transition-all flex items-center gap-1.5 text-xs font-bold" title="Completar">
            <CheckCircle2 size={14} />{!isMobile && <span>Completar</span>}
          </button>
          <button onClick={onChangeTime} className="px-3 py-2 rounded-xl bg-azul/10 border border-azul/30 text-azul hover:bg-azul/20 transition-all flex items-center gap-1.5 text-xs font-bold" title="Cambiar tiempo">
            <Clock size={14} />{!isMobile && <span>Tiempo</span>}
          </button>
          <button onClick={onDuplicate} className="px-3 py-2 rounded-xl dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-white/5 hover:bg-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold" title="Duplicar">
            <Copy size={14} />{!isMobile && <span>Duplicar</span>}
          </button>
          <button onClick={onDelete} className="px-3 py-2 rounded-xl bg-rosa/10 border border-rosa/30 text-rosa hover:bg-rosa/20 transition-all flex items-center gap-1.5 text-xs font-bold" title="Eliminar">
            <Trash2 size={14} />{!isMobile && <span>Eliminar</span>}
          </button>
          <button onClick={onCancel} className="px-3 py-2 rounded-xl dark:bg-bg-main bg-gray-100 border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-white/5 hover:bg-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold" title="Cancelar">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToggleExpandButton({ blockId, onExpandAll }: { blockId: string, onExpandAll: (id: string, expand: boolean) => void }) {
  const [expanded, setExpanded] = React.useState(true);
  return (
    <button
      onClick={() => {
        const next = !expanded;
        setExpanded(next);
        onExpandAll(blockId, next);
      }}
      className={`w-9 h-9 flex items-center justify-center rounded-full border-2 transition-all relative group ${
        expanded
          ? 'bg-azul text-white border-azul shadow-lg shadow-azul/30'
          : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul'
      }`}
      title={expanded ? 'Contraer todo' : 'Expandir todo'}
    >
      {expanded ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light rounded-lg text-[9px] font-bold dark:text-white text-text-main-light whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
        {expanded ? 'Contraer' : 'Expandir'}
      </span>
    </button>
  );
}
