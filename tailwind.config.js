/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#3b6cff',
          600: '#2d55e0',
          700: '#2444b8',
        },
      },
    },
  },
  plugins: [],
};
