'use strict'

/**
 * Messaging core: send / edit / delete / react / reply / history, plus the
 * broadcast-list fanout. Every mutation persists to the message store and is
 * pushed to the relevant users' inboxes via the realtime hub.
 *
 * Message shape:
 *   { id, convId, senderId, senderName, senderAvatar, type,
 *     text, attachment, replyTo, replyPreview, reactions:{emoji:[userId]},
 *     editedAt, deletedAt, viaBroadcast, broadcastListId, ts }
 */

const crypto = require('node:crypto')
const config = require('../config')
const { ValidationError } = require('./userService')

const MESSAGE_TYPES = new Set(['text', 'image', 'file', 'audio', 'video'])

function previewOf(msg) {
    if (msg.deletedAt) return '🚫 This message was deleted'
    if (msg.type === 'text') return (msg.text || '').slice(0, 120)
    switch (msg.type) {
        case 'image':
            return '📷 Photo'
        case 'video':
            return '🎥 Video'
        case 'audio':
            return '🎙️ Voice message'
        case 'file':
            return `📎 ${msg.attachment?.filename || 'File'}`
        default:
            return ''
    }
}

function createMessageService({
    userStore,
    conversationStore,
    conversationService,
    messageStore,
    hub,
}) {
    async function _senderMeta(senderId) {
        const u = await userStore.getById(senderId)
        return {
            senderName: u ? u.displayName : 'Unknown',
            senderAvatar: u ? u.avatarColor : '#888',
        }
    }

    function _validatePayload(payload) {
        const type = payload.type || 'text'
        if (!MESSAGE_TYPES.has(type)) throw new ValidationError('Invalid message type')
        const text = typeof payload.text === 'string' ? payload.text.replace(/\s+$/g, '') : ''
        if (type === 'text') {
            if (!text) throw new ValidationError('Empty message')
            if (text.length > config.maxMessageLength) throw new ValidationError('Message too long')
        } else {
            const a = payload.attachment
            // Either an HTTP-stored blob (url) or a peer-to-peer transfer (p2p + transferId).
            const ok = a && (a.url || (a.p2p && a.transferId))
            if (!ok) throw new ValidationError(`Attachment required for ${type}`)
        }
        return { type, text }
    }

    async function _buildMessage(convId, senderId, payload) {
        const { type, text } = _validatePayload(payload)
        const meta = await _senderMeta(senderId)
        let replyPreview = null
        if (payload.replyTo) {
            const target = await messageStore.getById(convId, payload.replyTo)
            if (target) {
                replyPreview = {
                    id: target.id,
                    senderName: target.senderName,
                    preview: previewOf(target),
                }
            }
        }
        return {
            id: `m_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`,
            convId,
            senderId,
            senderName: meta.senderName,
            senderAvatar: meta.senderAvatar,
            type,
            text: type === 'text' ? text : text || '',
            attachment: type === 'text' ? null : sanitizeAttachment(payload.attachment),
            replyTo: payload.replyTo || null,
            replyPreview,
            reactions: {},
            editedAt: null,
            deletedAt: null,
            viaBroadcast: false,
            broadcastListId: null,
            ts: Date.now(),
        }
    }

    function sanitizeAttachment(a) {
        return {
            id: a.id,
            url: a.url || null,
            mime: a.mime,
            size: a.size,
            filename: a.filename,
            width: a.width,
            height: a.height,
            durationMs: a.durationMs,
            p2p: !!a.p2p, // bytes were sent peer-to-peer (not stored server-side)
            transferId: a.transferId || null,
        }
    }

    async function _touchConversation(convId, msg) {
        await conversationStore.update(convId, (c) => {
            c.lastMessage = {
                preview: previewOf(msg),
                ts: msg.ts,
                senderId: msg.senderId,
                senderName: msg.senderName,
            }
        })
    }

    async function _deliver(conv, msg, recipientIds) {
        await messageStore.append(conv.id, msg)
        await _touchConversation(conv.id, msg)
        hub.pushToUsers(recipientIds, { type: 'message', message: msg })
        return msg
    }

    async function send(senderId, convId, payload) {
        const conv = await conversationStore.get(convId)
        if (!conv) throw new ValidationError('No such conversation')
        if (!conversationService.isMember(conv, senderId))
            throw new ValidationError('Not a member of this conversation')

        if (conv.type === 'broadcast') return _sendBroadcast(senderId, conv, payload)

        const msg = await _buildMessage(convId, senderId, payload)
        return _deliver(conv, msg, conv.members)
    }

    async function _sendBroadcast(senderId, broadcastConv, payload) {
        // Store a copy in the broadcast list (owner's record)…
        const listMsg = await _buildMessage(broadcastConv.id, senderId, payload)
        listMsg.viaBroadcast = true
        listMsg.broadcastListId = broadcastConv.id
        await _deliver(broadcastConv, listMsg, [senderId])

        // …and fan out to each recipient's DM with the sender.
        for (const recipientId of broadcastConv.members) {
            const dm = await conversationService.getOrCreateDm(senderId, recipientId)
            const dmMsg = await _buildMessage(dm.id, senderId, payload)
            dmMsg.viaBroadcast = true
            dmMsg.broadcastListId = broadcastConv.id
            await _deliver(dm, dmMsg, dm.members)
        }
        return listMsg
    }

    async function edit(userId, convId, msgId, newText) {
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, userId))
            throw new ValidationError('Not allowed')
        const text = String(newText || '').replace(/\s+$/g, '')
        if (!text) throw new ValidationError('Empty message')
        if (text.length > config.maxMessageLength) throw new ValidationError('Message too long')

        const updated = await messageStore.update(convId, msgId, (m) => {
            if (m.senderId !== userId)
                throw new ValidationError('You can only edit your own messages')
            if (m.deletedAt) throw new ValidationError('Cannot edit a deleted message')
            if (m.type !== 'text') throw new ValidationError('Only text messages can be edited')
            m.text = text
            m.editedAt = Date.now()
        })
        if (!updated) throw new ValidationError('Message not found')
        hub.pushToUsers(conv.members, {
            type: 'message-edited',
            convId,
            id: msgId,
            text,
            editedAt: updated.editedAt,
        })
        return updated
    }

    async function remove(userId, convId, msgId) {
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, userId))
            throw new ValidationError('Not allowed')
        const updated = await messageStore.update(convId, msgId, (m) => {
            const canDelete = m.senderId === userId || conversationService.isAdmin(conv, userId)
            if (!canDelete) throw new ValidationError('Not allowed to delete this message')
            m.deletedAt = Date.now()
            m.text = ''
            m.attachment = null
            m.reactions = {}
            m.replyPreview = null
        })
        if (!updated) throw new ValidationError('Message not found')
        hub.pushToUsers(conv.members, { type: 'message-deleted', convId, id: msgId })
        return updated
    }

    async function react(userId, convId, msgId, emoji) {
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, userId))
            throw new ValidationError('Not allowed')
        const e = String(emoji || '').trim()
        if (!e || [...e].length > 8) throw new ValidationError('Invalid reaction')

        const updated = await messageStore.update(convId, msgId, (m) => {
            if (m.deletedAt) throw new ValidationError('Cannot react to a deleted message')
            const list = m.reactions[e] || []
            if (list.includes(userId)) {
                m.reactions[e] = list.filter((id) => id !== userId)
                if (m.reactions[e].length === 0) delete m.reactions[e]
            } else {
                m.reactions[e] = [...list, userId]
            }
        })
        if (!updated) throw new ValidationError('Message not found')
        hub.pushToUsers(conv.members, {
            type: 'message-reaction',
            convId,
            id: msgId,
            reactions: updated.reactions,
        })
        return updated
    }

    async function history(userId, convId, opts) {
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, userId))
            throw new ValidationError('Not allowed')
        return messageStore.history(convId, opts)
    }

    return { send, edit, remove, react, history, previewOf }
}

module.exports = { createMessageService }
