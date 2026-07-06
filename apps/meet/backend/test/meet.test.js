'use strict'

/**
 * Meet test. Three parts:
 *   1. token roles round-trip (host / participant / audience by meeting type)
 *   2. SFU publish policy via fake peers: a webinar audience is denied produce;
 *      a room participant passes the policy (real mediasoup SFU)
 *   3. host control end-to-end: boot the real server, two live rtcforge clients
 *      join a room meeting, the host kicks the guest via REST → the guest is
 *      removed (Room.kickPeer)
 */

const assert = require('node:assert')
const { EventEmitter } = require('node:events')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'
process.env.PORT = '3104'

const { SfuService, createSfuSignaling } = require('@forgechat/rtc-shared/server')
const { createClient, MessageType } = require('rtcforge/client')
const { issueMeetingToken, signalingAuth } = require('../src/auth')
const config = require('../src/config')
const { createApp } = require('../src/server')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://localhost:3104'
const WS = 'ws://localhost:3104'

const isSfuRoom = (roomId) =>
    roomId.startsWith(config.types.room) || roomId.startsWith(config.types.webinar)
const publishPolicy = ({ room, peer }) => {
    if (room.id.startsWith(config.types.webinar)) {
        return peer.role === 'host' || peer.role === 'panelist'
            ? null
            : 'Only the host may present in a webinar'
    }
    return null
}

class FakePeer extends EventEmitter {
    constructor(id, role) {
        super()
        this.id = id
        this.role = role
        this.sent = []
    }
    send(msg) {
        this.sent.push(msg)
    }
    reply(id) {
        return this.sent.map((m) => m.data).find((d) => d && d.id === id)
    }
}
class FakeRoom extends EventEmitter {
    constructor(id, peers = []) {
        super()
        this.id = id
        this._peers = peers
    }
    getPeers() {
        return this._peers
    }
    getPeerCount() {
        return this._peers.length
    }
}
async function rpc(peer, msg) {
    peer.emit('signal', 'sfu', msg)
    await wait(150)
    return peer.reply(msg.id)
}
async function post(pathname, body) {
    const res = await fetch(BASE + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function main() {
    // --- Part 1: token roles -----------------------------------------------
    const hostAuth = signalingAuth(
        issueMeetingToken({ userId: 'h1', name: 'H', type: 'room', meetingId: 'x', role: 'host' }),
    )
    assert.strictEqual(hostAuth.roomId, 'room:x')
    assert.strictEqual(hostAuth.role, 'host')
    const audAuth = signalingAuth(
        issueMeetingToken({
            userId: 'a1',
            name: 'A',
            type: 'webinar',
            meetingId: 'y',
            role: 'audience',
        }),
    )
    assert.strictEqual(audAuth.roomId, 'webinar:y')
    assert.strictEqual(audAuth.role, 'audience')
    console.log('  ✓ meeting tokens carry type-prefixed room + role')

    // --- Part 2: SFU publish policy (fake peers) ---------------------------
    const sfu = new SfuService({ rtcMinPort: 41000, rtcMaxPort: 41999 })
    await sfu.init()
    const signaling = new EventEmitter()
    createSfuSignaling({ signaling, sfu, logger: null, isSfuRoom, publishPolicy }).bind()

    const audience = new FakePeer('a1', 'audience')
    const webinar = new FakeRoom('webinar:y', [audience])
    signaling.emit('roomCreated', webinar)
    await wait(200)
    const denied = await rpc(audience, {
        id: 1,
        type: 'sfu-produce',
        transportId: 'x',
        kind: 'video',
        rtpParameters: {},
    })
    assert(denied && denied.ok === false && /host|present/i.test(denied.error), 'audience denied')
    console.log('  ✓ webinar audience is denied produce (view-only)')

    const member = new FakePeer('p1', 'participant')
    const room = new FakeRoom('room:z', [member])
    signaling.emit('roomCreated', room)
    await wait(200)
    const passed = await rpc(member, {
        id: 2,
        type: 'sfu-produce',
        transportId: 'x',
        kind: 'video',
        rtpParameters: {},
    })
    // Passes the policy → fails later on the bogus transport, NOT with the policy msg.
    assert(passed && passed.ok === false, 'produce still fails on bogus transport')
    assert(!/host|present/i.test(passed.error || ''), 'room participant passes the publish policy')
    console.log('  ✓ room participant passes the publish policy (everyone publishes)')
    await sfu.close()

    // --- Part 3: host kick, end-to-end -------------------------------------
    const server = createApp()
    await server.start()

    const created = (await post('/api/meetings', { title: 'Standup', type: 'room', name: 'Ana' }))
        .body
    const guest = (await post(`/api/meetings/${created.meeting.id}/join`, { name: 'Bob' })).body
    const roomId = `room:${created.meeting.id}`

    const hostClient = createClient({ serverUrl: WS, token: created.token })
    const guestClient = createClient({ serverUrl: WS, token: guest.token })
    const hostRoom = await hostClient.joinRoom(roomId)
    await guestClient.joinRoom(roomId)
    await wait(300)
    assert.ok(hostRoom.peers.includes(guest.self.id), 'host sees the guest before kick')

    const nonHost = await post(`/api/meetings/${created.meeting.id}/kick`, {
        token: guest.token,
        peerId: created.self.id,
    })
    assert.strictEqual(nonHost.status, 403, 'a non-host cannot kick')

    const left = new Promise((resolve) => hostRoom.on(MessageType.PeerLeft, (id) => resolve(id)))
    const kick = await post(`/api/meetings/${created.meeting.id}/kick`, {
        token: created.token,
        peerId: guest.self.id,
    })
    assert.strictEqual(kick.status, 200, 'host kick accepted')
    const leftId = await Promise.race([left, wait(2000).then(() => null)])
    assert.strictEqual(leftId, guest.self.id, 'kicked guest left the room')
    console.log('  ✓ host kick removes a peer (non-host rejected)')

    await hostClient.leave().catch(() => undefined)
    await guestClient.leave().catch(() => undefined)
    await server.stop()
    console.log('\nALL MEET TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('MEET TEST FAILED:', err)
    process.exit(1)
})
