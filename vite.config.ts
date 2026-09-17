import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react()],
    // §16.132: aquí se inyectaba GEMINI_API_KEY en el bundle (herencia de la plantilla de AI Studio). No se
    // usa en ninguna parte y era un cepo: cualquier clave definida en esa variable habría acabado publicada en
    // el JavaScript que sirve el navegador. Fuera.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});