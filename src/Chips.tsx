/**
 * Chips.tsx
 * Todos los chips inline editables: TaskTypeChip, TimePickerChip, DatePickerChip,
 * RecurrencePickerChip, TagPickerChip, EstimatedTimeChip, RegisteredTimeChip,
 * BlockPickerChip, DelegationChip
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Clock, X, RefreshCw, Check, ChevronLeft, ChevronRight, ChevronDown,
  Compass, Target, Grid2X2, User, Users, Globe, PlusCircle,
  Trash2, Edit, Zap, Tag, Plus, Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { WorkBlock, Task, TagType, Person } from './types';
import { TAG_LABELS, COLORS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { formatMinutes } from './utils';
import { supabase } from './supabaseClient';
import { MonthDatePicker } from './TimeComponents';

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
            ? 'dark:bg-bg-main bg-white dark:border-border-main border-gray-400 dark:text-text-secondary text-text-secondary-light' 
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
  const [localValue, setLocalValue] = useState<any>(value);
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
    setLocalValue(value); // sincronizar estado local al abrir
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

  const handleClose = () => {
    setShow(false);
    // Solo llamar onChange al cerrar — evita regenerar instancias en cada clic
    if (JSON.stringify(localValue) !== JSON.stringify(value)) {
      onChange(localValue);
    }
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
    const current = localValue?.weekDays || [];
    const next = current.includes(day) 
      ? current.filter((d: number) => d !== day)
      : [...current, day];
    setLocalValue({ ...(localValue || { frequency: 'weekly', startDate: formatLocalISO(new Date()) }), weekDays: next });
  };
 
  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        onClick={handleOpen}
        className={`flex items-center justify-center transition-all group/rec h-6 rounded-lg ${
          value 
            ? 'px-2 py-0.5 bg-azul/10 border-2 border-azul text-azul hover:bg-azul/20 whitespace-nowrap shadow-sm' 
            : 'w-6 dark:bg-bg-main bg-white dark:border-border-main border-gray-400 dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul border-2'
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
            <div className="fixed inset-0 z-[210]" onClick={handleClose} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
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
                      const baseRec = localValue || { frequency: f.id, startDate: formatLocalISO(today) };
                      const updates: any = { frequency: f.id };
                      if (f.id === 'weekly' && (!baseRec.weekDays || baseRec.weekDays.length === 0)) {
                        updates.weekDays = [(today.getDay() + 6) % 7];
                      }
                      if (f.id === 'monthly' && !baseRec.monthDay) {
                        updates.monthDay = today.getDate();
                      }
                      setLocalValue({ ...baseRec, ...updates });
                    }}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all text-center ${
                      localValue?.frequency === f.id 
                        ? 'bg-azul text-white' 
                        : 'dark:text-text-secondary text-text-secondary-light dark:bg-white/5 bg-bg-main-light/50 dark:hover:text-white hover:text-text-main-light'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
 
              {localValue?.frequency === 'weekly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Días de la semana:</p>
                  <div className="flex gap-1 justify-between">
                    {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => {
                      const dayNum = i;
                      const isSelected = (localValue?.weekDays || []).includes(dayNum);
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
 
              {localValue?.frequency === 'monthly' && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light">
                  <p className="text-[8px] font-black text-morado uppercase mb-2">Día del mes (1-31):</p>
                  <input 
                    type="number"
                    min="1"
                    max="31"
                    className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                    value={localValue?.monthDay || parseLocalISO(localValue?.startDate || formatLocalISO(new Date())).getDate()}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                    onFocus={e => e.stopPropagation()}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 1 && val <= 31) {
                        setLocalValue({ ...localValue, monthDay: val });
                      }
                    }}
                  />
                </div>
              )}

              {localValue?.frequency === 'yearly' && (
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
                        value={localValue?.yearMonth || new Date().getMonth() + 1}
                        onChange={e => setLocalValue({ ...localValue, yearMonth: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[8px] dark:text-text-secondary text-text-secondary-light mb-1">Día (1-31)</p>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        className="w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[12px] font-black text-morado outline-none text-center focus:ring-2 focus:ring-morado/20"
                        value={localValue?.yearDay || new Date().getDate()}
                        onChange={e => setLocalValue({ ...localValue, yearDay: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                </div>
              )}
 
              {/* Sección Termina */}
              {localValue && (
                <div className="pt-2 border-t dark:border-border-main border-border-main-light space-y-2">
                  <p className="text-[8px] font-black text-azul uppercase mb-2">Termina:</p>
                  
                  {/* Nunca */}
                  <button
                    onClick={() => setLocalValue({ ...localValue, endDate: null })}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      !localValue?.endDate
                        ? 'bg-azul text-white'
                        : 'dark:bg-bg-main bg-white dark:text-text-secondary text-text-secondary-light border dark:border-border-main border-border-main-light'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                      !localValue?.endDate ? 'border-white' : 'dark:border-border-main border-border-main-light'
                    }`}>
                      {!localValue?.endDate && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    Nunca
                  </button>

                  {/* Fecha concreta - directamente el input */}
                  <div className="space-y-1">
                    <p className="text-[8px] font-black dark:text-text-secondary text-text-secondary-light uppercase px-1">Fecha fin:</p>
                    <input
                      type="date"
                      value={localValue?.endDate || ''}
                      onChange={e => setLocalValue({ ...localValue, endDate: e.target.value || null })}
                      onClick={() => {
                        if (!localValue?.endDate) {
                          const sixMonthsLater = new Date();
                          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                          setLocalValue({ ...localValue, endDate: formatLocalISO(sixMonthsLater) });
                        }
                      }}
                      className={`w-full dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] font-black outline-none text-center transition-all ${
                        localValue?.endDate 
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
                  if (localValue) {
                    onChange(null);
                    setLocalValue(null);
                    setShow(false);
                  } else {
                    setLocalValue({ frequency: 'daily', startDate: formatLocalISO(new Date()) });
                  }
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
          <div className="w-6 h-6 rounded-lg dark:bg-bg-main bg-white border-2 dark:border-border-main/30 border-naranja/70 flex items-center justify-center opacity-60 hover:opacity-90 dark:hover:border-border-main hover:border-naranja transition-all" title="Sin categoría">
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
 

// ─── Popover de tiempo compartido ────────────────────────────────────────────
function TimePopover({
  title, icon, color, value, onConfirm, onClose, extraBottom
}: {
  title: string; icon: React.ReactNode; color: string;
  value: number; onConfirm: (v: number) => void; onClose: () => void;
  extraBottom?: React.ReactNode;
}) {
  const [local, setLocal] = useState(value || 0);
  const PRESETS = [15, 30, 45, 60, 90, 120];
  return (
    <div className="p-4 space-y-3 min-w-[256px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">{title}</p>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-lg dark:hover:bg-white/10 hover:bg-black/5 transition-all dark:text-text-secondary text-text-secondary-light">
          <X size={12} />
        </button>
      </div>
      {/* Input */}
      <div className="flex items-center gap-3 dark:bg-bg-main bg-gray-100 rounded-2xl px-4 py-3 border dark:border-border-main border-border-main-light">
        <span style={{ color }}>{icon}</span>
        <input
          type="number" min={0}
          value={local || ''}
          onChange={e => setLocal(parseInt(e.target.value) || 0)}
          onKeyDown={e => { if (e.key === 'Enter') { onConfirm(local); onClose(); } }}
          className="flex-1 bg-transparent text-2xl font-black dark:text-white text-text-main-light outline-none w-full"
          autoFocus placeholder="0"
        />
        <span className="text-[11px] dark:text-text-secondary text-text-secondary-light font-bold">min</span>
      </div>
      {/* Presets */}
      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map(v => (
          <button key={v} onClick={() => { setLocal(v); }}
            className={`py-2 rounded-xl text-[11px] font-black transition-all border ${
              local === v
                ? 'text-white border-transparent'
                : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light dark:hover:border-white/30 hover:border-black/20 dark:hover:text-white hover:text-text-main-light'
            }`}
            style={local === v ? { backgroundColor: color, borderColor: color } : {}}
          >
            {v >= 60 ? `${v/60}h` : `${v}m`}
          </button>
        ))}
      </div>
      {extraBottom}
      {/* Confirmar */}
      <button onClick={() => { if (local > 0) { onConfirm(local); onClose(); } }}
        className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white transition-all active:scale-[0.98] disabled:opacity-40"
        style={{ backgroundColor: color }}
        disabled={local === 0}
      >
        Confirmar {local > 0 ? `· ${local >= 60 ? `${Math.floor(local/60)}h${local%60>0?` ${local%60}m`:''}` : `${local}m`}` : ''}
      </button>
    </div>
  );
}

