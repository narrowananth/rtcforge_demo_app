'use strict'

/**
 * End-to-end backend smoke test — no framework.
 * Boots the real server and exercises accounts, DM/group/broadcast messaging,
 * edit/delete/react/reply, media upload, and inbox fanout push.
 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PORT = 3996
process.env.PORT = String(PORT)
process.env.HOST = '127.0.0.1'
process.env.TOKEN_SECRET = 'test-secret'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'))
process.env.LOG_LEVEL = 'error'
process.env.FLUSH_INTERVAL_MS = '150'

const { createApp } = require('../src/server')
const { RTCForgeClient } = require('rtcforge-sdk')

const BASE = `http://127.0.0.1:${PORT}`
const WS = `ws://127.0.0.1:${PORT}`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(token, method, url, body, extraHeaders) {
    const headers = { ...(extraHeaders || {}) }
    if (token) headers.Authorization = `Bearer ${token}`
    let payload = body
    if (body !== undefined && !Buffer.isBuffer(body)) {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
    }
    const res = await fetch(BASE + url, { method, headers, body: payload })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json.error || ''}`)
    return json
}

/** Connect a user's inbox client and collect pushed events. */
async function connectInbox(user) {
    const events = []
    const client = new RTCForgeClient({ serverUrl: WS, token: user.token, reconnect: false })
    const room = await client.joinRoom(`inbox:${user.user.id}`)
    room.on('broadcast', (_from, channel, data) => {
        if (channel === 'inbox') events.push(data)
    })
    return { client, room, events }
}

function waitFor(events, pred, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
            const found = events.find(pred)
            if (found) return resolve(found)
            if (Date.now() - started > timeout)
                return reject(new Error('timeout waiting for event'))
            setTimeout(tick, 25)
        }
        tick()
    })
}

