'use strict'

/**
 * Multimedia blobs on disk — one file per upload plus a small sidecar of
 * metadata. Returns a stable id + public URL used inside message attachments.
 */

const path = require('node:path')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { readJson, writeJsonAtomic } = require('./atomicJson')

const EXT_BY_MIME = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/webm': 'weba',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
}

function extFor(mime, filename) {
    if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]
    const dot = filename?.lastIndexOf('.')
    if (dot > 0) {
        const ext = filename
            .slice(dot + 1)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
        if (ext && ext.length <= 5) return ext
    }
    return 'bin'
}

class MediaStore {
    async init() {
        await fsp.mkdir(config.mediaDir, { recursive: true })
        logger.info('Media store ready')
    }

    _file(id) {
        return path.join(config.mediaDir, id)
    }

    /**
     * @param {Buffer} buffer
     * @param {{ mime: string, filename?: string, uploaderId: string }} meta
     * @returns {Promise<{ id, url, mime, size, filename }>}
     */
    async save(buffer, { mime, filename, uploaderId }) {
        const id = `${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}.${extFor(mime, filename)}`
        await writeJsonAtomic(`${this._file(id)}.meta`, {
            id,
            mime,
            size: buffer.length,
            filename: filename || id,
            uploaderId,
            createdAt: Date.now(),
        })
        // The blob itself is written atomically too.
        const tmp = `${this._file(id)}.tmp`
        const handle = await fsp.open(tmp, 'w')
        try {
            await handle.writeFile(buffer)
            await handle.sync()
        } finally {
            await handle.close()
        }
        await fsp.rename(tmp, this._file(id))
        return { id, url: `/media/${id}`, mime, size: buffer.length, filename: filename || id }
    }

    async metadata(id) {
        return readJson(`${this._file(id)}.meta`, null)
    }

    /** Absolute path to a stored blob (validated id only). */
    pathFor(id) {
        if (!/^[\w.]+$/.test(id)) return null // no traversal
        return this._file(id)
    }
}

module.exports = { MediaStore }
