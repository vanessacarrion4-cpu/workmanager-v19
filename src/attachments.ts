import { supabase } from './supabaseClient';

/**
 * attachments.ts — §16.133 · URLS FIRMADAS para los adjuntos.
 *
 * El cubo `task-attachments` era PÚBLICO: cualquiera con la URL abría el fichero sin identificarse
 * (comprobado: una petición sin ninguna clave devolvía el archivo). Ahí hay documentación de RRHH,
 * nóminas y contratos. La app guardaba en la tarea la URL pública permanente (`getPublicUrl`), así
 * que bastaba con que esa URL se filtrara una vez.
 *
 * Ahora cada apertura pide una URL FIRMADA que caduca (1 hora). Funciona igual con el cubo público
 * y con el cubo privado — por eso el código va PRIMERO y el interruptor del panel DESPUÉS: no hay
 * ningún momento en el que los adjuntos dejen de abrirse.
 *
 * Los adjuntos antiguos que no guardaran `path` caerían a su `url` de siempre; hoy no hay ninguno
 * así (8 de 8 tienen `path`).
 */
const BUCKET = 'task-attachments';
const VIGENCIA_S = 3600;
const cache: Record<string, { url: string; caduca: number }> = {};

export async function getAttachmentUrl(att: { path?: string; url?: string } | null | undefined): Promise<string> {
  if (!att) return '';
  if (!att.path) return att.url || ''; // adjunto anterior a que se guardara el path
  const guardada = cache[att.path];
  if (guardada && guardada.caduca > Date.now() + 60_000) return guardada.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.path, VIGENCIA_S);
  if (error || !data?.signedUrl) {
    console.error('[ADJUNTOS] No se pudo firmar la URL:', error);
    return att.url || '';
  }
  cache[att.path] = { url: data.signedUrl, caduca: Date.now() + VIGENCIA_S * 1000 };
  return data.signedUrl;
}
