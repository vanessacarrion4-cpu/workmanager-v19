/**
 * Modals.tsx
 * RecurrenceChoiceModal, BlockModal, InstancesModal
 */
import React, { useState, useMemo } from 'react';
import { Edit, Trash2, X, RefreshCw, RotateCcw, Check, Circle, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { WorkBlock, Task, TagType } from './types';
import { COLORS, TAG_LABELS } from './constants';
import { formatLocalISO, parseLocalISO } from './dateUtils';
import { generateInstances } from './utils';

// §16.31 (sesión 24): banda-inventario del borrado — LISTA lo que se va, no solo lo cuenta. Un contenedor partido
// por etiqueta se lleva las hijas de los OTROS grupos (que no se ven); el aviso debe enseñarlas. Formato ÚNICO (sin
// umbral, decisión de la propietaria): resumen por etiqueta + total + "Ver las N →" desplegable (lista agrupada, scroll).
function DeleteInventoryBand({ items, verbo }: { items: Task[]; verbo: string }) {
  const [open, setOpen] = useState(false);
  const total = items.length;
  if (total === 0) return null;
  // Agrupar por etiqueta (tag). Orden estable por el orden de TAG_LABELS.
  // Etiqueta principal de una tarea = tags[0] || 'resto' (mismo criterio que filters.ts:301, el que usa Mi Día).
  const tagOf = (c: Task): TagType => ((c.tags && c.tags[0]) || 'resto') as TagType;
  const order = Object.keys(TAG_LABELS) as TagType[];
  const groups = order
    .map(tag => ({ tag, items: items.filter(c => tagOf(c) === tag) }))
    .filter(g => g.items.length > 0);
  // Etiquetas presentes que no estén en el orden conocido (defensivo) → al final como "Resto".
  const known = new Set(groups.flatMap(g => g.items.map(i => i.id)));
  const rest = items.filter(c => !known.has(c.id));
  if (rest.length > 0) groups.push({ tag: 'resto' as TagType, items: rest });
  const plural = total !== 1;
  return (
    <div className="mb-5 rounded-2xl border border-naranja/40 bg-naranja/10 p-4">
      <div className="flex gap-3">
        <span className="text-lg leading-none shrink-0">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-naranja leading-relaxed">
            {verbo} se lleva {total} subtarea{plural ? 's' : ''}:
          </p>
          <p className="text-xs font-bold text-naranja/90 mt-1 leading-relaxed">
            {groups.map((g, i) => (
              <span key={g.tag}>
                {i > 0 && <span className="opacity-50"> · </span>}
                {TAG_LABELS[g.tag].icon} {TAG_LABELS[g.tag].label} ({g.items.length})
              </span>
            ))}
          </p>
          <button
            onClick={() => setOpen(o => !o)}
            className="mt-2 text-[10px] font-black uppercase tracking-widest text-naranja hover:text-white transition-all"
          >
            {open ? '▲ Ocultar' : `Ver ${plural ? `las ${total}` : 'la subtarea'} →`}
          </button>
          {open && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2 pr-1">
              {groups.map(g => (
                <div key={g.tag}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-naranja/70 mb-0.5">
                    {TAG_LABELS[g.tag].icon} {TAG_LABELS[g.tag].label} ({g.items.length})
                  </p>
                  <ul className="space-y-0.5">
                    {g.items.map(it => (
                      <li key={it.id} className="text-xs font-bold text-white/80 truncate flex items-center gap-1.5">
                        {it.status === 'completed' && <Check size={11} className="text-turquesa shrink-0" />}
                        <span className="truncate capitalize">{(it.title || 'sin título').trim()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// §16.28/§16.31 (sesiones 20-24): el modal recibe la TAREA objetivo y la LISTA de hijas del día, no solo un número.
// Para BORRAR: nombra la tarea, explica la CONSECUENCIA de cada opción, y LISTA lo que se va (banda-inventario).
// - `recurrent=true`  → dos opciones (quitar este día / terminar la rutina). Para EDITAR: igual, más suave.
// - `recurrent=false` → contenedor MANUAL: una sola acción [Eliminar] + "No se puede deshacer desde la app." (§16.31).
export function RecurrenceChoiceModal({ type, task = null, pendingChildCount = 0, items = null, recurrent = true, onClose, onConfirm }: { type: 'edit' | 'delete', task?: Task | null, pendingChildCount?: number, items?: Task[] | null, recurrent?: boolean, onClose: () => void, onConfirm: (choice: 'instance' | 'series') => void }) {
  const isDelete = type === 'delete';
  const title = (task?.title || '').trim() || 'esta tarea';
  const rawDate = task?.dueDate || task?.instanceDate || null;
  const dateLabel = rawDate
    ? parseLocalISO(rawDate).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
    : 'ese día';
  // Conjunto listado = TODAS las hijas del día (no solo pendientes). Si no llega la lista, cae al conteo antiguo.
  const kids = items || [];
  const showBand = isDelete && (kids.length > 0 || pendingChildCount > 0);
  const verbo = recurrent ? 'Quitar este día' : `Esto borra «${title}» y`;

  return (
    <div className="fixed inset-0 bg-bg-main/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-bg-card max-w-sm w-full rounded-[2.5rem] border border-border-main p-7 shadow-[0_30px_100px_rgba(0,0,0,0.6)]"
      >
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 ${isDelete ? 'bg-rosa/20 text-rosa' : 'bg-azul/20 text-azul'}`}>
          {isDelete ? <Trash2 size={28} /> : <Edit size={28} />}
        </div>
        <h3 className="text-xl font-black text-white mb-1 leading-snug">
          {isDelete ? '¿Eliminar' : '¿Editar'} «{title}»?
        </h3>
        <p className="text-sm font-bold text-text-secondary mb-5 leading-relaxed">
          {recurrent ? 'Es parte de una rutina recurrente.' : 'Es un contenedor con subtareas.'}
        </p>

        {showBand && (kids.length > 0
          ? <DeleteInventoryBand items={kids} verbo={verbo} />
          : (
            <div className="mb-5 rounded-2xl border border-naranja/40 bg-naranja/10 p-4 flex gap-3">
              <span className="text-lg leading-none shrink-0">⚠️</span>
              <p className="text-sm font-bold text-naranja leading-relaxed">
                Este día tiene {pendingChildCount} subtarea{pendingChildCount !== 1 ? 's' : ''} pendiente{pendingChildCount !== 1 ? 's' : ''} debajo. Si quitas el día, se {pendingChildCount !== 1 ? 'ocultan' : 'oculta'} con él.
              </p>
            </div>
          ))}

        {recurrent ? (
          <div className="space-y-3">
            <button
              onClick={() => onConfirm('instance')}
              className="w-full p-4 bg-bg-main hover:bg-bg-secondary rounded-2xl text-left text-white border border-border-main transition-all"
            >
              <span className="block text-sm font-black">
                {isDelete ? `Quitar solo el ${dateLabel}` : 'Solo esta tarea'}
              </span>
              <span className="block text-xs font-bold text-text-secondary mt-0.5 leading-relaxed">
                {isDelete
                  ? `La rutina sigue; solo desaparece del ${dateLabel}.`
                  : 'Los cambios afectan solo a este día.'}
              </span>
            </button>
            <button
              onClick={() => onConfirm('series')}
              className={`w-full p-4 rounded-2xl text-left text-white transition-all shadow-xl ${isDelete ? 'bg-rosa shadow-rosa/20' : 'bg-azul shadow-azul/20'}`}
            >
              <span className="block text-sm font-black">
                {isDelete ? 'Terminar la rutina' : 'Toda la serie (futuro)'}
              </span>
              <span className="block text-xs font-bold text-white/80 mt-0.5 leading-relaxed">
                {isDelete
                  ? 'Deja de repetirse de hoy en adelante. Lo ya hecho se conserva.'
                  : 'Los cambios afectan a todas las futuras.'}
              </span>
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-bold text-text-secondary leading-relaxed">No se puede deshacer desde la app.</p>
            <button
              onClick={() => onConfirm('series')}
              className="w-full p-4 rounded-2xl text-left text-white transition-all shadow-xl bg-rosa shadow-rosa/20"
            >
              <span className="block text-sm font-black">Eliminar</span>
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-white transition-all"
            >
              Cancelar
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
 
 
 

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
 

export function InstancesModal({ task, allTasksMap, timeEntries = [], onClose, onEditTask, onDelete, onRestore }: {
  task: Task;
  allTasksMap: Record<string, Task>;
  timeEntries?: any[];
  onClose: () => void;
  onEditTask: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore?: (deletedTaskId: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const today = formatLocalISO(new Date());

  // Calcular instancias: ventana futuros 60 días, pasados 180 días
  const allInstances = useMemo(() => {
    const DAYS_FUTURE = 60;
    const DAYS_PAST = 180;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DAYS_PAST);
    const startStr = formatLocalISO(startDate);

    // Generar instancias en ventana completa usando solo templates
    const templatesOnly = Object.fromEntries(
      Object.entries(allTasksMap).filter(([, t]) => !t.templateId && !t.isDeleted)
    );
    const generated = generateInstances(templatesOnly, startStr, DAYS_PAST + DAYS_FUTURE);

    // Filtrar instancias que pertenecen a este template concreto
    const myInstances = generated.filter(t => t.templateId === task.id);

    // También buscar excepciones guardadas en Supabase
    const exceptions = Object.values(allTasksMap).filter(t =>
      t.templateId === task.id && t.isException && !t.isDeleted
    );
    const deletedExceptions = Object.values(allTasksMap).filter(t =>
      t.templateId === task.id && t.isException && t.isDeleted
    );

    // Construir mapa de fechas con su estado
    const dateMap: Record<string, { date: string; instance: Task | null; exception: Task | null; deleted: Task | null }> = {};

    myInstances.forEach(inst => {
      const d = inst.dueDate || inst.instanceDate || '';
      if (!d) return;
      if (!dateMap[d]) dateMap[d] = { date: d, instance: inst, exception: null, deleted: null };
    });

    exceptions.forEach(exc => {
      const origDate = exc.instanceDate || '';
      const newDate = exc.dueDate || '';
      const key = origDate || newDate;
      if (!key) return;
      if (!dateMap[key]) dateMap[key] = { date: key, instance: null, exception: exc, deleted: null };
      else dateMap[key].exception = exc;
    });

    deletedExceptions.forEach(del => {
      const key = del.instanceDate || del.dueDate || '';
      if (!key) return;
      if (!dateMap[key]) dateMap[key] = { date: key, instance: null, exception: null, deleted: del };
      else dateMap[key].deleted = del;
    });

    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [task.id, allTasksMap]);

  const futureInstances = allInstances.filter(i => i.date >= today);
  const pastInstances = allInstances.filter(i => i.date < today);
  const displayed = showPast ? [...pastInstances].reverse() : futureInstances;

  const getStatus = (item: typeof displayed[0]) => {
    if (item.deleted) return 'deleted';
    if (item.exception) {
      if (item.exception.status === 'completed') return 'completed';
      if (item.exception.dueDate !== item.date) return 'moved';
      return 'exception';
    }
    if (item.instance?.status === 'completed') return 'completed';
    return 'pending';
  };

  const statusConfig = {
    pending:   { label: 'Pendiente', bg: 'dark:bg-turquesa/10 bg-turquesa/5', text: 'text-turquesa', border: 'dark:border-turquesa/30 border-turquesa/40' },
    exception: { label: 'Pendiente', bg: 'dark:bg-turquesa/10 bg-turquesa/5', text: 'text-turquesa', border: 'dark:border-turquesa/30 border-turquesa/40' },
    moved:     { label: 'Movida',    bg: 'dark:bg-yellow-500/10 bg-yellow-50', text: 'dark:text-yellow-400 text-yellow-700', border: 'dark:border-yellow-500/30 border-yellow-400/40' },
    completed: { label: 'Completada',bg: 'dark:bg-azul/10 bg-azul/5',          text: 'text-azul',                           border: 'dark:border-azul/30 border-azul/40' },
    deleted:   { label: 'Borrada',   bg: 'dark:bg-red-500/10 bg-red-50',       text: 'dark:text-red-400 text-red-600',      border: 'dark:border-red-500/30 border-red-400/40' },
  };

  const formatDate = (d: string) => {
    const date = parseLocalISO(d);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Tiempo estimado del template (suma de subtemplates hijos)
  const templateEstimated = useMemo(() => {
    const childIds = task.subtasks || [];
    if (childIds.length === 0) return task.estimatedMinutes || 0;
    return childIds.reduce((acc, subId) => {
      const sub = allTasksMap[subId];
      return acc + (sub?.estimatedMinutes || 0);
    }, 0);
  }, [task, allTasksMap]);

  // Tiempo registrado para una fecha concreta: suma entries de inst-{subId}-{date} y de la instancia padre
  // Los time_entries se guardan con IDs de templates (t-xxx), no de instancias.
  // Filtramos por taskId/subtaskId del template y sus hijos, y por createdAt del día.
  const getRegisteredForDate = (date: string): number => {
    if (!timeEntries || timeEntries.length === 0) return 0;
    const childIds = task.subtasks || [];
    const relevantIds = new Set<string>([task.id, ...childIds]);
    return timeEntries
      .filter(e => {
        if (!e) return false;
        const matchesId = relevantIds.has(e.taskId) || (e.subtaskId && relevantIds.has(e.subtaskId));
        if (!matchesId) return false;
        const dateStr = e.createdAt || e.created_at;
        if (!dateStr) return false;
        const entryDate = new Date(dateStr).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        return entryDate === date;
      })
      .reduce((acc, e) => acc + (e.duration || 0), 0);
  };

  const formatMins = (mins: number): string => {
    if (mins === 0) return '0m';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="dark:bg-bg-card bg-white rounded-2xl border dark:border-border-main border-border-main-light w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b dark:border-border-main border-border-main-light shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw size={12} className="text-turquesa" />
              <span className="text-[10px] font-black text-turquesa uppercase tracking-wide">
                {task.recurrence?.frequency === 'yearly' ? `Anual · ${String(task.recurrence.yearDay || '').padStart(2,'0')}-${String(task.recurrence.yearMonth || '').padStart(2,'0')}` :
                 task.recurrence?.frequency === 'monthly' ? `Mensual · día ${task.recurrence.monthDay}` :
                 task.recurrence?.frequency === 'weekly' ? 'Semanal' :
                 task.recurrence?.frequency === 'daily' ? 'Diaria' : 'Recurrente'}
              </span>
            </div>
            <p className="dark:text-text-main text-text-main-light font-semibold text-sm leading-tight">{task.title}</p>
            <p className="dark:text-text-secondary text-text-secondary-light text-[11px] mt-0.5">
              {futureInstances.length} instancias futuras · ventana 60 días
            </p>
          </div>
          <button onClick={onClose} className="dark:text-text-secondary text-text-secondary-light hover:text-red-400 transition-colors mt-0.5 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Toggle pasados/futuros */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b dark:border-border-main border-border-main-light shrink-0">
          <button
            onClick={() => setShowPast(false)}
            className={`text-[11px] font-bold px-3 py-1 rounded-full transition-colors ${!showPast ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:bg-turquesa/10 hover:bg-turquesa/5'}`}
          >
            Futuros ({futureInstances.length})
          </button>
          <button
            onClick={() => setShowPast(true)}
            className={`text-[11px] font-bold px-3 py-1 rounded-full transition-colors ${showPast ? 'bg-turquesa text-white' : 'dark:text-text-secondary text-text-secondary-light dark:hover:bg-turquesa/10 hover:bg-turquesa/5'}`}
          >
            Ver pasados ({pastInstances.length})
          </button>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <RefreshCw size={24} className="dark:text-text-secondary text-text-secondary-light opacity-30" />
              <p className="dark:text-text-secondary text-text-secondary-light text-sm">No hay instancias en esta ventana</p>
            </div>
          ) : (
            displayed.map((item, idx) => {
              const status = getStatus(item);
              const cfg = statusConfig[status];
              const activeInstance = item.exception || item.instance;
              const isDeleted = status === 'deleted';
              const movedTo = status === 'moved' && item.exception ? item.exception.dueDate : null;

              return (
                <div
                  key={item.date + idx}
                  className={`flex items-center gap-3 px-5 py-3 border-b dark:border-border-main/50 border-border-main-light/50 last:border-0 ${isDeleted ? 'opacity-50' : ''}`}
                >
                  {/* Fecha */}
                  <div className="shrink-0 w-24">
                    <p className={`text-xs font-bold ${isDeleted ? 'line-through dark:text-text-secondary text-text-secondary-light' : 'dark:text-text-main text-text-main-light'}`}>
                      {formatDate(item.date)}
                    </p>
                    {movedTo && (
                      <p className="text-[10px] dark:text-yellow-400 text-yellow-700 mt-0.5">
                        → {formatDate(movedTo)}
                      </p>
                    )}
                  </div>

                  {/* Badge estado */}
                  <div className="flex items-center gap-1 shrink-0">
                    <div className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wide ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      {cfg.label}
                    </div>
                    {status === 'exception' && (
                      <div className="w-4 h-4 flex items-center justify-center" title="Instancia modificada">
                        <Edit size={10} className="text-turquesa opacity-70" />
                      </div>
                    )}
                  </div>

                  {/* Tiempo: estimado siempre, registrado solo en pasadas */}
                  {!isDeleted && templateEstimated > 0 && (
                    <div className="flex flex-col items-end shrink-0 gap-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold dark:text-text-secondary/50 text-text-secondary-light/50 uppercase tracking-wide">est</span>
                        <span className="text-[10px] font-bold dark:text-text-secondary text-text-secondary-light">
                          {formatMins(templateEstimated)}
                        </span>
                      </div>
                      {item.date < today && (() => {
                        const registered = getRegisteredForDate(item.date);
                        if (registered === 0) return null;
                        let regColor = '#84CC16'; // lima — por debajo del estimado, eficiente
                        if (registered > templateEstimated) {
                          regColor = '#EC4899'; // rosa — pasado del estimado
                        } else if (registered >= templateEstimated * 0.9) {
                          regColor = '#F97316'; // naranja — cerca del estimado (≥90%)
                        }
                        return (
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold dark:text-text-secondary/50 text-text-secondary-light/50 uppercase tracking-wide">reg</span>
                            <span className="text-[10px] font-black" style={{ color: regColor }}>{formatMins(registered)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Acciones */}
                  {isDeleted && item.deleted && onRestore && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onRestore(item.deleted!.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border dark:border-turquesa/30 border-turquesa/40 dark:bg-turquesa/10 bg-turquesa/5 dark:hover:bg-turquesa/20 hover:bg-turquesa/10 text-turquesa transition-colors"
                        title="Restaurar esta instancia"
                      >
                        <RotateCcw size={12} />
                      </button>
                    </div>
                  )}
                  {!isDeleted && activeInstance && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => { onEditTask(activeInstance.id); onClose(); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border dark:border-border-main border-border-main-light dark:hover:bg-azul/10 hover:bg-azul/5 dark:text-text-secondary text-text-secondary-light hover:text-azul transition-colors"
                        title="Editar"
                      >
                        <Edit size={12} />
                      </button>
                      <button
                        onClick={() => { onDelete(activeInstance.id); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border dark:border-border-main border-border-main-light dark:hover:bg-red-500/10 hover:bg-red-50 dark:text-text-secondary text-text-secondary-light hover:text-red-500 transition-colors"
                        title="Borrar esta instancia"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t dark:border-border-main border-border-main-light shrink-0">
          <span className="text-[11px] dark:text-text-secondary text-text-secondary-light">
            {allInstances.filter(i => i.exception || i.deleted).length} con excepción guardada
          </span>
          <button
            onClick={onClose}
            className="text-[12px] px-4 py-1.5 rounded-lg border dark:border-border-main border-border-main-light dark:text-text-main text-text-main-light dark:hover:bg-bg-main hover:bg-gray-50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
