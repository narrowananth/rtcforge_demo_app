import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Backend runs on :3003. HTTP (/api, /healthz) is proxied; signaling WS connects
// directly (VITE_WS_URL) to avoid clashing with Vite's HMR socket.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@rtc-shared/client': fileURLToPath(
                new URL('../../../packages/rtc-shared/client/index.ts', import.meta.url),
            ),
        },
    },
    server: {
        port: 5175,
        proxy: {
            '/api': 'http://localhost:3003',
            '/healthz': 'http://localhost:3003',
        },
    },
    build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            output: {
                manualChunks: { react: ['react', 'react-dom'], rtc: ['rtcforge/client'] },
            },
        },
    },
})
