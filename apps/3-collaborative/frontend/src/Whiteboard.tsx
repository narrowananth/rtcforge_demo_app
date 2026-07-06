import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react'
import type { Cursor, Stroke } from './types'

const STROKE_WIDTH = 3

/**
 * Shared canvas. Strokes are stored in 0..1 coordinates so every client renders
 * them identically at any size. Draws committed strokes (from props) plus the
 * in-progress local stroke; overlays each remote peer's live cursor.
 */
export function Whiteboard({
    strokes,
    cursors,
    color,
    onStroke,
    onCursor,
}: {
    strokes: Stroke[]
    cursors: Array<{ id: string } & Cursor>
    color: string
    onStroke: (s: Stroke) => void
    onCursor: (x: number, y: number) => void
}) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawingRef = useRef<number[] | null>(null)
    const rafRef = useRef(0)

    const redraw = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const w = canvas.width
        const h = canvas.height
        ctx.clearRect(0, 0, w, h)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const paint = (pts: number[], c: string, width: number) => {
            if (pts.length < 2) return
            ctx.strokeStyle = c
            ctx.lineWidth = width
            ctx.beginPath()
            ctx.moveTo(pts[0] * w, pts[1] * h)
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * w, pts[i + 1] * h)
            ctx.stroke()
        }
        for (const s of strokes) paint(s.points, s.color, s.width)
        if (drawingRef.current) paint(drawingRef.current, color, STROKE_WIDTH)
    }, [strokes, color])

    // Size the canvas backing store to its displayed box (crisp lines), redraw.
    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const resize = () => {
            const rect = wrap.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            canvas.width = Math.round(rect.width * dpr)
            canvas.height = Math.round(rect.height * dpr)
            redraw()
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(wrap)
        return () => ro.disconnect()
    }, [redraw])

    useEffect(() => {
        redraw()
    }, [redraw])

    const toNorm = (e: ReactPointerEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        return [
            Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
            Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
        ]
    }

    const onDown = (e: ReactPointerEvent) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const [x, y] = toNorm(e)
        drawingRef.current = [x, y]
    }
    const onMove = (e: ReactPointerEvent) => {
        const [x, y] = toNorm(e)
        onCursor(x, y)
        if (drawingRef.current) {
            drawingRef.current.push(x, y)
            cancelAnimationFrame(rafRef.current)
            rafRef.current = requestAnimationFrame(redraw)
        }
    }
    const onUp = () => {
        const pts = drawingRef.current
        drawingRef.current = null
        if (pts && pts.length >= 2) {
            onStroke({
                id: `k_${Math.random().toString(36).slice(2, 10)}`,
                color,
                width: STROKE_WIDTH,
                points: pts,
            })
        }
    }

    return (
        <div className="whiteboard" ref={wrapRef}>
            <canvas
                ref={canvasRef}
                className="wb-canvas"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
            />
            {cursors.map((c) => (
                <div
                    key={c.id}
                    className="cursor"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                        <path
                            d="M2 2 L2 15 L6 11 L9 17 L11 16 L8 10 L14 10 Z"
                            fill={c.color}
                            stroke="#fff"
                            strokeWidth="1"
                        />
                    </svg>
                    <span className="cursor-name" style={{ background: c.color }}>
                        {c.name}
                    </span>
                </div>
            ))}
        </div>
    )
}