export function EstimatedTimeChip({ value, onChange, variant = 'default', readonly = false }: any) {
  const [show, setShow] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0, maxHeight: 500 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = formatMinutes(value);
  const isMini = variant === 'mini';
  const COLOR = '#3B82F6'; // azul

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!readonly && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
      setShow(true);
    }
  };

  return (
    <div className="relative">
      <button ref={buttonRef} onClick={handleOpen}
        className={`${isMini ? 'h-6 px-1.5' : 'h-6 px-2'} rounded-lg bg-azul/10 border-2 border-azul/50 text-azul font-black uppercase tracking-widest transition-all flex items-center gap-1 shadow-sm ${readonly ? 'opacity-60 cursor-default' : 'hover:bg-azul/20'}`}
        title={readonly ? 'Suma de subtareas' : 'Editar tiempo estimado'}
      >
        <Clock size={9} />
        <span className="text-[11px]">{label}</span>
      </button>
      <AnimatePresence>
        {show && !readonly && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className="fixed dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl z-[220] overflow-hidden"
              style={{ top: `${modalPos.top}px`, left: `${modalPos.left}px`, maxHeight: `${modalPos.maxHeight}px` }}
            >
              <TimePopover
                title="Tiempo estimado" icon={<Clock size={16} />} color={COLOR}
                value={value} onConfirm={v => onChange(v)} onClose={() => setShow(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function RegisteredTimeChip({ value, estimated, onAddEntry, taskId, subtaskId, date, onMoreOptions, onClick }: any) {
  const [show, setShow] = useState(false);
  const [manualVal, setManualVal] = useState<number | ''>('');
  const [markComplete, setMarkComplete] = useState(false);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0, maxHeight: 500 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const safeValue = (value === undefined || value === null || isNaN(value)) ? 0 : value;
  const label = formatMinutes(safeValue);
  const COLOR = '#14B8A6';

  let color = '#94A3B8'; let bg = 'transparent'; let border = '#CBD5E1';
  if (safeValue > 0 && estimated > 0 && safeValue > estimated) {
    color = '#EC4899'; bg = 'rgba(236,72,153,0.1)'; border = 'rgba(236,72,153,0.5)';
  } else if (safeValue > 0 && estimated > 0 && safeValue >= estimated * 0.9) {
    color = '#F97316'; bg = 'rgba(249,115,22,0.1)'; border = 'rgba(249,115,22,0.5)';
  } else if (safeValue > 0) {
    color = '#84CC16'; bg = 'rgba(132,204,22,0.1)'; border = 'rgba(132,204,22,0.5)';
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAddEntry && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      setModalPos({ top: rect.bottom + 8, left: rect.left, maxHeight: spaceBelow });
      setManualVal('');
      setMarkComplete(false);
      setShow(true);
    } else if (onClick) {
      onClick();
    }
  };

  const register = (mins: number) => {
    if (mins <= 0) return;
    onAddEntry(taskId, subtaskId, mins, date, '', markComplete);
    setShow(false);
  };

  const PRESETS = [15, 30, 45, 60, 90, 120];

  return (
    <div className="relative">
      <button ref={buttonRef} onClick={handleOpen}
        className="h-6 px-2 py-0.5 rounded-lg font-black uppercase tracking-widest transition-all border shadow-sm flex items-center gap-1 hover:opacity-80"
        style={{ color, backgroundColor: bg, borderColor: border }}
      >
        <Target size={9} />
        <span className="text-[11px]">{label}</span>
      </button>

      <AnimatePresence>
        {show && onAddEntry && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setShow(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className="fixed dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-2xl shadow-2xl z-[220] overflow-hidden"
              style={{ top: `${modalPos.top}px`, left: `${modalPos.left}px`, maxHeight: `${modalPos.maxHeight}px` }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 space-y-3 min-w-[240px]">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light">Registrar tiempo</p>
                  <button onClick={() => setShow(false)} className="w-6 h-6 flex items-center justify-center rounded-lg dark:hover:bg-white/10 hover:bg-black/5 transition-all dark:text-text-secondary text-text-secondary-light">
                    <X size={12} />
                  </button>
                </div>

                {/* Presets — clic directo registra */}
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESETS.map(v => (
                    <button key={v} onClick={(e) => { e.stopPropagation(); register(v); }}
                      className="py-2 rounded-xl text-[11px] font-black transition-all border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:text-white hover:border-transparent active:scale-95"
                      style={{} }
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = COLOR; (e.currentTarget as HTMLButtonElement).style.borderColor = COLOR; (e.currentTarget as HTMLButtonElement).style.color = 'white'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; (e.currentTarget as HTMLButtonElement).style.borderColor = ''; (e.currentTarget as HTMLButtonElement).style.color = ''; }}
                    >
                      {v >= 60 ? `${v/60}h` : `${v}m`}
                    </button>
                  ))}
                </div>

                {/* Input manual */}
                <div className="flex items-center gap-2 dark:bg-bg-main bg-gray-100 rounded-xl px-3 py-2 border dark:border-border-main border-border-main-light">
                  <Target size={12} style={{ color: COLOR }} />
                  <input
                    type="number" min={1} placeholder="Otro..."
                    value={manualVal}
                    onChange={e => setManualVal(parseInt(e.target.value) || '')}
                    onKeyDown={e => { if (e.key === 'Enter' && manualVal) register(manualVal as number); }}
                    className="flex-1 bg-transparent text-sm font-black dark:text-white text-text-main-light outline-none"
                  />
                  <span className="text-[10px] dark:text-text-secondary text-text-secondary-light">min</span>
                  {manualVal ? (
                    <button onClick={(e) => { e.stopPropagation(); register(manualVal as number); }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white transition-all"
                      style={{ backgroundColor: COLOR }}
                    >
                      <Check size={10} strokeWidth={3} />
                    </button>
                  ) : null}
                </div>

                {/* Marcar completada */}
                <button onClick={() => setMarkComplete(v => !v)}
                  className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-xl border text-[11px] font-black transition-all ${markComplete ? 'border-turquesa bg-turquesa/10 text-turquesa' : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light'}`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center border-2 shrink-0 transition-all ${markComplete ? 'bg-turquesa border-turquesa' : 'dark:border-border-main border-border-main-light'}`}>
                    {markComplete && <Check size={9} strokeWidth={3} className="text-white" />}
                  </div>
                  Marcar como completada
                </button>

                {/* Más opciones */}
                {onMoreOptions && (
                  <button onClick={() => { setShow(false); onMoreOptions(); }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest dark:text-text-secondary text-text-secondary-light dark:hover:text-white hover:text-text-main-light transition-all"
                  >
                    Más opciones <span className="opacity-50">→</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
 

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
            ? 'bg-azul/10 border-azul text-azul shadow-sm'
            : 'dark:bg-bg-main bg-white dark:border-border-main/30 border-azul/30 dark:text-text-secondary/40 text-text-secondary-light/40 dark:hover:text-text-secondary hover:text-text-secondary-light dark:hover:border-border-main hover:border-azul transition-all'
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
                              ? 'bg-azul text-white'
                              : 'dark:hover:bg-bg-main hover:bg-gray-100 dark:text-white text-text-main-light'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-lg bg-azul/20 flex items-center justify-center text-azul text-[10px] font-black shrink-0">
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
                  className="flex-1 dark:bg-bg-main bg-white border dark:border-border-main border-border-main-light rounded-xl px-3 py-2 text-[11px] dark:text-white text-text-main-light dark:placeholder:text-text-secondary/40 placeholder:text-text-secondary-light/40 outline-none focus:border-azul/50"
                />
                <button
                  onClick={handleAddPerson}
                  className="w-8 h-8 flex items-center justify-center bg-azul/10 hover:bg-azul/20 border border-azul/30 text-azul rounded-xl transition-all"
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
