import type { Room } from 'rtcforge/client'
import { Call, MediaEvent } from 'rtcforge/media'
import { iceForRoom } from './ice'

/**
 * P2P mesh call wrapper over rtcforge's browser `Call` (2–4 peers: each client
 * sends its stream directly to every other, lowest latency, no server media).
 * Deliberately exposes the SAME surface as `SfuClient`
 * (onRemoteStream/onRemoteStreamRemoved + mute/screen/close) so a meeting UI can
 * treat the mesh and SFU planes uniformly and switch by room size.
 */
export class MeshCall {
    onRemoteStream?: (peerId: string, stream: MediaStream) => void
    onRemoteStreamRemoved?: (peerId: string) => void
    onActiveSpeaker?: (peerId: string | null, level: number) => void

    private readonly call: Call
    private screenTrack: MediaStreamTrack | null = null

    constructor(room: Room, localStream: MediaStream) {
        this.call = new Call(room, { stream: localStream, iceServers: iceForRoom(room) })
        room.bindCall(this.call)
    }

    start(): void {
        this.call.on(MediaEvent.RemoteStream, (peerId, stream) =>
            this.onRemoteStream?.(peerId, stream),
        )
        this.call.on(MediaEvent.RemoteStreamRemoved, (peerId) =>
            this.onRemoteStreamRemoved?.(peerId),
        )
        this.call.on(MediaEvent.ActiveSpeaker, (peerId, level) =>
            this.onActiveSpeaker?.(peerId, level),
        )
        this.call.start()
        this.call.startActiveSpeakerDetection()
    }

    setAudioEnabled(on: boolean): void {
        if (on) this.call.unmuteAudio()
        else this.call.muteAudio()
    }
    setVideoEnabled(on: boolean): void {
        if (on) this.call.unmuteVideo()
        else this.call.muteVideo()
    }

    async addScreenTrack(track: MediaStreamTrack): Promise<void> {
        this.screenTrack = track
        this.call.addScreenTrack(track, new MediaStream([track]))
    }
    removeScreenTrack(): void {
        if (this.screenTrack) {
            this.call.removeTrack(this.screenTrack)
            this.screenTrack.stop()
            this.screenTrack = null
        }
    }

    close(): void {
        this.call.stopActiveSpeakerDetection()
        this.call.close()
    }
}
