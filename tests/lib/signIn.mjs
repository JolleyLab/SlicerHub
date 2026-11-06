/**
 * Sign in to SlicerHub from a script, the same way a browser does: start sign-in, fill in
 * Keycloak's sign-in page, follow the redirects back. Uses only fetch (no dependencies),
 * so the password grant can stay off for the app's Keycloak client.
 *
 *   const { cookie, token, user } = await signIn('http://localhost:8000', email, password);
 *   await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
 *
 * Depends on the markup of Keycloak's sign-in form (`id="kc-form-login"`). If Keycloak or
 * the slicerhub theme changes it, this fails with a message saying so.
 */

const MAX_REDIRECTS = 15;

/** A tiny cookie jar: name → value (paths and domains ignored; one host via nginx). */
class Jar {
    constructor() { this.cookies = new Map(); }
    take(res) {
        for (const line of res.headers.getSetCookie?.() || []) {
            const [pair, ...attrs] = line.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
                || attrs.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) < Date.now());
            if (!value || expired) this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
    }
    header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&quot;/g, '"');

/** Request with the jar, following redirects by hand so every hop's cookies are kept. */
async function go(jar, url, init = {}) {
    let res;
    let current = url;
    let options = init;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        res = await fetch(current, {
            ...options,
            redirect: 'manual',
            headers: { ...(options.headers || {}), Cookie: jar.header() },
        });
        jar.take(res);
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) return { res, url: current };
        current = new URL(location, current).href;
        options = {}; // redirects are GETs
    }
    throw new Error(`Too many redirects signing in (last: ${current})`);
}

/**
 * @param {string} baseUrl  e.g. http://localhost:8000 (the nginx address, where /sso/ is)
 * @returns {Promise<{ cookie: string, token: string, user: object }>}
 */
export async function signIn(baseUrl, email, password) {
    const jar = new Jar();
    const start = new URL('/api/auth/login/start?returnTo=%2F', baseUrl).href;
    const { res: page, url: pageUrl } = await go(jar, start);
    const html = await page.text();

    const form = html.match(/<form\b[^>]*\bid="kc-form-login"[^>]*>/i)?.[0];
    const action = form?.match(/\baction="([^"]+)"/i)?.[1];
    if (!action) {
        throw new Error(`Keycloak's sign-in form was not found at ${pageUrl} (status ${page.status}). `
            + 'Is Keycloak up at /sso/, and has its sign-in page markup changed?');
    }

    const { res: done } = await go(jar, new URL(decodeEntities(action), pageUrl).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: email, password, credentialId: '' }).toString(),
    });

    const token = jar.cookies.get('token');
    if (!token) {
        const text = await done.text().catch(() => '');
        const why = /kc-form-login/.test(text) ? 'wrong email or password, or the account is locked'
            : /update.?password|kc-passwd-update-form/i.test(text) ? 'the account must set a new password first'
            : /verify.?email/i.test(text) ? 'the account must verify its email first'
            : `ended on status ${done.status}`;
        throw new Error(`Sign-in for ${email} failed: ${why}`);
    }
    const cookie = `token=${token}`;
    const me = await fetch(new URL('/api/auth/me', baseUrl), { headers: { Cookie: cookie } });
    const body = await me.json().catch(() => ({}));
    if (!me.ok) throw new Error(`Signed in as ${email}, but /api/auth/me returned ${me.status}`);
    return { cookie, token, user: body.user, accessPending: body.accessPending === true };
}
