'use strict'

/**
 * REST API. Commands (register/login/send/edit/delete/react/upload/group mgmt)
 * go over HTTP; realtime server→client events are pushed over the signaling
 * inbox by the services/hub. Every mutating route that affects other users also
 * pushes the corresponding conversation-lifecycle event.
 */

const express = require('express')
const config = require('../config')
const { authRequired, asyncHandler } = require('./middleware')

function createApiRouter({ services, stores, hub }) {
    const { userService, conversationService, messageService, callService, transferService } =
        services
    const { conversationStore, mediaStore } = stores
    const router = express.Router()

    // --- Auth (public) -------------------------------------------------------
    router.post(
        '/auth/register',
        asyncHandler(async (req, res) => {
            const { username, password, displayName } = req.body || {}
            res.json(await userService.register({ username, password, displayName }))
        }),
    )

    router.post(
        '/auth/login',
        asyncHandler(async (req, res) => {
            const { username, password } = req.body || {}
            res.json(await userService.login({ username, password }))
        }),
    )

    // --- Everything below requires auth --------------------------------------
    router.use(authRequired)

    router.get(
        '/me',
        asyncHandler(async (req, res) => {
            const user = await stores.userStore.getById(req.user.userId)
            res.json({ user: userService.publicUser(user) })
        }),
    )

    // Contacts
    router.get(
        '/contacts',
        asyncHandler(async (req, res) => {
            res.json({ contacts: await userService.listContacts(req.user.userId) })
        }),
    )
    router.post(
        '/contacts',
        asyncHandler(async (req, res) => {
            const contact = await userService.addContact(req.user.userId, req.body?.username)
            res.json({ contact })
        }),
    )
    router.get(
        '/users/:username',
        asyncHandler(async (req, res) => {
            const user = await userService.search(req.params.username)
            if (!user) return res.status(404).json({ error: 'No such user' })
            res.json({ user })
        }),
    )

    // Presence
    router.get(
        '/presence',
        asyncHandler(async (req, res) => {
            const ids = String(req.query.ids || '')
                .split(',')
                .filter(Boolean)
            res.json({ online: ids.filter((id) => hub.isOnline(id)) })
        }),
    )

    // Conversations
    router.get(
        '/conversations',
        asyncHandler(async (req, res) => {
            res.json({ conversations: await conversationService.listForUser(req.user.userId) })
        }),
    )

    async function loadMemberConv(req) {
        const conv = await conversationStore.get(req.params.id)
        if (!conv || !conversationService.isMember(conv, req.user.userId)) {
            const err = new Error('Conversation not found')
            err.status = 404
            throw err
        }
        return conv
    }

    router.get(
        '/conversations/:id',
        asyncHandler(async (req, res) => {
            const conv = await loadMemberConv(req)
            res.json({ conversation: await conversationService.view(req.user.userId, conv) })
        }),
    )

    router.post(
        '/conversations/dm',
        asyncHandler(async (req, res) => {
            const conv = await conversationService.getOrCreateDm(req.user.userId, req.body?.userId)
            const otherId = conv.members.find((m) => m !== req.user.userId)
            hub.pushToUser(otherId, { type: 'conversation-added', convId: conv.id })
            res.json({ conversation: await conversationService.view(req.user.userId, conv) })
        }),
    )

    router.post(
        '/conversations/group',
        asyncHandler(async (req, res) => {
            const conv = await conversationService.createGroup(req.user.userId, {
                title: req.body?.title,
                memberIds: req.body?.memberIds,
            })
            for (const m of conv.members) {
                if (m !== req.user.userId)
                    hub.pushToUser(m, { type: 'conversation-added', convId: conv.id })
            }
            res.json({ conversation: await conversationService.view(req.user.userId, conv) })
        }),
    )

    router.post(
        '/conversations/broadcast',
        asyncHandler(async (req, res) => {
            const conv = await conversationService.createBroadcast(req.user.userId, {
                title: req.body?.title,
                memberIds: req.body?.memberIds,
            })
            res.json({ conversation: await conversationService.view(req.user.userId, conv) })
        }),
    )

    router.post(
        '/conversations/:id/members',
        asyncHandler(async (req, res) => {
            const conv = await loadMemberConv(req)
            const { conv: updated, added } = await conversationService.addMembers(
                conv,
                req.user.userId,
                req.body?.memberIds || [],
            )
            for (const m of added)
                hub.pushToUser(m, { type: 'conversation-added', convId: conv.id })
            for (const m of updated.members) {
                if (!added.includes(m))
                    hub.pushToUser(m, { type: 'conversation-updated', convId: conv.id })
            }
            res.json({ conversation: await conversationService.view(req.user.userId, updated) })
        }),
    )

    router.delete(
        '/conversations/:id/members/:userId',
        asyncHandler(async (req, res) => {
            const conv = await loadMemberConv(req)
            const target = req.params.userId
            const updated = await conversationService.removeMember(conv, req.user.userId, target)
            hub.pushToUser(target, { type: 'conversation-removed', convId: conv.id })
            for (const m of updated.members)
                hub.pushToUser(m, { type: 'conversation-updated', convId: conv.id })
            res.json({ ok: true })
        }),
    )

    router.patch(
        '/conversations/:id',
        asyncHandler(async (req, res) => {
            const conv = await loadMemberConv(req)
            const updated = await conversationService.rename(conv, req.user.userId, req.body?.title)
            for (const m of updated.members)
                hub.pushToUser(m, { type: 'conversation-updated', convId: conv.id })
            res.json({ conversation: await conversationService.view(req.user.userId, updated) })
        }),
    )

    // Messages
    router.get(
        '/conversations/:id/messages',
        asyncHandler(async (req, res) => {
            const limit = Math.min(Number(req.query.limit) || 100, 200)
            const before = req.query.before ? Number(req.query.before) : undefined
            const messages = await messageService.history(req.user.userId, req.params.id, {
                limit,
                before,
            })
            res.json({ messages })
        }),
    )

    router.post(
        '/conversations/:id/messages',
        asyncHandler(async (req, res) => {
            const message = await messageService.send(
                req.user.userId,
                req.params.id,
                req.body || {},
            )
            res.json({ message })
        }),
    )

    router.patch(
        '/conversations/:id/messages/:msgId',
        asyncHandler(async (req, res) => {
            const message = await messageService.edit(
                req.user.userId,
                req.params.id,
                req.params.msgId,
                req.body?.text,
            )
            res.json({ message })
        }),
    )

    router.delete(
        '/conversations/:id/messages/:msgId',
        asyncHandler(async (req, res) => {
            await messageService.remove(req.user.userId, req.params.id, req.params.msgId)
            res.json({ ok: true })
        }),
    )

    router.post(
        '/conversations/:id/messages/:msgId/reactions',
        asyncHandler(async (req, res) => {
            const message = await messageService.react(
                req.user.userId,
                req.params.id,
                req.params.msgId,
                req.body?.emoji,
            )
            res.json({ message })
        }),
    )

    // Peer-to-peer media transfer — broker a data-channel session (falls back to
    // HTTP media store when the peer is offline).
    router.post(
        '/transfers',
        asyncHandler(async (req, res) => {
            res.json(await transferService.offer(req.user.userId, req.body?.convId, req.body?.meta))
        }),
    )

    // Calls (Phase 2) — signaling lifecycle; media flows P2P via rtcforge-media.
    router.post(
        '/calls',
        asyncHandler(async (req, res) => {
            res.json(await callService.place(req.user.userId, req.body?.convId, req.body?.media))
        }),
    )
    router.post(
        '/calls/:id/accept',
        asyncHandler(async (req, res) => {
            res.json(await callService.accept(req.params.id, req.user.userId))
        }),
    )
    router.post(
        '/calls/:id/decline',
        asyncHandler(async (req, res) => {
            callService.decline(req.params.id, req.user.userId)
            res.json({ ok: true })
        }),
    )
    router.post(
        '/calls/:id/end',
        asyncHandler(async (req, res) => {
            callService.end(req.params.id, req.user.userId)
            res.json({ ok: true })
        }),
    )

    // Media upload — raw binary body (no multipart dep); metadata via headers.
    router.post(
        '/media',
        express.raw({ type: () => true, limit: config.maxUploadBytes }),
        asyncHandler(async (req, res) => {
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ error: 'Empty upload' })
            }
            const mime = req.headers['content-type'] || 'application/octet-stream'
            const filename = decodeURIComponent(req.headers['x-filename'] || 'file')
            const attachment = await mediaStore.save(req.body, {
                mime,
                filename,
                uploaderId: req.user.userId,
            })
            res.json({ attachment })
        }),
    )

    return router
}

module.exports = { createApiRouter }
