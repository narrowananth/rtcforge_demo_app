'use strict'

/**
 * Single import surface for the `rtcforge/core` primitives every backend is
 * built on — one clock, one id source, one error taxonomy, shared across all
 * apps. Nothing here is hand-rolled: it re-exports rtcforge/core and adds two
 * thin ergonomics helpers (`newId`, `clock`).
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

/** Shared wall clock. `clock.now()` replaces every `Date.now()`. */
const clock = systemClock

/**
 * Collision-resistant id with an app prefix. Body is a rtcforge/core `randomId`
 * (UUIDv4) with hyphens stripped so ids stay `[\w.]`-safe for filenames and
 * path validation. 128 bits of entropy.
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
