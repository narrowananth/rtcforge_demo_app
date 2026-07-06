/**
 * Lightweight WebAudio "is this stream talking" detector — one AudioContext
 * analyser per stream, RMS over the frequency bins with a threshold + release.
 * Uniform across the mesh and SFU planes so every tile lights up the same way.
 * Returns a disposer.
 */
export function createSpeakingDetector(
    stream: MediaStream,
    onSpeaking: (speaking: boolean) => void,
): () => void {
    if (stream.getAudioTracks().length === 0) return () => {}
    type Ctor = typeof AudioContext
    const Ctx: Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext
    const ctx = new Ctx()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const bins = new Uint8Array(analyser.frequencyBinCount)

    let raf = 0
    let speaking = false
    let quietFrames = 0
    const tick = () => {
        analyser.getByteFrequencyData(bins)
        let sum = 0
        for (const v of bins) sum += v
        const avg = sum / bins.length
        if (avg > 20) {
            quietFrames = 0
            if (!speaking) {
                speaking = true
                onSpeaking(true)
            }
        } else if (speaking) {
            quietFrames += 1
            if (quietFrames > 20) {
                speaking = false
                onSpeaking(false)
            }
        }
        raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
        cancelAnimationFrame(raf)
        source.disconnect()
        ctx.close().catch(() => undefined)
    }
}
