import { getPayloadClient } from './index.js';

/** A collection's record for one user (unique keycloak_sub), or null. */
export async function findByKcSub(collection, kcSub) {
    const { docs } = await getPayloadClient().find({ collection, where: { keycloak_sub: { equals: kcSub } }, limit: 1, depth: 0 });
    return docs[0] ?? null;
}

/**
 * Update the user's record, creating it if there is none. Two calls at once both find none;
 * the unique keycloak_sub refuses the second create, which then updates the first one's record.
 */
export async function upsertByKcSub(collection, kcSub, data) {
    const payload = getPayloadClient();
    const existing = await findByKcSub(collection, kcSub);
    if (existing) return payload.update({ collection, id: existing.id, data });
    try {
        return await payload.create({ collection, data: { keycloak_sub: kcSub, ...data } });
    } catch (err) {
        const winner = await findByKcSub(collection, kcSub);
        if (!winner) throw err;
        return payload.update({ collection, id: winner.id, data });
    }
}
