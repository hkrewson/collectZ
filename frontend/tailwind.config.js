/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Base dark surfaces
        void:    '#080b10',
        abyss:   '#0d1117',
        deep:    '#111827',
        surface: '#161d2b',
        raised:  '#1c2538',
        edge:    '#232f47',
        muted:   '#2d3a52',

        // Text hierarchy
        ink:     '#f0f4ff',
        dim:     '#8b9ab8',
        ghost:   '#4a5a78',

        // Brand accent — amber/gold, cinematic warmth
        gold: {
          DEFAULT: '#f5a623',
          50:  '#fff8eb',
          100: '#feefc3',
          200: '#fdda82',
          300: '#fcc042',
          400: '#f5a623',
          500: '#e8890a',
          600: '#c96805',
          700: '#a14c08',
          800: '#833d0d',
          900: '#6d330f',
        },

        // Status
        ok:   '#22c55e',
        warn: '#f59e0b',
        err:  '#ef4444',
        info: '#3b82f6',
      },
      borderRadius: {
        'sm':  '6px',
        DEFAULT: '10px',
        'md':  '12px',
        'lg':  '16px',
        'xl':  '20px',
        '2xl': '28px',
      },
      boxShadow: {
        'card':  '0 4px 24px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)',
        'glow':  '0 0 24px rgba(245,166,35,0.25)',
        'raise': '0 8px 32px rgba(0,0,0,0.6)',
        'deep':  '0 20px 60px rgba(0,0,0,0.8)',
      },
      backgroundImage: {
        'grain': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\")",
        'hero-fade': 'linear-gradient(to bottom, rgba(8,11,16,0) 0%, rgba(8,11,16,0.7) 60%, rgba(8,11,16,1) 100%)',
        'card-fade': 'linear-gradient(to top, rgba(8,11,16,0.95) 0%, rgba(8,11,16,0.4) 60%, transparent 100%)',
        'sidebar-fade': 'linear-gradient(to bottom, rgba(13,17,23,0) 0%, rgba(13,17,23,1) 100%)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease forwards',
        'slide-up':   'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
        'slide-in':   'slideIn 0.3s cubic-bezier(0.4,0,0.2,1) forwards',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:   { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideIn:   { from: { opacity: 0, transform: 'translateX(-16px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        pulseGold: { '0%,100%': { boxShadow: '0 0 0 0 rgba(245,166,35,0)' }, '50%': { boxShadow: '0 0 0 6px rgba(245,166,35,0.15)' } },
      },
    },
  },
  plugins: [],
};
