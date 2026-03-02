/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d1a',
        sidebar: '#111127',
        card: '#1a1a32',
        border: '#2a2a4a',
        primary: '#818cf8',
        'primary-hover': '#6366f1',
        muted: '#94a3b8',
      },
    },
  },
  plugins: [],
}
