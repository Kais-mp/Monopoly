import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const shared = fileURLToPath(new URL('../backend/src/shared', import.meta.url));

/** Dev-time proxy target for the game server. */
const devServer = process.env.DEV_SERVER_URL ?? 'http://localhost:8080';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@shared': shared },
  },
  server: {
    port: 5173,
    // The shared protocol types live outside the client root.
    fs: { allow: ['..'] },
    // Dev only: the client talks to the game server on 8080.
    proxy: {
      '/socket.io': { target: devServer, ws: true, changeOrigin: true },
      '/api': { target: devServer, changeOrigin: true },
      '/healthz': { target: devServer, changeOrigin: true },
    },
  },
  build: {
    // Two supported layouts:
    //  - default (`vite build`): `dist/`, uploaded to a static host such as Vercel.
    //  - `vite build --mode bundled`: written into the backend so a single Azure
    //    App Service serves both the client and the socket server.
    outDir: mode === 'bundled' ? '../backend/public' : 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep three in its own long-cached chunk; it dwarfs the app code.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
}));
