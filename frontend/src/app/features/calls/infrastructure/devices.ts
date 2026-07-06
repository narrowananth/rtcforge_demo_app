import {
    checkPermissions,
    getAudioDevices,
    getUserMedia,
    getUserMediaWithOptions,
    getVideoDevices,
    onDeviceChange,
} from 'rtcforge/media'

/**
 * Thin app-facing wrapper over rtcforge's device + capture helpers. Centralises
 * the "good defaults" for a call: echo cancellation, noise suppression, and auto
 * gain on the mic, plus device pinning when the user picks a specific mic/camera.
 */

export interface DeviceOption {
    deviceId: string
    label: string
}

export type MediaKind = 'audio' | 'video'

function toOptions(devices: MediaDeviceInfo[], fallback: string): DeviceOption[] {
    return devices.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `${fallback} ${i + 1}`,
    }))
}

/** List available microphones and cameras (labels require a prior permission grant). */
export async function listDevices(): Promise<{ mics: DeviceOption[]; cams: DeviceOption[] }> {
    const [mics, cams] = await Promise.all([getAudioDevices(), getVideoDevices()])
    return {
        mics: toOptions(mics, 'Microphone'),
        cams: toOptions(cams, 'Camera'),
    }
}

/** Subscribe to device add/remove (plug in a headset, unplug a webcam). */
export const subscribeDeviceChange = onDeviceChange

/** Current camera/microphone permission states, without prompting. */
export const permissions = checkPermissions

/**
 * Capture the initial call stream with sane audio processing (echo cancellation,
 * noise suppression, auto gain). `'video'` requests camera + mic; `'audio'` mic only.
 */
export function captureCallStream(media: MediaKind): Promise<MediaStream> {
    return getUserMediaWithOptions({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: media === 'video',
    })
}

/**
 * Capture a single track pinned to `deviceId` for a live mic/camera swap. Uses
 * the full-constraints `getUserMedia` so the exact device is honoured.
 */
export async function captureTrack(kind: MediaKind, deviceId: string): Promise<MediaStreamTrack> {
    const stream = await getUserMedia(
        kind === 'audio'
            ? {
                  audio: {
                      deviceId: { exact: deviceId },
                      echoCancellation: true,
                      noiseSuppression: true,
                      autoGainControl: true,
                  },
              }
            : { video: { deviceId: { exact: deviceId } } },
    )
    return kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]
}
