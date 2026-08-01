// ─────────────────────────────────────────────────────────────────────────────
// Avisos (B1): helper de persistencia. Envuelve una escritura de Supabase para que,
// si falla, NO se quede muda: log a consola (para depurar) + aviso visible (toast).
//
// NO cambia el comportamiento optimista de la UI: el cambio ya se pintó en pantalla.
//
// ⚠️ PROVISIONAL: el mensaje reconoce que "el cambio se ve pero puede no haberse
// guardado". El B2 de la FASE 3 revertirá el estado local cuando la escritura falle,
// y entonces habrá que REESCRIBIR este mensaje (ya no se verá el cambio).
// ─────────────────────────────────────────────────────────────────────────────
import { toast } from './toast';

const DETALLE_PROVISIONAL =
  'El cambio se ve en pantalla, pero puede no haberse guardado. Recarga para comprobar.'; // ← PROVISIONAL (B2/FASE 3)

export interface PersistCtx {
  verbo: string;     // acción en infinitivo: "guardar", "crear", "borrar", "restaurar"...
  titulo?: string;   // nombre del elemento afectado, si se conoce
  singular?: string; // "la tarea" (por defecto)
  plural?: string;   // "tareas" (por defecto) — para el aviso agrupado por contador
  key?: string;      // clave de agrupación; por defecto `persist:${verbo}:${plural}`
}

// Dispara el aviso de error (agrupable). Úsalo suelto en los catch de escrituras await.
export function reportPersistError(ctx: PersistCtx) {
  const singular = ctx.singular ?? 'la tarea';
  const plural = ctx.plural ?? 'tareas';
  const label = ctx.titulo ? `«${ctx.titulo}»` : singular;
  const key = ctx.key ?? `persist:${ctx.verbo}:${plural}`;
  // Agrupa por `key`: si en una acción en lote fallan 20 filas, un solo aviso "×20".
  toast.error(
    (n: number) => (n === 1
      ? `No se pudo ${ctx.verbo} ${label}.`
      : `No se pudieron ${ctx.verbo} ${n} ${plural}.`),
    { key, detail: DETALLE_PROVISIONAL },
  );
}

// Envuelve una escritura fire-and-forget (el query builder de Supabase es un thenable
// que resuelve a `{ error }`). Sustituye a `.then(({error}) => console.error(...))`.
export function persist(query: PromiseLike<{ error: any }>, ctx: PersistCtx): void {
  Promise.resolve(query).then(
    ({ error }) => { if (error) { console.error('[PERSIST]', ctx.verbo, ctx.titulo ?? '', error); reportPersistError(ctx); } },
    (err) => { console.error('[PERSIST]', ctx.verbo, ctx.titulo ?? '', err); reportPersistError(ctx); },
  );
}
