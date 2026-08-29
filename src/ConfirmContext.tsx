// ConfirmContext.tsx — diálogo de confirmación PROPIO (§16 FASE 6: avisos propios en vez de los del navegador).
// Reemplaza a window.confirm(): useConfirm() devuelve una función `confirm(msg|opts) => Promise<boolean>`.
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type ConfirmOpts = { title?: string; message: string; confirmText?: string; danger?: boolean };
const Ctx = createContext<(opts: ConfirmOpts | string) => Promise<boolean>>(async () => true);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    setState(o);
    return new Promise<boolean>(res => { resolver.current = res; });
  }, []);

  const close = (v: boolean) => { setState(null); resolver.current?.(v); resolver.current = null; };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => close(false)} />
          <div className="relative dark:bg-bg-card bg-white rounded-3xl p-6 shadow-2xl border dark:border-border-main border-border-main-light w-full max-w-sm z-10">
            {state.title && <h3 className="text-base font-black dark:text-white text-text-main-light mb-2">{state.title}</h3>}
            <p className="text-[13px] dark:text-text-secondary text-text-secondary-light">{state.message}</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => close(false)} className="px-4 py-2 text-[12px] font-bold text-text-secondary hover:text-text-main-light dark:hover:text-white transition-colors">Cancelar</button>
              <button
                onClick={() => close(true)}
                className={`px-4 py-2 rounded-xl text-white text-[12px] font-black uppercase tracking-wider transition-colors ${state.danger ? 'bg-rosa hover:bg-rosa/90' : 'bg-turquesa hover:bg-turquesa/90'}`}
              >{state.confirmText || 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
