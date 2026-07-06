import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend runs on :3001. HTTP (/api, /media, /healthz) is proxied so the
// app is same-origin in dev; the signaling WebSocket connects directly to the
// backend (VITE_WS_URL) to avoid clashing with Vite's own HMR socket.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3001',
            '/media': 'http://localhost:3001',
            '/healthz': 'http://localhost:3001',
        },
    },
    build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom'],
                    chakra: ['@chakra-ui/react', '@emotion/react', '@emotion/styled'],
                    query: ['@tanstack/react-query'],
                    rtc: ['rtcforge/client', 'rtcforge/media', 'mediasoup-client'],
                },
            },
        },
    },
})
