import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
    cssVarsPrefix: 'fc',
    globalCss: {
        'html, body, #root': {
            height: '100%',
            margin: 0,
            bg: 'bg.app',
            color: 'fg.default',
            colorScheme: 'dark',
        },
        body: {
            fontFamily: 'body',
            overflow: 'hidden',
        },
        '*::-webkit-scrollbar': { width: '7px', height: '7px' },
        '*::-webkit-scrollbar-thumb': { background: 'ink.500', borderRadius: '8px' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
    },
    theme: {
        tokens: {
            fonts: {
                heading: { value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
                body: { value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
            },
            colors: {
                accent: {
                    50: { value: '#e9fbf5' },
                    100: { value: '#c9f5e6' },
                    300: { value: '#5fe3b7' },
                    500: { value: '#00a884' },
                    600: { value: '#029072' },
                    700: { value: '#03795f' },
                },
                ink: {
                    900: { value: '#0b141a' },
                    850: { value: '#0d1418' },
                    800: { value: '#111b21' },
                    700: { value: '#1f2c33' },
                    600: { value: '#2a3942' },
                    500: { value: '#3b4a54' },
                },
                bubble: {
                    in: { value: '#202c33' },
                    out: { value: '#005c4b' },
                },
            },
        },
        semanticTokens: {
            colors: {
                'bg.app': { value: '{colors.ink.900}' },
                'bg.panel': { value: '{colors.ink.800}' },
                'bg.panel.raised': { value: '{colors.ink.700}' },
                'bg.hover': { value: '{colors.ink.600}' },
                'fg.default': { value: '#e9edef' },
                'fg.muted': { value: '#8696a0' },
                'fg.accent': { value: '{colors.accent.300}' },
                'border.subtle': { value: '{colors.ink.600}' },
                'bubble.in': { value: '{colors.bubble.in}' },
                'bubble.out': { value: '{colors.bubble.out}' },
                'accent.solid': { value: '{colors.accent.500}' },
                'accent.emphasis': { value: '{colors.accent.600}' },
                'danger.solid': { value: '#f15c6d' },
            },
        },
    },
})

export const system = createSystem(defaultConfig, config)
