import { useEffect, useRef, useState } from 'react'
import { createSpeakingDetector } from './speaking'

/**
 * One participant tile: attaches the MediaStream, lights a ring while the person
 * is speaking, and (for the host) exposes mute-request + kick controls on remote
 * tiles.
 */
export function VideoTile({
    stream,
    name,
    muted,
    isSelf,
    canModerate,
    onKick,
    onMuteRequest,
}: {
    stream: MediaStream | null
    name: string
    muted?: boolean
    isSelf?: boolean
    canModerate?: boolean
    onKick?: () => void
    onMuteRequest?: () => void
}) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [speaking, setSpeaking] = useState(false)
    const hasVideo = !!stream && stream.getVideoTracks().length > 0

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
    }, [stream])

    useEffect(() => {
        if (!stream) return
        return createSpeakingDetector(stream, setSpeaking)
    }, [stream])

    return (
        <div className={`tile${speaking ? ' speaking' : ''}`}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted || isSelf}
                className="tile-video"
            />
            {!hasVideo && (
                <div className="tile-avatar">
                    <span>{name.slice(0, 1).toUpperCase()}</span>
                </div>
            )}
            <div className="tile-label">
                {name}
                {isSelf && ' (you)'}
            </div>
            {canModerate && !isSelf && (
                <div className="tile-mod">
                    <button type="button" title="Ask to mute" onClick={onMuteRequest}>
                        🔇
                    </button>
                    <button type="button" title="Remove" className="danger" onClick={onKick}>
                        ⨯
                    </button>
                </div>
            )}
        </div>
    )
}
