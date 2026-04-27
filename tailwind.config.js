/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-main': '#0B1120',
        'bg-secondary': '#0F172A',
        'bg-card': '#1E293B',
        'text-main': '#F8FAFC',
        'text-secondary': '#94A3B8',
        'border-main': '#334155',
        'turquesa': '#06B6D4',
        'azul': '#3B82F6',
        'morado': '#8B5CF6',
        'rosa': '#EC4899',
      },
    },
  },
  plugins: [],
}