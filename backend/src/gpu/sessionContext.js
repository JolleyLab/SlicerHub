const userContexts = new Map();

export function setUserTrameContext(userId, context) {
    if (!context) {
        userContexts.delete(String(userId));
        return;
    }
    userContexts.set(String(userId), context);
}

export function getUserTrameContext(userId) {
    return userContexts.get(String(userId)) || null;
}

export function resolveLocalTrameServiceUrl() {
    return process.env.TRAME_SERVICE_URL || 'http://localhost:8090';
}

export function resolveTrameServiceUrl(userId) {
    const ctx = getUserTrameContext(userId);
    if (ctx?.trameServiceUrl) return ctx.trameServiceUrl;
    return resolveLocalTrameServiceUrl();
}
