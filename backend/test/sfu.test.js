'use strict'

/**
 * SFU control-plane test — boots the REAL rtcforge-media SFU (mediasoup workers)
 * and drives the produce/consume signaling protocol end-to-end with fake
 * signaling peers. Verifies:
 *   - the mediasoup worker boots and a per-room MediaRouter is created
 *   - get-rtp-capabilities / create-transport map onto the router
 *   - broadcast rooms gate publishing to the 'broadcaster' role
 *   - unknown actions and bad consume requests fail cleanly (ok:false)
 *
 * The full media byte path (DTLS/ICE, actual RTP) needs a real browser client
 * and is exercised manually — see README.
 */

const assert = require('node:assert')
const { EventEmitter } = require('node:events')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'

const { SfuService } = require('../src/media/sfuService')
const { SfuTopology } = require('../src/media/sfuCluster')
const { createSfuSignaling } = require('../src/media/sfuSignaling')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

class FakePeer extends EventEmitter {
    constructor(id, role = 'member') {
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
    const sfu = new SfuService()
    await sfu.init()
    console.log('  ✓ mediasoup worker booted')

    const topology = new SfuTopology({ self: { id: 'node_test', region: 'local' } })
    const signaling = new EventEmitter()
    createSfuSignaling({ signaling, sfu, topology }).bind()

    // --- a call room: any participant may publish --------------------------
    const alice = new FakePeer('u_alice')
    const callRoom = new FakeRoom('call:t1', [alice])
    signaling.emit('roomCreated', callRoom)
    await wait(200)

    const caps = await rpc(alice, { id: 1, action: 'get-rtp-capabilities' })
    assert(caps?.ok, 'get-rtp-capabilities should succeed')
    const codecs = caps.result.routerRtpCapabilities.codecs.map((c) => c.mimeType.toLowerCase())
    assert(codecs.includes('audio/opus'), 'router advertises opus')
    assert(
        codecs.some((m) => m.startsWith('video/')),
        'router advertises a video codec',
    )
    console.log('  ✓ per-room MediaRouter + rtpCapabilities')

    const t = await rpc(alice, { id: 2, action: 'create-transport', direction: 'send' })
    assert(t?.ok && t.result.transport.id, 'create-transport returns a transport id')
    assert(t.result.transport.iceCandidates.length > 0, 'transport has ICE candidates')
    assert(t.result.transport.dtlsParameters.fingerprints.length > 0, 'transport has DTLS params')
    console.log('  ✓ create-transport (ICE + DTLS params)')

    const bad = await rpc(alice, { id: 3, action: 'nope' })
    assert(bad && bad.ok === false, 'unknown action returns ok:false')
    console.log('  ✓ unknown action rejected')

    const badConsume = await rpc(alice, {
        id: 4,
        action: 'consume',
        transportId: t.result.transport.id,
        producerId: 'does-not-exist',
        rtpCapabilities: caps.result.routerRtpCapabilities,
    })
    assert(badConsume && badConsume.ok === false, 'consuming a missing producer fails cleanly')
    console.log('  ✓ bad consume rejected')

    // --- a broadcast room: only the broadcaster may publish ----------------
    const viewer = new FakePeer('u_bob', 'viewer')
    const bcastRoom = new FakeRoom('bcast:t2', [viewer])
    signaling.emit('roomCreated', bcastRoom)
    await wait(200)

    const denied = await rpc(viewer, {
        id: 5,
        action: 'produce',
        transportId: 'x',
        kind: 'video',
        rtpParameters: {},
    })
    assert(denied && denied.ok === false, 'viewer is denied produce')
    assert(/broadcaster/i.test(denied.error), 'denial cites broadcaster role')
    console.log('  ✓ broadcast room gates publishing to the broadcaster')

    topology.dispose()
    await sfu.close()
    console.log('\nALL SFU TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('SFU TEST FAILED:', err)
    process.exit(1)
})
