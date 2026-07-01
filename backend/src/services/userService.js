'use strict'

/**
 * Accounts + contacts. Registration/login issue signed session tokens; contacts
 * are a per-user convenience list (one-directional, like a phone address book).
 */

const crypto = require('node:crypto')
const config = require('../config')
const { hashPassword, verifyPassword } = require('../auth/password')
const { issueToken } = require('../auth/token')

const AVATAR_COLORS = [
    '#e57373',
    '#f06292',
    '#ba68c8',
    '#7986cb',
    '#4fc3f7',
    '#4db6ac',
    '#81c784',
    '#ffb74d',
    '#a1887f',
    '#90a4ae',
]

class ValidationError extends Error {
    constructor(message) {
        super(message)
        this.status = 400
    }
}

function validateUsername(username) {
    if (typeof username !== 'string') throw new ValidationError('Username required')
    const u = username.trim()
    if (u.length < config.minUsernameLength || u.length > config.maxUsernameLength) {
        throw new ValidationError(
            `Username must be ${config.minUsernameLength}-${config.maxUsernameLength} characters`,
        )
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(u))
        throw new ValidationError('Username may use letters, numbers, _ and .')
    return u
}

function createUserService({ userStore }) {
    function publicUser(user) {
        if (!user) return null
        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarColor: user.avatarColor,
        }
    }

    async function register({ username, password, displayName }) {
        const u = validateUsername(username)
        if (typeof password !== 'string' || password.length < config.minPasswordLength) {
            throw new ValidationError(
                `Password must be at least ${config.minPasswordLength} characters`,
            )
        }
        const name = (displayName && String(displayName).trim()) || u
        if (name.length > config.maxDisplayNameLength)
            throw new ValidationError('Display name too long')
        if (userStore.usernameTaken(u)) throw new ValidationError('Username already taken')

        const user = {
            id: `u_${crypto.randomBytes(9).toString('hex')}`,
            username: u,
            usernameLower: u.toLowerCase(),
            displayName: name,
            avatarColor: AVATAR_COLORS[crypto.randomBytes(1)[0] % AVATAR_COLORS.length],
            passwordHash: await hashPassword(password),
            contacts: [],
            conversations: [],
            createdAt: Date.now(),
        }
        await userStore.create(user)
        return {
            user: publicUser(user),
            token: issueToken({
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
            }),
        }
    }

    async function login({ username, password }) {
        const user = await userStore.getByUsername(String(username || '').trim())
        const ok = user && (await verifyPassword(password, user.passwordHash))
        if (!ok) {
            const err = new Error('Invalid username or password')
            err.status = 401
            throw err
        }
        return {
            user: publicUser(user),
            token: issueToken({
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
            }),
        }
    }

    async function addContact(userId, contactUsername) {
        const contact = await userStore.getByUsername(String(contactUsername || '').trim())
        if (!contact) throw new ValidationError('No such user')
        if (contact.id === userId) throw new ValidationError('You cannot add yourself')
        await userStore.update(userId, (u) => {
            if (!u.contacts.includes(contact.id)) u.contacts.push(contact.id)
        })
        return publicUser(contact)
    }

    async function listContacts(userId) {
        const user = await userStore.getById(userId)
        if (!user) return []
        const contacts = await Promise.all(user.contacts.map((id) => userStore.getById(id)))
        return contacts.filter(Boolean).map(publicUser)
    }

    async function search(username) {
        const user = await userStore.getByUsername(String(username || '').trim())
        return publicUser(user)
    }

    return { publicUser, register, login, addContact, listContacts, search, validateUsername }
}

module.exports = { createUserService, ValidationError }
