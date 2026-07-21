import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En build (GitHub Pages) la app se sirve bajo /frombuilder/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/frombuilder/' : '/',
  plugins: [react()],
}));
