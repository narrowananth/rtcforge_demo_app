import type { Conversation, PublicUser } from '../../../shared/types'
import { contactGateway } from '../infrastructure/contact-gateway'

/**
 * People you can group/broadcast with: explicit contacts PLUS everyone you
 * already share a conversation with (DM peers, group members). Relying on the
 * contacts list alone leaves the picker empty for received DMs.
 */
export async function loadKnownPeople(
    conversations: Conversation[],
    meId: string,
): Promise<PublicUser[]> {
    let contacts: PublicUser[] = []
    try {
        ;({ contacts } = await contactGateway.list())
    } catch {
        contacts = []
    }
    const map = new Map<string, PublicUser>(contacts.map((c) => [c.id, c]))
    for (const conv of conversations) {
        if (conv.type === 'broadcast') continue
        if (conv.type === 'dm' && conv.otherUser) map.set(conv.otherUser.id, conv.otherUser)
        for (const m of conv.members) if (m.id !== meId && !map.has(m.id)) map.set(m.id, m)
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}
