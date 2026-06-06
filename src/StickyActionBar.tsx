/**
 * StickyActionBar.tsx
 *
 * Barra de acciones sticky compartida entre todas las vistas.
 * En estado normal muestra botones de vista (ocultar, expandir, seleccionar, añadir).
 * En estado selección muestra acciones masivas (delegar, fecha, completar, etc.).
 *
 * Se coloca justo debajo del header de cada vista, con sticky top-0 z-20.
 */

import React from 'react';
import {
  Plus, Eye, EyeOff, ChevronsUp, ChevronsDown,
  CheckSquare, Users, Calendar, Clock, Copy, Trash2, X, Check
} from 'lucide-react';

interface StickyActionBarProps {
  // Estado selección
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;

  // Acciones vista normal (opcionales según vista)
  onAddTask?: () => void;
  hideCompleted?: boolean;
  onToggleHideCompleted?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;

  // Acciones masivas
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

  if (selectionMode && selectedCount > 0) {
    // Estado selección activa — mostrar acciones masivas
    return (
      <div className="sticky top-0 z-20 dark:bg-bg-secondary/95 bg-bg-secondary-light/95 backdrop-blur-md border-b dark:border-border-main border-border-main-light">
        <div className="flex items-center gap-2 px-4 py-2.5">
          {/* Contador */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-azul/20 border border-azul/40 shrink-0">
            <Check size={12} className="text-azul" />
            <span className="text-[11px] font-black text-azul uppercase tracking-widest">{selectedCount}</span>
          </div>

          <div className="w-px h-5 dark:bg-border-main bg-border-main-light shrink-0" />

          {/* Acciones masivas */}
          <div className="flex items-center gap-1 flex-1 flex-wrap">
            {onDelegate && (
              <button
                onClick={onDelegate}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-morado/40 border-morado/30 dark:bg-morado/10 bg-morado/5 text-morado hover:dark:bg-morado/20 hover:bg-morado/10 transition-all text-[11px] font-bold"
              >
                <Users size={13} />
                <span className="hidden sm:inline">Delegar</span>
              </button>
            )}
            {onChangeDate && (
              <button
                onClick={onChangeDate}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-turquesa/40 border-turquesa/30 dark:bg-turquesa/10 bg-turquesa/5 text-turquesa hover:dark:bg-turquesa/20 hover:bg-turquesa/10 transition-all text-[11px] font-bold"
              >
                <Calendar size={13} />
                <span className="hidden sm:inline">Fecha</span>
              </button>
            )}
            {onComplete && (
              <button
                onClick={onComplete}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-azul/40 border-azul/30 dark:bg-azul/10 bg-azul/5 text-azul hover:dark:bg-azul/20 hover:bg-azul/10 transition-all text-[11px] font-bold"
              >
                <Check size={13} />
                <span className="hidden sm:inline">Completar</span>
              </button>
            )}
            {onChangeTime && (
              <button
                onClick={onChangeTime}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-border-main border-border-main-light dark:bg-transparent bg-transparent dark:text-text-secondary text-text-secondary-light hover:dark:bg-bg-card hover:bg-gray-100 transition-all text-[11px] font-bold"
              >
                <Clock size={13} />
                <span className="hidden sm:inline">Tiempo</span>
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={onDuplicate}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-border-main border-border-main-light dark:bg-transparent bg-transparent dark:text-text-secondary text-text-secondary-light hover:dark:bg-bg-card hover:bg-gray-100 transition-all text-[11px] font-bold"
              >
                <Copy size={13} />
                <span className="hidden sm:inline">Duplicar</span>
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl border dark:border-rosa/40 border-rosa/30 dark:bg-rosa/10 bg-rosa/5 text-rosa hover:dark:bg-rosa/20 hover:bg-rosa/10 transition-all text-[11px] font-bold"
              >
                <Trash2 size={13} />
                <span className="hidden sm:inline">Eliminar</span>
              </button>
            )}
          </div>

          {/* Cancelar */}
          <button
            onClick={onToggleSelectionMode}
            className="w-8 h-8 flex items-center justify-center rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:text-rosa hover:border-rosa/50 transition-all shrink-0"
            title="Cancelar selección"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Estado normal — botones de vista
  return (
    <div className="sticky top-0 z-20 dark:bg-bg-secondary/95 bg-bg-secondary-light/95 backdrop-blur-md border-b dark:border-border-main border-border-main-light">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1">
          {/* Seleccionar */}
          <button
            onClick={onToggleSelectionMode}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-xl border transition-all text-[11px] font-bold ${
              selectionMode
                ? 'bg-azul text-white border-azul'
                : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5'
            }`}
            title="Selección múltiple"
          >
            <CheckSquare size={13} />
            <span className="hidden sm:inline">Seleccionar</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Ocultar completadas */}
          {onToggleHideCompleted && (
            <button
              onClick={onToggleHideCompleted}
              className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all ${
                hideCompleted
                  ? 'bg-turquesa text-white border-turquesa'
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-turquesa hover:text-turquesa dark:hover:bg-turquesa/10 hover:bg-turquesa/5'
              }`}
              title={hideCompleted ? 'Ver completadas' : 'Ocultar completadas'}
            >
              {hideCompleted ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}

          {/* Expandir/Contraer */}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all ${
                expanded
                  ? 'bg-azul text-white border-azul'
                  : 'dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light hover:border-azul hover:text-azul dark:hover:bg-azul/10 hover:bg-azul/5'
              }`}
              title={expanded ? 'Contraer todo' : 'Expandir todo'}
            >
              {expanded ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
            </button>
          )}

          {/* Añadir tarea */}
          {onAddTask && (
            <button
              onClick={onAddTask}
              className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-turquesa text-white border border-turquesa hover:bg-turquesa/90 transition-all text-[11px] font-bold shadow-sm shadow-turquesa/20"
              title="Añadir tarea"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Tarea</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
