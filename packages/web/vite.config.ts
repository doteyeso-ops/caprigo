import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite's http-proxy can drop or mishandle request bodies for PATCH/POST unless
 * Content-Type / Content-Length are forwarded explicitly (see vitejs/vite#17755).
 */
function forwardBodyHeadersForProxy(proxy: { on: (event: string, fn: (...args: unknown[]) => void) => void }) {
  proxy.on('proxyReq', (proxyReq, req) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const ct = req.headers['content-type'];
    if (ct) {
      proxyReq.setHeader('Content-Type', Array.isArray(ct) ? ct[0] : ct);
    }
    const cl = req.headers['content-length'];
    if (cl != null) {
      proxyReq.setHeader('Content-Length', Array.isArray(cl) ? cl[0] : cl);
    }
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:18789',
        changeOrigin: true,
        configure: forwardBodyHeadersForProxy,
      },
      '/health': {
        target: 'http://localhost:18789',
        changeOrigin: true,
        configure: forwardBodyHeadersForProxy,
      },
    },
  },
});
