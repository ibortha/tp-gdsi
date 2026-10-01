import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Demo estática (`vite build --mode demo`): el dominio del servidor se empaqueta en el cliente.
 * Su único módulo con dependencias de Node (security.ts) se reemplaza por uno para el navegador.
 */
function browserSecurity(): Plugin {
  const shim = fileURLToPath(new URL('./client/src/demo/security.ts', import.meta.url));
  return {
    name: 'demo-browser-security',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && /[\\/]server[\\/]/.test(importer) && /(^|\/)security\.ts$/.test(source)) return shim;
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'client',
    base: demo ? './' : '/',
    plugins: [react(), ...(demo ? [browserSecurity()] : [])],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': api,
        '/socket.io': { target: api, ws: true },
      },
    },
    preview: { host: true, port: 4173 },
    build: {
      outDir: demo ? '../dist/demo' : '../dist/client',
      emptyOutDir: true,
      chunkSizeWarningLimit: 900,
    },
  };
});
