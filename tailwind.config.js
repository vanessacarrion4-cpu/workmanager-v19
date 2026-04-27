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
      },
    },
  },
  plugins: [],
}