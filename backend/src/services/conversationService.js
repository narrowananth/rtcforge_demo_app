'use strict'

/**
 * Conversation lifecycle + membership for the three WhatsApp chat types:
 *   - dm        : exactly two members, deterministic id
 *   - group     : many members, admins can manage, everyone posts
 *   - broadcast : a sender-owned recipient list; posts fan out to per-recipient
 *                 DMs (handled in messageService)
 */

const crypto = require('node:crypto')
const config = require('../config')
const { dmId } = require('../store/conversationStore')
const { ValidationError } = require('./userService')

const GROUP_COLORS = ['#26a69a', '#5c6bc0', '#ec407a', '#ab47bc', '#ff7043', '#66bb6a']

function createConversationService({ userStore, conversationStore, userService }) {
    function pickColor(seed) {
        return GROUP_COLORS[
            crypto.createHash('sha1').update(seed).digest()[0] % GROUP_COLORS.length
        ]
    }

    async function _addToUserList(userId, convId) {
        await userStore.update(userId, (u) => {
            if (!u.conversations.includes(convId)) u.conversations.push(convId)
        })
    }

    async function _removeFromUserList(userId, convId) {
        await userStore.update(userId, (u) => {
            u.conversations = u.conversations.filter((c) => c !== convId)
        })
    }

    async function getOrCreateDm(userId, otherId) {
        if (userId === otherId) throw new ValidationError('Cannot DM yourself')
        const other = await userStore.getById(otherId)
        if (!other) throw new ValidationError('No such user')
        const id = dmId(userId, otherId)
        let conv = await conversationStore.get(id)
        if (!conv) {
            conv = {
                id,
                type: 'dm',
                title: '',
                avatarColor: null,
                members: [userId, otherId].sort(),
                admins: [],
                createdBy: userId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                lastMessage: null,
            }
            await conversationStore.put(conv)
            await _addToUserList(userId, id)
            await _addToUserList(otherId, id)
        }
        return conv
    }

    async function createGroup(creatorId, { title, memberIds }) {
        const t = String(title || '').trim()
        if (t.length < 1 || t.length > config.maxGroupTitleLength)
            throw new ValidationError('Group title required')
        const members = [...new Set([creatorId, ...(memberIds || [])])]
        if (members.length > config.maxGroupMembers) throw new ValidationError('Too many members')
        for (const m of members) {
            if (!(await userStore.getById(m))) throw new ValidationError(`Unknown member: ${m}`)
        }
        const conv = {
            id: `g_${crypto.randomBytes(10).toString('hex')}`,
            type: 'group',
            title: t,
            avatarColor: pickColor(t),
            members,
            admins: [creatorId],
            createdBy: creatorId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessage: null,
        }
        await conversationStore.put(conv)
        await Promise.all(members.map((m) => _addToUserList(m, conv.id)))
        return conv
    }

    async function createBroadcast(creatorId, { title, memberIds }) {
        const t = String(title || '').trim() || 'Broadcast list'
        const recipients = [...new Set(memberIds || [])].filter((id) => id !== creatorId)
        if (recipients.length === 0) throw new ValidationError('Add at least one recipient')
        for (const m of recipients) {
            if (!(await userStore.getById(m))) throw new ValidationError(`Unknown recipient: ${m}`)
        }
        const conv = {
            id: `b_${crypto.randomBytes(10).toString('hex')}`,
            type: 'broadcast',
            title: t,
            avatarColor: pickColor(t),
            members: recipients, // recipients; owner tracked separately
            admins: [creatorId],
            createdBy: creatorId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessage: null,
        }
        await conversationStore.put(conv)
        await _addToUserList(creatorId, conv.id) // visible only to the owner
        return conv
    }

    function isMember(conv, userId) {
        if (!conv) return false
        if (conv.type === 'broadcast') return conv.admins.includes(userId)
        return conv.members.includes(userId)
    }

    function isAdmin(conv, userId) {
        return !!conv && conv.admins.includes(userId)
    }

    async function addMembers(conv, actorId, memberIds) {
        if (conv.type !== 'group') throw new ValidationError('Only groups support members')
        if (!isAdmin(conv, actorId)) throw new ValidationError('Only admins can add members')
        const added = []
        const updated = await conversationStore.update(conv.id, (c) => {
            for (const id of memberIds || []) {
                if (!c.members.includes(id)) {
                    c.members.push(id)
                    added.push(id)
                }
            }
        })
        await Promise.all(added.map((id) => _addToUserList(id, conv.id)))
        return { conv: updated, added }
    }

    async function removeMember(conv, actorId, memberId) {
        if (conv.type !== 'group') throw new ValidationError('Only groups support members')
        const selfLeave = actorId === memberId
        if (!selfLeave && !isAdmin(conv, actorId))
            throw new ValidationError('Only admins can remove members')
        const updated = await conversationStore.update(conv.id, (c) => {
            c.members = c.members.filter((m) => m !== memberId)
            c.admins = c.admins.filter((a) => a !== memberId)
        })
        await _removeFromUserList(memberId, conv.id)
        return updated
    }

    async function rename(conv, actorId, title) {
        if (conv.type === 'dm') throw new ValidationError('Cannot rename a DM')
        if (!isAdmin(conv, actorId)) throw new ValidationError('Only admins can rename')
        const t = String(title || '').trim()
        if (!t || t.length > config.maxGroupTitleLength) throw new ValidationError('Invalid title')
        return conversationStore.update(conv.id, (c) => {
            c.title = t
        })
    }

    /** Build a client-facing conversation view for `userId`. */
    async function view(userId, conv) {
        const memberUsers = (await Promise.all(conv.members.map((id) => userStore.getById(id))))
            .filter(Boolean)
            .map(userService.publicUser)
        let title = conv.title
        let avatarColor = conv.avatarColor
        let otherUser = null
        if (conv.type === 'dm') {
            const otherId = conv.members.find((m) => m !== userId)
            otherUser = memberUsers.find((m) => m.id === otherId) || null
            title = otherUser ? otherUser.displayName : 'Unknown'
            avatarColor = otherUser ? otherUser.avatarColor : '#888'
        }
        return {
            id: conv.id,
            type: conv.type,
            title,
            avatarColor,
            members: memberUsers,
            admins: conv.admins,
            createdBy: conv.createdBy,
            otherUser,
            lastMessage: conv.lastMessage || null,
            updatedAt: conv.updatedAt,
        }
    }

    async function listForUser(userId) {
        const user = await userStore.getById(userId)
        if (!user) return []
        const convs = (
            await Promise.all(user.conversations.map((id) => conversationStore.get(id)))
        ).filter(Boolean)
        const views = await Promise.all(convs.map((c) => view(userId, c)))
        return views.sort(
            (a, b) => (b.lastMessage?.ts || b.updatedAt) - (a.lastMessage?.ts || a.updatedAt),
        )
    }

    return {
        getOrCreateDm,
        createGroup,
        createBroadcast,
        addMembers,
        removeMember,
        rename,
        isMember,
        isAdmin,
        view,
        listForUser,
    }
}

module.exports = { createConversationService }
