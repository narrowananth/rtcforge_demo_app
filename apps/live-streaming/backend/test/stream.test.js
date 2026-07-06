'use strict'

/**
 * Live-streaming SFU test — boots the REAL rtcforge SFU (mediasoup) and drives
 * the produce/consume control plane with fake signaling peers via the SHARED
 * @forgechat/rtc-shared/server wiring. Verifies:
 *   - per-stream MediaRouter + rtpCapabilities (rtcforge SfuSignalHandler)
 *   - create-transport returns ICE + DTLS params
 *   - the broadcaster-only publish policy rejects a viewer's produce
 *   - bad consume fails cleanly
 *   - stream token round-trips through signalingAuth with the right role
 *
 * The real media byte path (DTLS/ICE, RTP) needs a browser and is exercised
 * manually.
 */

const assert = require('node:assert')
const { EventEmitter } = require('node:events')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'

const { SfuService, createSfuSignaling } = require('@forgechat/rtc-shared/server')
const { issueStreamToken, signalingAuth } = require('../src/auth')
const config = require('../src/config')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const isSfuRoom = (roomId) => roomId.startsWith(config.streamPrefix)
const publishPolicy = ({ peer }) =>
    peer.role === 'broadcaster' ? null : 'Only the broadcaster may publish to this stream'

class FakePeer extends EventEmitter {
    constructor(id, role = 'viewer') {
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

async function main() {
    // --- token round-trip ---------------------------------------------------
    const bcToken = issueStreamToken({
        userId: 'bc_1',
        name: 'Ana',
        streamId: 'abc',
        role: 'broadcaster',
    })
    const auth = signalingAuth(bcToken)
    assert.strictEqual(auth.roomId, 'stream:abc', 'token maps to stream room')
    assert.strictEqual(auth.role, 'broadcaster', 'broadcaster role preserved')
    const vAuth = signalingAuth(
        issueStreamToken({ userId: 'v_1', name: 'V', streamId: 'abc', role: 'viewer' }),
    )
    assert.strictEqual(vAuth.role, 'viewer', 'viewer role preserved')
    assert.throws(() => signalingAuth('garbage'), 'bad token rejected')
    console.log('  ✓ stream token round-trips through signalingAuth')

    // --- SFU control plane ---------------------------------------------------
    const sfu = new SfuService({})
    await sfu.init()
    console.log('  ✓ mediasoup worker booted')

    const signaling = new EventEmitter()
    createSfuSignaling({ signaling, sfu, logger: null, isSfuRoom, publishPolicy }).bind()

    const broadcaster = new FakePeer('bc_1', 'broadcaster')
    const room = new FakeRoom('stream:abc', [broadcaster])
    signaling.emit('roomCreated', room)
    await wait(200)

    const caps = await rpc(broadcaster, { id: 1, type: 'sfu-caps' })
    assert(caps?.ok, 'sfu-caps should succeed')
    const codecs = caps.result.rtpCapabilities.codecs.map((c) => c.mimeType.toLowerCase())
    assert(codecs.includes('audio/opus'), 'router advertises opus')
    assert(
        codecs.some((m) => m.startsWith('video/')),
        'router advertises a video codec',
    )
    console.log('  ✓ per-stream MediaRouter + rtpCapabilities (SfuSignalHandler)')

    const t = await rpc(broadcaster, { id: 2, type: 'sfu-create-transport', direction: 'send' })
    assert(t?.ok && t.result.transport.id, 'create-transport returns a transport id')
    assert(t.result.transport.iceCandidates.length > 0, 'transport has ICE candidates')
    assert(t.result.transport.dtlsParameters.fingerprints.length > 0, 'transport has DTLS params')
    console.log('  ✓ create-transport (ICE + DTLS params)')

    const badConsume = await rpc(broadcaster, {
        id: 3,
        type: 'sfu-consume',
        transportId: t.result.transport.id,
        producerId: 'does-not-exist',
        rtpCapabilities: caps.result.rtpCapabilities,
    })
    assert(badConsume && badConsume.ok === false, 'consuming a missing producer fails cleanly')
    console.log('  ✓ bad consume rejected')

    // --- broadcaster-only publish policy ------------------------------------
    const viewer = new FakePeer('v_1', 'viewer')
    room._peers.push(viewer)
    room.emit('peerJoined', viewer) // wire the viewer's SFU signal handler
    await wait(50)
    const denied = await rpc(viewer, {
        id: 4,
        type: 'sfu-produce',
        transportId: 'x',
        kind: 'video',
        rtpParameters: {},
    })
    assert(denied && denied.ok === false, 'viewer is denied produce')
    assert(/broadcaster/i.test(denied.error), 'denial cites broadcaster role')
    console.log('  ✓ stream gates publishing to the broadcaster (viewers view-only)')

    await sfu.close()
    console.log('\nALL LIVE-STREAMING TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('LIVE-STREAMING TEST FAILED:', err)
    process.exit(1)
})
