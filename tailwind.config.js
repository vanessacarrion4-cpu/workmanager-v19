/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark mode colors
        'bg-main': '#0B1120',
        'bg-secondary': '#0F172A',
        'bg-card': '#1E293B',
        'text-main': '#F8FAFC',
        'text-secondary': '#94A3B8',
        'border-main': '#334155',
        // Light mode colors
        'bg-main-light': '#F8FAFC',
        'bg-secondary-light': '#F1F5F9',
        'bg-card-light': '#FFFFFF',
        'text-main-light': '#0F172A',
        'text-secondary-light': '#64748B',
        'border-main-light': '#E2E8F0',
        // Accent colors
        // Para volver al turquesa original: cambiar #0D9E90 → #06B6D4
        'turquesa': '#14B8A6',   // color oficial logo WorkManager
        'esmeralda': '#14B8A6',  // alias
        'azul': '#3B82F6',
        'morado': '#8B5CF6',
        'rosa': '#EC4899',
        'verde': '#10B981',
        'lima': '#84CC16',
        'naranja': '#F97316',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
