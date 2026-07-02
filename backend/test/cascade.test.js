'use strict'

/**
 * Cross-node cascade byte-relay test (gap 1). Boots TWO real SFU nodes
 * (rtcforge-media MediaService, distinct RTC port ranges) in one process, drives
 * the rtcforge-sfu CascadeTree with enough viewers to force an edge, and asserts
 * the CascadeBridge → SfuMesh path establishes a real, connected mediasoup pipe
 * transport pair between the origin and edge routers.
 *
 * Not covered headless: the RTP bytes themselves (pipeConsume→pipeProduce of a
 * live producer) — that needs a media source (browser/ffmpeg). This proves the
 * cluster topology, planning, bridge wiring, and cross-node transport plumbing.
 */

const assert = require('node:assert')

process.env.LOG_LEVEL = 'error'
process.env.TOKEN_SECRET = 'test-secret'
// Small capacity so a handful of viewers forces a cascade edge.
process.env.SFU_VIEWERS_PER_NODE = '2'
process.env.SFU_CASCADE_FANOUT = '2'

const {
    SfuCluster,
    CascadeTree,
    CascadeBridge,
    SfuNode,
    LeastLoadedStrategy,
} = require('rtcforge-sfu')
const { SfuService } = require('../src/media/sfuService')
const { SfuMesh } = require('../src/media/sfuMesh')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
    // Two co-located SFU nodes with non-overlapping RTC port ranges.
    const nodeA = new SfuService({ rtcMinPort: 45000, rtcMaxPort: 46000 })
    const nodeB = new SfuService({ rtcMinPort: 46001, rtcMaxPort: 47000 })
    await nodeA.init()
    await nodeB.init()
    console.log('  ✓ two SFU nodes booted')

    const mesh = new SfuMesh()
    mesh.register('node-a', nodeA)
    mesh.register('node-b', nodeB)

    // rtcforge-sfu control plane: cluster + cascade tree + bridge → mesh.
    const cluster = new SfuCluster({ placementStrategy: new LeastLoadedStrategy() })
    cluster.addNode(new SfuNode('node-a', 'local', { capacity: 2 }))
    cluster.addNode(new SfuNode('node-b', 'local', { capacity: 2 }))
    const tree = new CascadeTree(cluster, { fanout: 2, viewersPerNode: 2 })
    const bridge = new CascadeBridge(tree, mesh)
    bridge.attach()

    const roomId = 'bcast:cascade-test'
    // Origin = node-a; enough viewers that a single node can't serve them all,
    // forcing at least one edge (→ LinkCreated → mesh.pipeLink).
    const plan = tree.build(roomId, 'node-a', 8)
    console.log(
        `  ✓ cascade planned: tiers=${plan.tiers} edges=${plan.edges.length} links=${plan.links.length}`,
    )
    assert(plan.links.length > 0, 'plan should include at least one cascade link')

    await wait(400) // let the async pipe establish

    assert(mesh.linkCount() > 0, 'mesh should hold at least one established link')
    const [firstLink] = plan.links
    assert(
        mesh.hasLink(roomId, firstLink.from, firstLink.to),
        'mesh should have the exact link the tree planned',
    )
    console.log('  ✓ CascadeBridge → SfuMesh established a connected pipe edge')

    // Both nodes now own a router for the room (origin + edge).
    assert(nodeA.getRouter(roomId), 'origin node has a router for the room')
    assert(nodeB.getRouter(roomId), 'edge node has a router for the room (piped)')
    console.log('  ✓ origin + edge routers present')

    // Teardown: detaching the tree drops links → mesh.unpipeLink.
    tree.detach(roomId)
    await wait(100)
    assert(mesh.linkCount() === 0, 'links torn down after detach')
    console.log('  ✓ cascade links torn down on detach')

    bridge.detach()
    await nodeA.close()
    await nodeB.close()
    console.log('\nALL CASCADE TESTS PASSED')
    process.exit(0)
}

main().catch((err) => {
    console.error('CASCADE TEST FAILED:', err)
    process.exit(1)
})
