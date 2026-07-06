/** A finished pen stroke. `points` is a flat [x0,y0,x1,y1,…] list in 0..1 board
 * coordinates (resolution-independent so every client renders it identically). */
export interface Stroke {
    id: string
    color: string
    width: number
    points: number[]
}

export interface Member {
    id: string
    name: string
    color: string
}

export interface Cursor {
    x: number
    y: number
    name: string
    color: string
}

/** Shared notes doc — last-writer-wins by monotonically increasing version. */
export interface DocState {
    text: string
    version: number
    author: string
}
