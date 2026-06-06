/**
 * DashboardComponents.tsx
 * DashboardHarmonicCalendar, BulkActionBar, ToggleExpandButton
 */
import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, CheckCircle2, Calendar as CalendarIcon,
  Clock, Users, Copy, Trash2, X, ChevronsUp, ChevronsDown, Check
} from 'lucide-react';
import { motion } from 'framer-motion';
import { formatLocalISO, parseLocalISO } from './dateUtils';

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

// ─────────────────────────────────────────────
// InstancesModal — Ver instancias de una tarea recurrente
// ─────────────────────────────────────────────
