export interface PublicUser {
    id: string
    username: string
    displayName: string
    avatarColor: string
}

export type ConversationType = 'dm' | 'group' | 'broadcast'

export interface LastMessage {
    preview: string
    ts: number
    senderId: string
    senderName: string
}

export interface Conversation {
    id: string
    type: ConversationType
    title: string
    avatarColor: string | null
    members: PublicUser[]
    admins: string[]
    createdBy: string
    otherUser: PublicUser | null
    lastMessage: LastMessage | null
    updatedAt: number
}

export type MessageType = 'text' | 'image' | 'file' | 'audio' | 'video'

export interface Attachment {
    id?: string
    url?: string | null
    mime?: string
    size?: number
    filename?: string
    p2p?: boolean
    transferId?: string | null
}

export interface ReplyPreview {
    id: string
    senderName: string
    preview: string
}

export interface Message {
    id: string
    convId: string
    senderId: string
    senderName: string
    senderAvatar: string
    type: MessageType
    text: string
    attachment: Attachment | null
    replyTo: string | null
    replyPreview: ReplyPreview | null
    reactions: Record<string, string[]>
    editedAt: number | null
    deletedAt: number | null
    viaBroadcast: boolean
    ts: number
}

export interface Session {
    user: PublicUser
    token: string
}

/** Realtime events pushed over the inbox channel. */
export type InboxEvent =
    | { type: 'message'; message: Message }
    | { type: 'message-edited'; convId: string; id: string; text: string; editedAt: number }
    | { type: 'message-deleted'; convId: string; id: string }
    | { type: 'message-reaction'; convId: string; id: string; reactions: Record<string, string[]> }
    | { type: 'conversation-added'; convId: string }
    | { type: 'conversation-updated'; convId: string }
    | { type: 'conversation-removed'; convId: string }
    | { type: 'presence'; userId: string; online: boolean; ts: number }
    | {
          type: 'call-incoming'
          callId: string
          callRoomId: string
          convId: string
          media: CallMedia
          from: CallPeer
      }
    | { type: 'call-accepted'; callId: string; by: { id: string; name: string } }
    | { type: 'call-declined'; callId: string; by: string }
    | { type: 'call-ended'; callId: string; reason?: string }
    | {
          type: 'p2p-incoming'
          transferId: string
          roomId: string
          token: string
          meta: { filename: string; mime: string; size: number }
          from: { id: string; name: string }
          convId: string
      }

export type CallMedia = 'audio' | 'video'
export interface CallPeer {
    id: string
    name: string
    avatar?: string
}
