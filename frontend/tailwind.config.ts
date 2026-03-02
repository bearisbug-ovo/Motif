import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--accordion-content-height)' },
          to: { height: '0' },
        },
        'star-pop': {
          '0%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(1.4)' },
          '60%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
        'star-pulse': {
          '0%': { filter: 'drop-shadow(0 0 2px rgba(212,168,75,0.2))' },
          '40%': { filter: 'drop-shadow(0 0 2px rgba(212,168,75,0.2))' },
          '60%': { filter: 'drop-shadow(0 0 7px rgba(212,168,75,0.8)) brightness(1.12)' },
          '80%': { filter: 'drop-shadow(0 0 2px rgba(212,168,75,0.2))' },
          '100%': { filter: 'drop-shadow(0 0 2px rgba(212,168,75,0.2))' },
        },
        'star-shimmer': {
          '0%': { filter: 'drop-shadow(0 0 2px rgba(232,160,192,0.3)) hue-rotate(0deg)' },
          '30%': { filter: 'drop-shadow(0 0 2px rgba(232,160,192,0.3)) hue-rotate(0deg)' },
          '50%': { filter: 'drop-shadow(0 0 6px rgba(168,184,232,0.8)) hue-rotate(40deg) brightness(1.15)' },
          '70%': { filter: 'drop-shadow(0 0 6px rgba(224,192,128,0.8)) hue-rotate(-20deg) brightness(1.12)' },
          '85%': { filter: 'drop-shadow(0 0 2px rgba(232,160,192,0.3)) hue-rotate(0deg)' },
          '100%': { filter: 'drop-shadow(0 0 2px rgba(232,160,192,0.3)) hue-rotate(0deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'star-pop': 'star-pop 0.35s ease-out',
        'star-pulse': 'star-pulse 4.5s ease-in-out infinite',
        'star-shimmer': 'star-shimmer 6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
