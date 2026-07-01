import { API_ENDPOINTS, apiClient } from '../../../api'

export interface TransferMeta {
    filename: string
    mime: string
    size: number
}

export type TransferOffer =
    | { p2p: false }
    | { p2p: true; transferId: string; roomId: string; token: string }

export const transferGateway = {
    offer(convId: string, meta: TransferMeta): Promise<TransferOffer> {
        return apiClient.post(API_ENDPOINTS.transfers, { convId, meta })
    },
}
