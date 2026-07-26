import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[SUPABASE] Missing environment variables!');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓' : '✗');
}

// DEV TEMPORAL (sesión 11, §13.11): spy de ESCRITURAS a `tasks`. supabase-js captura `fetch` en su
// init, así que envolver `window.fetch` DESPUÉS no lo intercepta — hay que darle NUESTRO fetch al crear
// el cliente. Empuja cada POST/PATCH/DELETE a /rest/v1/tasks en `window.__spy`. Sirve para distinguir
// "1 upsert" de "N al mismo id" (idempotencia B1, anti-#6 de C2). RETIRAR en D2.
const devFetch: typeof fetch = (input: any, init?: any) => {
  try {
    const u = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (u && u.includes('/rest/v1/tasks') && (method === 'POST' || method === 'PATCH' || method === 'DELETE')) {
      const w = globalThis as any;
      if (!Array.isArray(w.__spy)) w.__spy = [];
      let body: any = init && init.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* deja raw */ } }
      w.__spy.push({ method, url: u, body });
    }
  } catch { /* nunca romper la petición por el spy */ }
  return fetch(input, init);
};

export const supabase = (import.meta as any).env?.DEV
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: devFetch } })
  : createClient(supabaseUrl, supabaseAnonKey);

console.log('[SUPABASE] Client initialized');