async function main() {
    const app = createApp()
    await app.start()
    let failed = false

    try {
        assert.strictEqual((await fetch(`${BASE}/healthz`).then((r) => r.json())).status, 'ok')

        // Register three users.
        const alice = await api(null, 'POST', '/api/auth/register', {
            username: 'alice',
            password: 'secret1',
            displayName: 'Alice',
        })
        const bob = await api(null, 'POST', '/api/auth/register', {
            username: 'bob',
            password: 'secret1',
            displayName: 'Bob',
        })
        const carol = await api(null, 'POST', '/api/auth/register', {
            username: 'carol',
            password: 'secret1',
            displayName: 'Carol',
        })
        console.log('  ✓ registered 3 users')

        // Duplicate username rejected; bad login rejected.
        await assert.rejects(
            api(null, 'POST', '/api/auth/register', { username: 'alice', password: 'secret1' }),
        )
        await assert.rejects(
            api(null, 'POST', '/api/auth/login', { username: 'alice', password: 'wrong' }),
        )
        const relogin = await api(null, 'POST', '/api/auth/login', {
            username: 'alice',
            password: 'secret1',
        })
        assert.strictEqual(relogin.user.id, alice.user.id, 'login returns same user')
        console.log('  ✓ auth validation')

        // Inbox connections.
        const aInbox = await connectInbox(alice)
        const bInbox = await connectInbox(bob)
        const cInbox = await connectInbox(carol)
        await wait(150)

        // Presence: Bob should be online per Alice's query after they share nothing yet — use /presence.
        // DM: Alice → Bob.
        const dm = (
            await api(alice.token, 'POST', '/api/conversations/dm', { userId: bob.user.id })
        ).conversation
        assert.strictEqual(dm.type, 'dm')
        await waitFor(bInbox.events, (e) => e.type === 'conversation-added' && e.convId === dm.id)
        console.log('  ✓ DM created + conversation-added pushed to Bob')

        // Send message; both Alice and Bob get it.
        const sent = (
            await api(alice.token, 'POST', `/api/conversations/${dm.id}/messages`, {
                type: 'text',
                text: 'hi bob 👋',
            })
        ).message
        await waitFor(aInbox.events, (e) => e.type === 'message' && e.message.id === sent.id)
        await waitFor(bInbox.events, (e) => e.type === 'message' && e.message.id === sent.id)
        console.log('  ✓ message fanned out to both inboxes')

        // Reply.
        const reply = (
            await api(bob.token, 'POST', `/api/conversations/${dm.id}/messages`, {
                type: 'text',
                text: 'hey alice',
                replyTo: sent.id,
            })
        ).message
        assert.strictEqual(reply.replyPreview.id, sent.id, 'reply preview references target')

        // Edit.
        await api(alice.token, 'PATCH', `/api/conversations/${dm.id}/messages/${sent.id}`, {
            text: 'hi bob (edited)',
        })
        const edited = await waitFor(
            bInbox.events,
            (e) => e.type === 'message-edited' && e.id === sent.id,
        )
        assert.strictEqual(edited.text, 'hi bob (edited)')

        // React.
        await api(bob.token, 'POST', `/api/conversations/${dm.id}/messages/${sent.id}/reactions`, {
            emoji: '❤️',
        })
        const reacted = await waitFor(
            aInbox.events,
            (e) => e.type === 'message-reaction' && e.id === sent.id,
        )
        assert.deepStrictEqual(reacted.reactions['❤️'], [bob.user.id])

        // Only sender can edit someone else's message → rejected.
        await assert.rejects(
            api(bob.token, 'PATCH', `/api/conversations/${dm.id}/messages/${sent.id}`, {
                text: 'hacked',
            }),
        )

        // Delete.
        await api(alice.token, 'DELETE', `/api/conversations/${dm.id}/messages/${sent.id}`)
        await waitFor(bInbox.events, (e) => e.type === 'message-deleted' && e.id === sent.id)
        console.log('  ✓ reply / edit / react / delete + permission checks')

        // Media upload + image message.
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
        const upload = await api(alice.token, 'POST', '/api/media', png, {
            'Content-Type': 'image/png',
            'X-Filename': 'pixel.png',
        })
        assert.ok(upload.attachment.url.startsWith('/media/'), 'upload returns url')
        const imgMsg = (
            await api(alice.token, 'POST', `/api/conversations/${dm.id}/messages`, {
                type: 'image',
                attachment: upload.attachment,
            })
        ).message
        assert.strictEqual(imgMsg.type, 'image')
        const served = await fetch(BASE + upload.attachment.url)
        assert.strictEqual(served.status, 200, 'media served')
        assert.strictEqual(served.headers.get('content-type'), 'image/png')
        console.log('  ✓ media upload + serve + image message')

        // Group chat.
        const group = (
            await api(alice.token, 'POST', '/api/conversations/group', {
                title: 'Team',
                memberIds: [bob.user.id, carol.user.id],
            })
        ).conversation
        await waitFor(
            bInbox.events,
            (e) => e.type === 'conversation-added' && e.convId === group.id,
        )
        await waitFor(
            cInbox.events,
            (e) => e.type === 'conversation-added' && e.convId === group.id,
        )
        const gMsg = (
            await api(carol.token, 'POST', `/api/conversations/${group.id}/messages`, {
                type: 'text',
                text: 'hello team',
            })
        ).message
        await waitFor(aInbox.events, (e) => e.type === 'message' && e.message.id === gMsg.id)
        await waitFor(bInbox.events, (e) => e.type === 'message' && e.message.id === gMsg.id)
        console.log('  ✓ group create + fanout to all members')

        // Broadcast list → per-recipient DM delivery.
        const bcast = (
            await api(alice.token, 'POST', '/api/conversations/broadcast', {
                title: 'Announcements',
                memberIds: [bob.user.id, carol.user.id],
            })
        ).conversation
        await api(alice.token, 'POST', `/api/conversations/${bcast.id}/messages`, {
            type: 'text',
            text: 'ship it 🚀',
        })
        // Bob & Carol receive it in their DM with Alice (viaBroadcast).
        const bGot = await waitFor(
            bInbox.events,
            (e) =>
                e.type === 'message' &&
                e.message.viaBroadcast &&
                e.message.text.includes('ship it'),
        )
        const cGot = await waitFor(
            cInbox.events,
            (e) =>
                e.type === 'message' &&
                e.message.viaBroadcast &&
                e.message.text.includes('ship it'),
        )
        assert.notStrictEqual(
            bGot.message.convId,
            cGot.message.convId,
            'each recipient gets it in their own DM',
        )
        console.log('  ✓ broadcast fanned out to per-recipient DMs')

        // Conversation list ordering + presence endpoint.
        const list = (await api(alice.token, 'GET', '/api/conversations')).conversations
        assert.ok(list.length >= 3, 'alice sees dm + group + broadcast')
        const presence = (
            await api(alice.token, 'GET', `/api/presence?ids=${bob.user.id},${carol.user.id}`)
        ).online
        assert.ok(
            presence.includes(bob.user.id) && presence.includes(carol.user.id),
            'presence reflects online users',
        )
        console.log('  ✓ conversation list + presence')

        await aInbox.client.leave()
        await bInbox.client.leave()
        await cInbox.client.leave()
        console.log('\nALL BACKEND SMOKE TESTS PASSED')
    } catch (err) {
        failed = true
        console.error('\nSMOKE TEST FAILED:', err.message, '\n', err.stack)
    } finally {
        await app.stop()
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
        process.exit(failed ? 1 : 0)
    }
}

main()
