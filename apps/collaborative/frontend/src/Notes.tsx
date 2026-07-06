import type { DocState } from './types'

/**
 * Shared notes. Last-writer-wins by version — simple and predictable for a demo;
 * the wire shape ({ text, version, author }) is structured so a CRDT could drop
 * in later without changing the transport. Remote updates replace the text
 * (cursor may jump mid-edit — the honest trade-off of LWW).
 */
export function Notes({ doc, onChange }: { doc: DocState; onChange: (text: string) => void }) {
    return (
        <div className="notes">
            <div className="notes-head">
                <h4>Shared notes</h4>
                <span className="muted">v{doc.version}</span>
            </div>
            <textarea
                className="notes-text"
                value={doc.text}
                placeholder="Type here — everyone in the board sees it live…"
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    )
}
