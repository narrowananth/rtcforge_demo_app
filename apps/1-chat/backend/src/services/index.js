'use strict'

const { createUserService } = require('./userService')
const { createConversationService } = require('./conversationService')
const { createMessageService } = require('./messageService')
const { createCallService } = require('./callService')
const { createTransferService } = require('./transferService')

/** Assemble the service layer, wiring cross-service dependencies. */
function createServices({ userStore, conversationStore, messageStore, hub }) {
    const userService = createUserService({ userStore })
    const conversationService = createConversationService({
        userStore,
        conversationStore,
        userService,
    })
    const messageService = createMessageService({
        userStore,
        conversationStore,
        conversationService,
        messageStore,
        hub,
    })
    const callService = createCallService({
        userStore,
        conversationStore,
        conversationService,
        hub,
    })
    const transferService = createTransferService({
        userStore,
        conversationStore,
        conversationService,
        hub,
    })
    return { userService, conversationService, messageService, callService, transferService }
}

module.exports = { createServices }
