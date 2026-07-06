import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
        port: 5176,
        proxy: {
            '/api': 'http://localhost:3004',
            '/healthz': 'http://localhost:3004',
        },
    },
    build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom'],
                    rtc: ['rtcforge/client', 'rtcforge/media', 'mediasoup-client'],
                },
            },
        },
    },
})
