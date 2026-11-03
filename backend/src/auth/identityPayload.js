export function buildIdentityPayload(_userId) {
    return {
        directusLinked:       false,
        directusUserId:       null,
        directusLinkRequired: false
    };
}
