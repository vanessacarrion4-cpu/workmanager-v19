/**
 * StickyActionBar.tsx
 *
 * Barra de acciones sticky compartida entre todas las vistas.
 * 3 zonas en estado normal: [Seleccionar] | [Vista: ocultar, expandir] | [+ Tarea]
 * En modo selección: toda la barra se transforma en acciones masivas.
 */

import React from 'react';
import {
  Plus, Eye, EyeOff, CheckSquare, Square,
  Users, Calendar, Clock, Copy, Trash2, X, Check,
  ListCollapse, ListTree
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface StickyActionBarProps {
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;
  onAddTask?: () => void;
  hideCompleted?: boolean;
  onToggleHideCompleted?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onDelegate?: () => void;
  onChangeDate?: () => void;
  onComplete?: () => void;
  onChangeTime?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export function StickyActionBar({
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onAddTask,
  hideCompleted,
  onToggleHideCompleted,
  expanded,
  onToggleExpand,
  onDelegate,
  onChangeDate,
  onComplete,
  onChangeTime,
  onDuplicate,
  onDelete,
}: StickyActionBarProps) {

  const isSelectionActive = selectionMode && selectedCount > 0;

  return (
    <div className="sticky top-0 z-20 dark:bg-bg-secondary/95 bg-bg-secondary-light/95 backdrop-blur-md border-b dark:border-border-main border-border-main-light">
      <AnimatePresence mode="wait">
        {isSelectionActive ? (
          // --- MODO SELECCIÓN ACTIVA ---
          <motion.div
            key="selection"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 px-3 py-2"
          >
            {/* Contador */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-azul text-white shrink-0">
              <Check size={11} strokeWidth={3} />
              <span className="text-[11px] font-black tabular-nums">{selectedCount}</span>
            </div>

            <div className="w-px h-4 dark:bg-border-main bg-border-main-light shrink-0" />

            {/* Acciones masivas */}
            <div className="flex items-center gap-1 flex-1 flex-wrap">
              {onDelegate && (
                <ActionBtn onClick={onDelegate} color="morado" icon={<Users size={13} />} label="Delegar" />
              )}
              {onChangeDate && (
                <ActionBtn onClick={onChangeDate} color="turquesa" icon={<Calendar size={13} />} label="Fecha" />
              )}
              {onComplete && (
                <ActionBtn onClick={onComplete} color="verde" icon={<Check size={13} />} label="Completar" />
              )}
              {onChangeTime && (
                <ActionBtn onClick={onChangeTime} color="neutral" icon={<Clock size={13} />} label="Tiempo" />
              )}
              {onDuplicate && (
                <ActionBtn onClick={onDuplicate} color="neutral" icon={<Copy size={13} />} label="Duplicar" />
              )}
              {onDelete && (
                <ActionBtn onClick={onDelete} color="rosa" icon={<Trash2 size={13} />} label="Eliminar" />
              )}
            </div>

            {/* Cancelar */}
            <button
              onClick={onToggleSelectionMode}
              className="w-7 h-7 flex items-center justify-center rounded-lg dark:text-text-secondary text-text-secondary-light hover:text-rosa hover:dark:bg-rosa/10 hover:bg-rosa/10 transition-all shrink-0"
              title="Cancelar selección"
            >
              <X size={14} />
            </button>
          </motion.div>
        ) : (
          // --- MODO NORMAL ---
          <motion.div
            key="normal"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 px-3 py-2"
          >
            {/* Zona izquierda: Seleccionar */}
            <button
              onClick={onToggleSelectionMode}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5 transition-all text-[11px] font-bold shrink-0"
              title="Selección múltiple"
            >
              <CheckSquare size={13} />
              <span className="hidden sm:inline">Seleccionar</span>
            </button>

            <div className="w-px h-4 dark:bg-border-main bg-border-main-light mx-1 shrink-0" />

            {/* Zona centro: filtros de vista */}
            <div className="flex items-center gap-1 flex-1">
              {onToggleHideCompleted && (
                <ViewBtn
                  onClick={onToggleHideCompleted}
                  active={!!hideCompleted}
                  activeColor="turquesa"
                  icon={hideCompleted ? <EyeOff size={13} /> : <Eye size={13} />}
                  label={hideCompleted ? 'Ocultar completadas' : 'Ver completadas'}
                />
              )}
              {onToggleExpand && (
                <ViewBtn
                  onClick={onToggleExpand}
                  active={!!expanded}
                  activeColor="azul"
                  icon={expanded ? <ListCollapse size={13} /> : <ListTree size={13} />}
                  label={expanded ? 'Contraer todo' : 'Expandir todo'}
                />
              )}
            </div>

            <div className="w-px h-4 dark:bg-border-main bg-border-main-light mx-1 shrink-0" />

            {/* Zona derecha: añadir tarea */}
            {onAddTask && (
              <button
                onClick={onAddTask}
                className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-turquesa text-white hover:bg-turquesa/85 transition-all text-[11px] font-bold shadow-sm shadow-turquesa/20 shrink-0"
                title="Añadir tarea"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Tarea</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-componentes internos ---

function ActionBtn({ onClick, color, icon, label }: {
  onClick: () => void;
  color: 'morado' | 'turquesa' | 'verde' | 'rosa' | 'neutral';
  icon: React.ReactNode;
  label: string;
}) {
  const styles: Record<string, string> = {
    morado: 'border-morado/40 dark:bg-morado/10 bg-morado/5 text-morado hover:dark:bg-morado/20 hover:bg-morado/10',
    turquesa: 'border-turquesa/40 dark:bg-turquesa/10 bg-turquesa/5 text-turquesa hover:dark:bg-turquesa/20 hover:bg-turquesa/10',
    verde: 'dark:border-green-500/40 border-green-500/30 dark:bg-green-500/10 bg-green-500/5 text-green-500 hover:dark:bg-green-500/20 hover:bg-green-500/10',
    rosa: 'border-rosa/40 dark:bg-rosa/10 bg-rosa/5 text-rosa hover:dark:bg-rosa/20 hover:bg-rosa/10',
    neutral: 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:dark:bg-bg-card hover:bg-gray-100 dark:hover:text-white hover:text-text-main-light',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg border transition-all text-[11px] font-bold ${styles[color]}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ViewBtn({ onClick, active, activeColor, icon, label }: {
  onClick: () => void;
  active: boolean;
  activeColor: 'turquesa' | 'azul';
  icon: React.ReactNode;
  label: string;
}) {
  const activeStyles: Record<string, string> = {
    turquesa: 'bg-turquesa text-white border-turquesa',
    azul: 'bg-azul text-white border-azul',
  };
  return (
    <button
      onClick={onClick}
      title={label}
      className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-all ${
        active
          ? activeStyles[activeColor]
          : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-current hover:dark:text-white hover:text-text-main-light dark:hover:bg-bg-card hover:bg-gray-100'
      }`}
    >
      {icon}
    </button>
  );
}
