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
        // Accent colors (same for both modes)
        'turquesa': '#06B6D4',
        'azul': '#3B82F6',
        'morado': '#8B5CF6',
        'rosa': '#EC4899',
      },
    },
  },
  plugins: [],
}