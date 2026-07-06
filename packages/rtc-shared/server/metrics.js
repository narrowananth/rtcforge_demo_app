'use strict'

/**
 * In-memory metrics sink implementing the rtcforge/core `MetricsCollector`
 * interface. The signaling server calls `increment`/`gauge` on room and peer
 * lifecycle transitions; this aggregates them into counters, gauges, and
 * lightweight histogram summaries for a health endpoint. Swap for a
 * Prometheus/StatsD adapter in production without touching any call site.
 *
 * @implements {import('rtcforge/core').MetricsCollector}
 */

function key(metric, labels) {
    if (!labels) return metric
    const parts = Object.keys(labels)
        .sort()
        .map((k) => `${k}=${labels[k]}`)
    return parts.length ? `${metric}{${parts.join(',')}}` : metric
}

class Metrics {
    constructor() {
        this._counters = new Map()
        this._gauges = new Map()
        this._hist = new Map()
    }

    increment(metric, labels) {
        const k = key(metric, labels)
        this._counters.set(k, (this._counters.get(k) || 0) + 1)
    }

    gauge(metric, value, labels) {
        this._gauges.set(key(metric, labels), value)
    }

    histogram(metric, value, labels) {
        this._observe(key(metric, labels), value)
    }

    timing(metric, ms, labels) {
        this._observe(`${key(metric, labels)}_ms`, ms)
    }

    _observe(k, v) {
        const h = this._hist.get(k) || { count: 0, sum: 0, min: Infinity, max: -Infinity }
        h.count += 1
        h.sum += v
        h.min = Math.min(h.min, v)
        h.max = Math.max(h.max, v)
        this._hist.set(k, h)
    }

    /** Point-in-time view of all metrics, for a health endpoint. */
    snapshot() {
        return {
            counters: Object.fromEntries(this._counters),
            gauges: Object.fromEntries(this._gauges),
            histograms: Object.fromEntries(
                [...this._hist].map(([k, h]) => [k, { ...h, avg: h.count ? h.sum / h.count : 0 }]),
            ),
        }
    }
}

module.exports = { Metrics }
