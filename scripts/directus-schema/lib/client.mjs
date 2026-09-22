/**
 * Minimal Directus admin REST helper for schema ensure scripts.
 * Never import this into the BFF request path.
 */

export function createDirectusAdminClient({ url, token }) {
    const base = String(url || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new Error('DIRECTUS_URL is required');
    }
    if (!token) {
        throw new Error('Schema admin token is required');
    }

    async function request(method, apiPath, body) {
        const res = await fetch(`${base}${apiPath}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                ...(body != null ? { 'Content-Type': 'application/json' } : {})
            },
            body: body != null ? JSON.stringify(body) : undefined
        });
        let json = null;
        try {
            json = await res.json();
        } catch {
            json = null;
        }
        if (!res.ok) {
            const msg =
                json?.errors?.[0]?.message
                || json?.message
                || `${method} ${apiPath} → ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.body = json;
            throw err;
        }
        return json?.data !== undefined ? json.data : json;
    }

    return {
        base,
        get: (apiPath) => request('GET', apiPath),
        post: (apiPath, body) => request('POST', apiPath, body),
        patch: (apiPath, body) => request('PATCH', apiPath, body),
        request
    };
}
