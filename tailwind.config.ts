import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/pages/**/*.{ts,tsx}',
  ],
  darkMode: ['class'],
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
        // Foundry brand tokens — sourced from hifi.css :root, stored as CSS vars in globals.css
        surface: {
          DEFAULT: 'var(--surface)',
          elev: 'var(--surface-elev)',
          subtle: 'var(--surface-subtle)',
          hover: 'var(--surface-hover)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
          divider: 'var(--line-divider)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          light: 'var(--brand-2)',
          ink: 'var(--brand-ink)',
          soft: 'var(--brand-soft)',
        },
        gold: {
          DEFAULT: 'var(--gold)',
          soft: 'var(--gold-soft)',
        },
        status: {
          green: {
            DEFAULT: 'var(--status-green)',
            soft: 'var(--status-green-soft)',
          },
          amber: {
            DEFAULT: 'var(--status-amber)',
            soft: 'var(--status-amber-soft)',
          },
          red: {
            DEFAULT: 'var(--status-red)',
            soft: 'var(--status-red-soft)',
          },
          blue: {
            DEFAULT: 'var(--status-blue)',
            soft: 'var(--status-blue-soft)',
          },
        },
        // shadcn/ui conventions, mapped to Foundry palette
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(15,20,25,.04), 0 1px 3px rgba(15,20,25,.06)',
        DEFAULT: '0 2px 4px rgba(15,20,25,.04), 0 4px 12px rgba(15,20,25,.06)',
        md: '0 2px 4px rgba(15,20,25,.04), 0 4px 12px rgba(15,20,25,.06)',
        lg: '0 6px 24px rgba(15,20,25,.08), 0 2px 6px rgba(15,20,25,.04)',
      },
      fontFamily: {
        sans: [
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
