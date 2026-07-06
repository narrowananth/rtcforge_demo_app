'use strict'

/**
 * Collaborative board test — boots the REAL server and drives TWO real rtcforge
 * clients (rtcforge/client runs in Node too) through one board room. Verifies
 * the collaborative primitives the app is built on:
 *   - stream/board token round-trips through signalingAuth
 *   - broadcast relay: a stroke from peer A reaches peer B on the same channel
 *   - directed signal: B's sync-request reaches A only (the late-join catch-up)
 *   - presence: each peer sees the other in the room roster
 */

const assert = require('node:assert')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'
process.env.PORT = '3103'

const { createClient, MessageType } = require('rtcforge/client')
const { createApp } = require('../src/server')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://localhost:3103'
const WS = 'ws://localhost:3103'

async function post(pathname, body) {
    const res = await fetch(BASE + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    })
    if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}`)
    return res.json()
}

async function main() {
    const app = createApp()
    await app.start()

    // --- lobby / tokens -----------------------------------------------------
    const a = await post('/api/boards', { title: 'Test Board', name: 'Ana' })
    assert.ok(a.board.id && a.token && a.self.color, 'create returns board + token + colour')
    const b = await post(`/api/boards/${a.board.id}/join`, { name: 'Bob' })
    assert.strictEqual(b.board.id, a.board.id, 'join maps to the same board')
    console.log('  ✓ board token round-trips (create + join, colours assigned)')

    const roomId = `board:${a.board.id}`
    const clientA = createClient({ serverUrl: WS, token: a.token })
    const clientB = createClient({ serverUrl: WS, token: b.token })
    const roomA = await clientA.joinRoom(roomId)
    const roomB = await clientB.joinRoom(roomId)
    await wait(300)

    // --- presence -----------------------------------------------------------
    assert.ok(roomA.peers.includes(b.self.id), 'A sees B in the roster')
    assert.ok(roomB.peers.includes(a.self.id), 'B sees A in the roster')
    console.log('  ✓ presence: each peer sees the other in the roster')

    // --- broadcast relay (strokes / doc ops) --------------------------------
    const gotStroke = new Promise((resolve) => {
        roomB.on(MessageType.Broadcast, (from, channel, data) => {
            if (channel === 'stroke') resolve({ from, data })
        })
    })
    roomA.broadcast('stroke', { points: [1, 2, 3], color: a.self.color })
    const stroke = await Promise.race([gotStroke, wait(2000).then(() => null)])
    assert.ok(stroke, 'B received the broadcast stroke')
    assert.strictEqual(stroke.from, a.self.id, 'stroke is attributed to A')
    assert.deepStrictEqual(stroke.data.points, [1, 2, 3], 'stroke payload intact')
    console.log('  ✓ broadcast relay: a stroke from A reaches B')

    // --- directed signal (late-join catch-up) -------------------------------
    const gotSync = new Promise((resolve) => {
        roomA.on(MessageType.Signal, (from, data) => {
            if (data && data.t === 'sync-request') resolve({ from, data })
        })
    })
    roomB.sendSignal(a.self.id, { t: 'sync-request' })
    const sync = await Promise.race([gotSync, wait(2000).then(() => null)])
    assert.ok(sync, 'A received the directed sync-request')
    assert.strictEqual(sync.from, b.self.id, 'sync-request is attributed to B')
    console.log('  ✓ directed signal: B → A sync-request delivered')

    await clientA.leave().catch(() => undefined)
    await clientB.leave().catch(() => undefined)
    await app.stop()
    console.log('\nALL COLLABORATIVE TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('COLLABORATIVE TEST FAILED:', err)
    process.exit(1)
})
