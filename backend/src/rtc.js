'use strict'

/**
 * Single import surface for the `rtcforge/core` primitives the backend is built
 * on. The whole app shares one clock, one id source, and one error taxonomy so
 * behaviour is consistent and swappable (e.g. a ManualClock in tests, a
 * clustered MessageBus in prod).
 *
 * Nothing here is hand-rolled — it re-exports rtcforge/core and adds two thin
 * helpers (`newId`, `clock`) that are just ergonomics over what core provides.
 */

const {
    systemClock,
    randomId,
    InvalidArgumentError,
    RtcForgeError,
    isRtcForgeError,
    toError,
    EventEmitter,
    LocalMessageBus,
    MemoryLock,
    MemoryStateStore,
    HashRing,
    MemoryMembership,
    MembershipReconciler,
    GossipMembership,
    noopMetrics,
    noopLogger,
} = require('rtcforge/core')

/** Shared monotonic-ish wall clock. `clock.now()` replaces every `Date.now()`. */
const clock = systemClock

/**
 * Collision-resistant id with an app prefix. Body is a rtcforge/core `randomId`
 * (UUIDv4) with hyphens stripped so ids stay `[\w.]`-safe for on-disk media
 * filenames and path validation. 128 bits of entropy.
 */
function newId(prefix = '') {
    return `${prefix}${randomId.next().replace(/-/g, '')}`
}

module.exports = {
    clock,
    randomId,
    newId,
    InvalidArgumentError,
    RtcForgeError,
    isRtcForgeError,
    toError,
    EventEmitter,
    LocalMessageBus,
    MemoryLock,
    MemoryStateStore,
    HashRing,
    MemoryMembership,
    MembershipReconciler,
    GossipMembership,
    noopMetrics,
    noopLogger,
}
