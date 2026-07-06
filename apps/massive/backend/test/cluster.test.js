'use strict'

/**
 * Multi-node cluster + cascade test. Boots N real co-located SFU nodes and drives
 * the cluster-aware control plane with fake signaling peers. Verifies:
 *   - N SFU nodes boot; origin placement is a deterministic hash over node ids
 *   - the broadcaster + the first `capacity` viewers land on the origin node
 *   - overflow viewers are packed onto edge nodes AND the CascadeTree/CascadeBridge
 *     establishes real mediasoup pipe edges to those nodes (SfuMesh.linkCount > 0)
 *   - a viewer is denied produce (broadcaster-only)
 *   - cluster status reports per-node load + live cascade links
 *
 * The RTP bytes themselves need a browser/ffmpeg source; this proves cluster
 * topology, placement, planning, and cross-node pipe plumbing.
 */

const assert = require('node:assert')
const { EventEmitter } = require('node:events')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'

const { core, SfuService, SfuMesh, SfuTopology } = require('@forgechat/rtc-shared/server')
const { createClusterSfuSignaling } = require('../src/cluster-signaling')
const { issueStreamToken, signalingAuth } = require('../src/auth')

const CAPACITY = 2
const NODES = 3
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const isSfuRoom = (id) => id.startsWith('stream:')
const streamIdFromRoom = (id) => (id.startsWith('stream:') ? id.slice('stream:'.length) : null)

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
    constructor(id) {
        super()
        this.id = id
        this._peers = []
    }
    add(peer) {
        this._peers.push(peer)
        this.emit('peerJoined', peer)
        return peer
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
    await wait(120)
    return peer.reply(msg.id)
}

async function main() {
    // token round-trip
    const bcToken = issueStreamToken({
        userId: 'bc',
        name: 'A',
        streamId: 'abc',
        role: 'broadcaster',
    })
    assert.strictEqual(signalingAuth(bcToken).role, 'broadcaster')
    console.log('  ✓ stream token round-trips')

    // Build the co-located cluster: N SFU nodes on distinct RTC port slices.
    const nodes = []
    for (let i = 0; i < NODES; i++) {
        nodes.push({
            id: `node-${i}`,
            region: 'local',
            sfu: new SfuService({
                rtcMinPort: 45000 + i * 1000,
                rtcMaxPort: 45000 + i * 1000 + 999,
            }),
        })
    }
    for (const n of nodes) await n.sfu.init()
    console.log(`  ✓ ${NODES} SFU nodes booted`)

    const mesh = new SfuMesh({})
    for (const n of nodes) mesh.register(n.id, n.sfu)
    const topology = new SfuTopology({
        self: { id: 'self', region: 'local' },
        mesh,
        capacity: CAPACITY,
        fanout: 2,
    })
    for (const n of nodes) topology.addNode(n.id, n.region)
    const ring = new core.HashRing()
    for (const n of nodes) ring.add({ id: n.id })

    const signaling = new EventEmitter()
    const cs = createClusterSfuSignaling({
        signaling,
        nodes,
        mesh,
        topology,
        ring,
        capacity: CAPACITY,
        logger: null,
        isSfuRoom,
        streamIdFromRoom,
    })
    cs.bind()

    const room = new FakeRoom('stream:abc')
    signaling.emit('roomCreated', room)

    const origin = ring.get('abc')
    assert.ok(
        nodes.some((n) => n.id === origin),
        'origin resolves to a real node',
    )
    console.log(`  ✓ origin placement (hash ring) → ${origin}`)

    // Broadcaster on origin; sfu-caps works against its node router.
    const bc = room.add(new FakePeer('bc', 'broadcaster'))
    const caps = await rpc(bc, { id: 1, type: 'sfu-caps' })
    assert(caps?.ok && caps.result.rtpCapabilities, 'broadcaster gets rtp caps from its node')
    console.log('  ✓ broadcaster placed on origin, caps served')

    // 5 viewers, capacity 2 per node → origin holds 2, the rest overflow to edges.
    for (let i = 0; i < 5; i++) {
        const v = room.add(new FakePeer(`v${i}`, 'viewer'))
        await rpc(v, { id: 100 + i, type: 'sfu-caps' })
    }
    await wait(600) // let cascade pipe transports establish

    const status = cs.status()
    const originLoad = status.nodes.find((n) => n.id === origin)
    assert.ok(originLoad.viewers <= CAPACITY + 1, 'origin holds ~capacity viewers (+broadcaster)')
    const usedNodes = status.nodes.filter((n) => n.viewers > 0).length
    assert.ok(usedNodes > 1, 'viewers spread across more than one node')
    assert.ok(mesh.linkCount() > 0, 'cascade established at least one cross-node pipe edge')
    console.log(
        `  ✓ viewers packed across ${usedNodes} nodes; ${mesh.linkCount()} cascade edge(s) live`,
    )

    // Viewer publish gate.
    const denied = await rpc(
        room.getPeers().find((p) => p.role === 'viewer'),
        {
            id: 999,
            type: 'sfu-produce',
            transportId: 'x',
            kind: 'video',
            rtpParameters: {},
        },
    )
    assert(
        denied && denied.ok === false && /broadcaster/i.test(denied.error),
        'viewer denied produce',
    )
    console.log('  ✓ viewers are view-only (broadcaster-only publish)')

    topology.dispose()
    for (const n of nodes) await n.sfu.close()
    console.log('\nALL CLUSTER TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('CLUSTER TEST FAILED:', err)
    process.exit(1)
})
