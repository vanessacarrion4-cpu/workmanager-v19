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
        // Accent colors — nivel 500, afinados para modo OSCURO
        // Para volver al turquesa original: cambiar #0D9E90 → #06B6D4
        'turquesa': '#14B8A6',   // color oficial logo WorkManager
        'esmeralda': '#14B8A6',  // alias
        'azul': '#3B82F6',
        'morado': '#8B5CF6',
        'rosa': '#EC4899',
        'verde': '#10B981',
        'lima': '#84CC16',
        'naranja': '#F97316',
        // Variantes DENSAS (600/700) para modo CLARO: los 500 no se leen a 11px sin
        // fondo sobre blanco. Se ven como el mismo color, solo más denso. (§7.11.3)
        'turquesa-light': '#0F766E',
        'azul-light': '#2563EB',
        'rosa-light': '#BE185D',
        'naranja-light': '#C2410E',
        // Registrado (morado pleno §7.3) — par claro/oscuro propio de la fila
        'registrado': '#A855F7',
        'registrado-light': '#9333EA',
        // Punto de tipo (§7.4/§7.11.2): Puesto=esmeralda, Puntual=ámbar
        'core': '#10B981',   'core-light': '#047857',
        'adhoc': '#F59E0B',  'adhoc-light': '#B45309',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
