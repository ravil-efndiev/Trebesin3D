import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { ProxyOptions, UserConfig } from 'vite';
import type { ClientRequest, IncomingMessage } from 'node:http';

const isLocalRequest = (request: IncomingMessage, websocket: boolean) => {
  const { host, origin, upgrade } = request.headers;
  if (!host || !/^(localhost|127\.0\.0\.1):[0-9]{1,5}$/.test(host) || request.method !== 'GET') return false;
  if (websocket) return upgrade?.toLowerCase() === 'websocket' && origin === `http://${host}`;

  const site = request.headers['sec-fetch-site'];
  return upgrade === undefined && (origin === undefined || origin === `http://${host}`)
    && (site === undefined || site === 'same-origin' || site === 'none');
};

const upstreamHeaders = new Set([
  'host', 'origin', 'accept', 'connection', 'upgrade', 'sec-websocket-key',
  'sec-websocket-version', 'sec-websocket-extensions',
]);

const cvProxy = (websocket: boolean, apiKey: string): ProxyOptions => ({
  target: 'http://127.0.0.1:8000',
  ws: websocket,
  rewriteWsOrigin: false,
  bypass: (request, response) => {
    const allowed = response === undefined ? websocket : !websocket;
    if (!apiKey || !allowed || !isLocalRequest(request, websocket)) return false;

    const headers = request.headers;
    if (headers['transfer-encoding'] || (headers['content-length'] && headers['content-length'] !== '0')) return false;
    for (const name of Object.keys(headers)) {
      if (!upstreamHeaders.has(name)) delete headers[name];
    }
  },
  configure: (proxy) => {
    const attachKey = (request: ClientRequest) => request.setHeader('x-api-key', apiKey);
    proxy.on(websocket ? 'proxyReqWs' : 'proxyReq', attachKey);
  },
});

const viteConfig = defineConfig(({ command, isPreview }): UserConfig => ({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: command === 'serve' && !isPreview ? {
      '^/api/health/$': cvProxy(false, process.env.CV_SERVICE_API_KEY ?? ''),
      '^/api/v1/stream$': cvProxy(true, process.env.CV_SERVICE_API_KEY ?? ''),
    } : {},
  },
}));

export default viteConfig;
