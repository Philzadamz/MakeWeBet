import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch: {
          50: '#f0fdf5',
          500: '#16a34a',
          600: '#15803d',
          900: '#14532d',
        },
      },
    },
  },
  plugins: [],
};

export default config;
