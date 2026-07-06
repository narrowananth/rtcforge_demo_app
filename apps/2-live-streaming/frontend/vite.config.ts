import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Backend runs on :3002. HTTP (/api, /healthz) is proxied so the app is
// same-origin in dev; the signaling WebSocket connects directly (VITE_WS_URL).
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Shared rtcforge browser helpers (SfuClient, iceForRoom), consumed as
            // source — same alias every app uses. Mirrored in tsconfig.app.json.
            '@rtc-shared/client': fileURLToPath(
                new URL('../../../packages/rtc-shared/client/index.ts', import.meta.url),
            ),
        },
    },
    server: {
        port: 5174,
        proxy: {
            '/api': 'http://localhost:3002',
            '/healthz': 'http://localhost:3002',
        },
    },
    build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom'],
                    rtc: ['rtcforge/client', 'mediasoup-client'],
                },
            },
        },
    },
})
