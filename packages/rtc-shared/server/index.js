'use strict'

/**
 * @forgechat/rtc-shared/server — Node-side rtcforge wiring shared by every app's
 * backend. Everything is a thin, parameterized layer over rtcforge/server +
 * rtcforge/media + rtcforge/core — no hand-rolled signaling/media/transport.
 *
 *   createSignaling      → configured rtcforge SignalingServer (auth/limits/audit)
 *   SfuService           → mediasoup SFU (per-room MediaRouter, produce/consume)
 *   createSfuSignaling   → SFU control plane over the signal channel + policy seam
 *   createTokens         → HMAC mint/verify for stateless auth tokens
 *   createLogger/Metrics → rtcforge Logger + MetricsCollector implementations
 *   core                 → rtcforge/core re-export (clock, ids, membership, …)
 */

const core = require('./core')
const { createLogger } = require('./logger')
const { Metrics } = require('./metrics')
const { createTokens } = require('./tokens')
const { SfuService } = require('./sfu-service')
const { createSfuSignaling, SFU_PEER } = require('./sfu-signaling')
const { createSignaling } = require('./signaling')

module.exports = {
    core,
    createLogger,
    Metrics,
    createTokens,
    SfuService,
    createSfuSignaling,
    SFU_PEER,
    createSignaling,
}
