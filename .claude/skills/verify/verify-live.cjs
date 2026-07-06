'use strict'

/**
 * Node signaling driver — boots the REAL server (mediasoup workers and all) and
 * drives a broadcaster + two viewers over rtcforge/client. No browser needed:
 * the broadcaster-left notification and the SFU RPC ride the plain signal
 * channel, so this exercises the exact backend paths that were fixed.
 *
 * Self-contained: boots its own server on its own port and tears it down.
 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const REPO = path.resolve(__dirname, '..', '..', '..')
// Resolve from the backend so bare specifiers (rtcforge/client) use its
// node_modules AND honour the package `exports` map — an absolute path to the
// subpath would bypass exports and fail.
const backendRequire = createRequire(path.join(REPO, 'backend', 'package.json'))

const PORT = 3994
process.env.PORT = String(PORT)
process.env.HOST = '127.0.0.1'
process.env.TOKEN_SECRET = 'verify-secret'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-verify-'))
process.env.LOG_LEVEL = 'error'
process.env.SFU_LISTEN_IP = '127.0.0.1'

const { createApp } = backendRequire('./src/server')
const { RTCForgeClient } = backendRequire('rtcforge/client')

const BASE = `http://127.0.0.1:${PORT}`
const WS = `ws://127.0.0.1:${PORT}`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(token, method, url, body) {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let payload = body
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
    }
    const res = await fetch(BASE + url, { method, headers, body: payload })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json.error || ''}`)
    return json
}

function waitFor(arr, pred, timeout = 5000, label = 'event') {
    return new Promise((resolve, reject) => {
        const t0 = Date.now()
        const tick = () => {
            const f = arr.find(pred)
            if (f) return resolve(f)
            if (Date.now() - t0 > timeout) return reject(new Error(`timeout waiting for ${label}`))
            setTimeout(tick, 20)
        }
        tick()
    })
}

async function inbox(user) {
    const events = []
    const client = new RTCForgeClient({ serverUrl: WS, token: user.token, reconnect: false })
    const room = await client.joinRoom(`inbox:${user.user.id}`)
    room.on('broadcast', (_f, ch, data) => ch === 'inbox' && events.push(data))
    return { client, events }
}

async function joinSfu(token, roomId) {
    const signals = []
    const peerLefts = []
    const client = new RTCForgeClient({ serverUrl: WS, token, reconnect: false })
    const room = await client.joinRoom(roomId)
    room.on('signal', (from, data) => from === 'sfu' && signals.push(data))
    // rtcforge's own Room event — this is how a viewer learns the broadcaster left.
    room.on('peer-left', (peerId) => peerLefts.push(peerId))
    const rpc = (id, payload) => room.sendSignal('sfu', { id, ...payload })
    return { client, room, signals, peerLefts, rpc }
}

async function main() {
    const app = createApp()
    await app.start()
    let failed = false
    const clients = []
    try {
        const reg = (u) =>
            api(null, 'POST', '/api/auth/register', {
                username: u,
                password: 'secret1',
                displayName: u,
            })
        const alice = await reg('alice')
        const bob = await reg('bob')
        const carol = await reg('carol')
        console.log('  ✓ registered broadcaster + 2 viewers')

        const aInbox = await inbox(alice)
        const bInbox = await inbox(bob)
        const cInbox = await inbox(carol)
        clients.push(aInbox.client, bInbox.client, cInbox.client)
        await wait(150)

        const bcast = (
            await api(alice.token, 'POST', '/api/conversations/broadcast', {
                title: 'Live',
                memberIds: [bob.user.id, carol.user.id],
            })
        ).conversation

        const place = await api(alice.token, 'POST', '/api/calls', {
            convId: bcast.id,
            media: 'video',
        })
        assert.strictEqual(place.mode, 'broadcast')
        assert.strictEqual(place.produce, true)
        const roomId = place.callRoomId

        await waitFor(bInbox.events, (e) => e.type === 'broadcast-incoming', 5000, 'bob incoming')
        await waitFor(cInbox.events, (e) => e.type === 'broadcast-incoming', 5000, 'carol incoming')
        const bAcc = await api(bob.token, 'POST', `/api/calls/${place.callId}/accept`)
        const cAcc = await api(carol.token, 'POST', `/api/calls/${place.callId}/accept`)
        assert.strictEqual(bAcc.produce, false)
        console.log('  ✓ broadcast placed; viewers accepted (view-only tokens)')

        const aSfu = await joinSfu(place.token, roomId)
        const bSfu = await joinSfu(bAcc.token, roomId)
        const cSfu = await joinSfu(cAcc.token, roomId)
        clients.push(aSfu.client, bSfu.client, cSfu.client)
        await wait(300)

        aSfu.rpc(1, { type: 'sfu-caps' })
        const caps = await waitFor(aSfu.signals, (s) => s.id === 1, 5000, 'sfu-caps')
        assert.ok(caps.ok && caps.result.rtpCapabilities)
        aSfu.rpc(2, { type: 'sfu-create-transport', direction: 'send' })
        const tp = await waitFor(aSfu.signals, (s) => s.id === 2, 5000, 'sfu-create-transport')
        assert.ok(tp.ok && tp.result.transport && tp.result.transport.iceParameters)
        console.log('  ✓ SFU control plane via rtcforge SfuSignalHandler: caps + create-transport')

        bSfu.rpc(3, { type: 'sfu-produce', transportId: 'x', kind: 'video', rtpParameters: {} })
        const prod = await waitFor(bSfu.signals, (s) => s.id === 3, 5000, 'viewer produce')
        assert.strictEqual(prod.ok, false)
        console.log('  ✓ viewer publish rejected (broadcaster-only gate)')

        // A viewer leaving does NOT end the broadcast: the broadcaster (alice) is
        // still present, so no broadcaster peer-left and no call-ended reach bob.
        bInbox.events.length = 0
        bSfu.peerLefts.length = 0
        await api(carol.token, 'POST', `/api/calls/${place.callId}/end`)
        await cSfu.client.leave()
        await wait(600)
        assert.ok(!bInbox.events.some((e) => e.type === 'call-ended'))
        assert.ok(!bSfu.peerLefts.includes(alice.user.id), 'broadcaster still in the room')
        console.log('  ✓ viewer left → broadcast stays live for the remaining viewer')

        // The broadcaster leaving ends it: the viewer's own rtcforge Room fires
        // PeerLeft for the broadcaster (native, covers hang-up + disconnect), and
        // the inbox call-ended dismisses any not-yet-joined invitee.
        bInbox.events.length = 0
        bSfu.peerLefts.length = 0
        await api(alice.token, 'POST', `/api/calls/${place.callId}/end`)
        await aSfu.client.leave()
        await waitFor(
            bSfu.peerLefts,
            (pid) => pid === alice.user.id,
            5000,
            'broadcaster peer-left (native Room event)',
        )
        await waitFor(
            bInbox.events,
            (e) => e.type === 'call-ended' && e.reason === 'broadcaster-left',
            5000,
            'call-ended (inbox)',
        )
        console.log('  ✓ broadcaster left → viewer notified via rtcforge Room PeerLeft + inbox')

        const health = await fetch(`${BASE}/healthz`).then((r) => r.json())
        assert.strictEqual(health.status, 'ok')
        assert.ok(health.metrics && typeof health.metrics === 'object')
        console.log(
            `  ✓ /healthz metrics live (counter series: ${Object.keys(health.metrics.counters).length})`,
        )

        console.log('\nNODE SIGNALING DRIVER PASSED')
    } catch (err) {
        failed = true
        console.error('\nNODE VERIFY FAILED:', err.message, '\n', err.stack)
    } finally {
        for (const c of clients) await c.leave().catch(() => undefined)
        await app.stop()
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
        process.exit(failed ? 1 : 0)
    }
}

main()
