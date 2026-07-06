import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE = process.env.BASE || 'http://localhost:3001'
export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots')
mkdirSync(SHOTS, { recursive: true })
export const STAMP = String(Date.now()).slice(-6)

export async function api(method, url, body, token) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(BASE + url, { method, headers, body: body && JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json.error || ''}`)
    return json
}

export const seedUser = (name) =>
    api('POST', '/api/auth/register', {
        username: `${name}${STAMP}`,
        password: 'secret1',
        displayName: name,
    })

/** Open a page already authenticated as `session` (skips the login UI). */
export async function authedPage(browser, session) {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] })
    await ctx.addInitScript(
        ([token, user]) => {
            localStorage.setItem('fc_token', token)
            localStorage.setItem('fc_me', user)
        },
        [session.token, JSON.stringify(session.user)],
    )
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    return page
}

/** Chromium args that make WebRTC drivable headless: synthetic devices, autoplay. */
export const MEDIA_ARGS = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
]
