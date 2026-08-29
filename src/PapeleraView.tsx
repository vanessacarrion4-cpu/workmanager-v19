// PapeleraView.tsx — PAPELERA (§16.47). Pantalla propia con lo borrado de los últimos 30 días. Al restaurar, la propietaria
// ELIGE el destino (día original / hoy / calendario). Una subtarea cuyo contenedor ya no existe se restaura como tarea
// suelta, con aviso. No hay "vaciar" (soft-delete + escondido es suficiente; borrado duro solo añadiría riesgo).
import React, { useState } from 'react';
import { Trash2, RotateCcw, X, CalendarDays } from 'lucide-react';
import { DeletedTask } from './useDeletedTasks';
import { MonthDatePicker } from './TimeComponents';
import { formatLocalISO, parseLocalISO } from './dateUtils';

const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaCorta(iso: string | null): string {
  if (!iso) return 'sin fecha';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${WD[dt.getDay()]} ${d}`;
}

export function PapeleraView({ deleted, loading, blocks, isContainerAlive, onRestore }: {
  deleted: DeletedTask[];
  loading: boolean;
  blocks: any[];
  isContainerAlive: (parentId: string) => boolean;
  onRestore: (task: DeletedTask, destino: string) => Promise<void>;
}) {
  const [restoreFor, setRestoreFor] = useState<DeletedTask | null>(null);
  const [otherDate, setOtherDate] = useState<string | null>(null);
  const blockName = (id: string) => blocks.find((b: any) => b.id === id)?.name || '';
  const blockColor = (id: string) => blocks.find((b: any) => b.id === id)?.color || '#888';
  const today = formatLocalISO(new Date());
  const orphan = (t: DeletedTask) => !!t.parentTaskId && !isContainerAlive(t.parentTaskId);

  const doRestore = async (destino: string) => {
    if (!restoreFor) return;
    await onRestore(restoreFor, destino);
    setRestoreFor(null); setOtherDate(null);
  };

  return (
    <div className="space-y-5 pb-32">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl dark:bg-bg-card bg-bg-card-light border dark:border-border-main border-border-main-light flex items-center justify-center text-text-secondary">
          <Trash2 size={20} />
        </div>
        <div>
          <h2 className="text-2xl font-black dark:text-white text-text-main-light">Papelera</h2>
          <p className="text-[12px] dark:text-text-secondary text-text-secondary-light">Lo borrado en los últimos 30 días. Restaura lo que quieras.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm dark:text-text-secondary text-text-secondary-light">Cargando…</p>
      ) : deleted.length === 0 ? (
        <div className="text-center py-16 dark:text-text-secondary text-text-secondary-light">
          <Trash2 size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">La papelera está vacía</p>
          <p className="text-[12px] opacity-70 mt-1">Aquí aparece lo que borres a partir de ahora.</p>
        </div>
      ) : (
        <div className="dark:bg-bg-card bg-white border dark:border-border-main border-border-main-light rounded-[2rem] shadow-xl divide-y dark:divide-border-main divide-border-main-light overflow-hidden">
          {deleted.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: blockColor(t.blockId) }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold dark:text-white text-text-main-light truncate">{t.title || '(sin título)'}</p>
                <p className="text-[10px] dark:text-text-secondary text-text-secondary-light">
                  {blockName(t.blockId)}
                  {t.deletedAt && <> · borrado {fechaCorta(t.deletedAt.slice(0, 10))}</>}
                  {orphan(t) && <span className="text-naranja"> · sin contenedor</span>}
                </p>
              </div>
              <button
                onClick={() => { setRestoreFor(t); setOtherDate(null); }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider text-turquesa hover:bg-turquesa/10 transition-colors"
              >
                <RotateCcw size={13} /> Restaurar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Selector de destino al restaurar */}
      {restoreFor && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setRestoreFor(null); setOtherDate(null); }} />
          <div className="relative dark:bg-bg-card bg-white rounded-3xl p-6 shadow-2xl border dark:border-border-main border-border-main-light w-full max-w-sm z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-black uppercase tracking-widest dark:text-white text-text-main-light">Restaurar «{(restoreFor.title || 'sin título').slice(0, 24)}»</h3>
              <button onClick={() => { setRestoreFor(null); setOtherDate(null); }} className="text-text-secondary hover:text-rosa"><X size={16} /></button>
            </div>
            {orphan(restoreFor) && (
              <p className="text-[11px] font-bold text-naranja mb-3">Su contenedor ya no existe; se restaura como tarea suelta.</p>
            )}
            <p className="text-[11px] dark:text-text-secondary text-text-secondary-light mb-2">¿A qué día?</p>
            <div className="space-y-2">
              {restoreFor.dueDate || restoreFor.instanceDate ? (
                <button onClick={() => doRestore('original')} className="w-full py-2.5 rounded-xl bg-turquesa text-white font-black text-[12px] uppercase tracking-wider hover:bg-turquesa/90">
                  Su día original ({fechaCorta(restoreFor.dueDate || restoreFor.instanceDate)})
                </button>
              ) : null}
              <button onClick={() => doRestore(today)} className="w-full py-2.5 rounded-xl dark:bg-bg-main bg-gray-100 dark:text-white text-text-main-light font-black text-[12px] uppercase tracking-wider hover:opacity-80">
                Hoy
              </button>
              {!otherDate ? (
                <button onClick={() => setOtherDate(restoreFor.dueDate || today)} className="w-full py-2.5 rounded-xl border dark:border-border-main border-border-main-light dark:text-text-secondary text-text-secondary-light font-black text-[12px] uppercase tracking-wider hover:border-turquesa hover:text-turquesa flex items-center justify-center gap-1.5">
                  <CalendarDays size={13} /> Otra fecha
                </button>
              ) : (
                <div className="pt-1">
                  <MonthDatePicker value={otherDate} onChange={setOtherDate} />
                  <button onClick={() => otherDate && doRestore(otherDate)} className="mt-3 w-full py-2.5 rounded-xl bg-turquesa text-white font-black text-[12px] uppercase tracking-wider hover:bg-turquesa/90">
                    Restaurar el {fechaCorta(otherDate)}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
