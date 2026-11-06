import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Redirect login (OIDC code flow + PKCE) and back-channel logout token checks.
// Keycloak is replaced by a locally generated signing key and a fake token endpoint.

process.env.KEYCLOAK_URL = 'http://keycloak.test';
process.env.KEYCLOAK_REALM = 'slicer-web';
process.env.KEYCLOAK_CLIENT_ID = 'slicer-web-backend';
process.env.KEYCLOAK_CLIENT_SECRET = 'test-client-secret';
process.env.PUBLIC_APP_URL = 'https://app.example';
// A strong secret so config doesn't generate and save one during tests.
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

const joseUrl = new URL('../../../backend/node_modules/jose/', import.meta.url);
const { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } = await import(new URL('dist/webapi/index.js', joseUrl).href)
    .catch(() => import('../../../backend/node_modules/jose/dist/node/esm/index.js'));

const oidc = await import('../../../backend/src/auth/oidc.js');

const ISSUER = 'https://app.example/sso/realms/slicer-web';
const META = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: 'http://keycloak.test/realms/slicer-web/protocol/openid-connect/token',
    jwks_uri: 'http://keycloak.test/realms/slicer-web/protocol/openid-connect/certs',
    end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
};

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
oidc._setProviderForTests({ metadata: META, jwks: createLocalJWKSet({ keys: [jwk] }) });

const sign = (claims, { iss = ISSUER, aud = 'slicer-web-backend', exp = '5m', key = privateKey } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);

/** Start a login and pull state/nonce out of the redirect URL. */
async function begin(returnTo = '/?view=cases', options = {}) {
    const started = await oidc.beginLogin({ returnTo, ...options });
    const url = new URL(started.url);
    return { started, url, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
}

/** Replace fetch for the token endpoint; records the request body. */
function fakeTokenEndpoint(response) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: new URLSearchParams(init.body) });
        return response;
    };
    return calls;
}
const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body });

const userClaims = (nonce) => ({
    sub: 'kc-user-1', sid: 'kc-session-1', nonce, email: 'Dr.Who@Example.org',
    given_name: 'Ada', family_name: 'Who', roles: ['app-user'],
});

// ── safeReturnTo ──────────────────────────────────────────────────────────

test('only same-site relative return paths are allowed after login', () => {
    assert.equal(oidc.safeReturnTo('/?view=cases&case=3'), '/?view=cases&case=3');
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, '/a\r\nSet-Cookie:x']) {
        assert.equal(oidc.safeReturnTo(bad), '/', String(bad));
    }
});

// ── beginLogin ────────────────────────────────────────────────────────────

test('login redirects to Keycloak with PKCE S256, state, nonce and our callback', async () => {
    const { url, state, nonce } = await begin();
    assert.equal(`${url.origin}${url.pathname}`, META.authorization_endpoint);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/api/auth/callback');
    assert.equal(url.searchParams.get('client_id'), 'slicer-web-backend');
    assert.ok(state && nonce && state !== nonce);
    assert.equal(url.searchParams.get('prompt'), null);
});

test('forced re-authentication asks Keycloak for the password again', async () => {
    const { url } = await oidc.beginLogin({ forceReauth: true }).then((s) => ({ url: new URL(s.url) }));
    assert.equal(url.searchParams.get('max_age'), '0');
    assert.equal(url.searchParams.get('prompt'), 'login');
});

test('each sign-in in progress gets its own cookie, named from its state (two tabs do not collide)', async () => {
    const one = await begin();
    const two = await begin();
    assert.ok(one.started.txCookieName.startsWith(oidc.TX_COOKIE_PREFIX));
    assert.notEqual(one.started.txCookieName, two.started.txCookieName);
    // The callback finds the cookie again from the state Keycloak sends back.
    assert.equal(oidc.txCookieName(one.state), one.started.txCookieName);
    assert.match(one.started.txCookieName, /^[A-Za-z0-9_-]+$/); // a valid cookie name
    assert.equal(oidc.txCookieName(''), null);
    assert.equal(oidc.txCookieName('; Path=/'), `${oidc.TX_COOKIE_PREFIX}Path`); // never injects attributes
});

// ── completeLogin ─────────────────────────────────────────────────────────

test('a valid callback exchanges the code with the PKCE verifier and maps the user', async () => {
    const { started, state, nonce } = await begin('/?view=cases');
    const idToken = await sign(userClaims(nonce));
    const calls = fakeTokenEndpoint(jsonResponse(200, { id_token: idToken, access_token: 'x' }));

    const out = await oidc.completeLogin({ query: { code: 'abc', state }, txCookie: started.txCookie });

    assert.equal(calls[0].url, META.token_endpoint);
    assert.equal(calls[0].body.get('grant_type'), 'authorization_code');
    assert.equal(calls[0].body.get('code'), 'abc');
    assert.ok(calls[0].body.get('code_verifier'));
    const challenge = crypto.createHash('sha256').update(calls[0].body.get('code_verifier')).digest('base64url');
    assert.equal(challenge, new URL(started.url).searchParams.get('code_challenge'));

    assert.equal(out.user.id, 'kc-user-1');
    assert.equal(out.user.keycloakSub, 'kc-user-1');
    assert.equal(out.user.email, 'dr.who@example.org');
    assert.equal(out.user.role, 'user');
    assert.equal(out.kcSid, 'kc-session-1');
    assert.equal(out.idToken, idToken);
    assert.equal(out.returnTo, '/?view=cases');
});

test('a callback with the wrong state is rejected before any code exchange', async () => {
    const { started } = await begin();
    const calls = fakeTokenEndpoint(jsonResponse(200, {}));
    await assert.rejects(
        oidc.completeLogin({ query: { code: 'abc', state: 'not-the-state' }, txCookie: started.txCookie }),
        { code: 'login_state_mismatch' }
    );
    assert.equal(calls.length, 0);
});

test('a callback without the login cookie (or with a forged one) is rejected', async () => {
    const { state } = await begin();
    await assert.rejects(oidc.completeLogin({ query: { code: 'abc', state }, txCookie: undefined }), { code: 'login_expired' });
    await assert.rejects(oidc.completeLogin({ query: { code: 'abc', state }, txCookie: 'forged.cookie.value' }), { code: 'login_expired' });
});

test('an error from Keycloak (e.g. the user cancelled) is reported, not exchanged', async () => {
    const { started, state } = await begin();
    const calls = fakeTokenEndpoint(jsonResponse(200, {}));
    await assert.rejects(
        oidc.completeLogin({ query: { error: 'access_denied', state }, txCookie: started.txCookie }),
        { code: 'login_denied' }
    );
    assert.equal(calls.length, 0);
});

test('ID tokens with the wrong nonce, audience, issuer or signer are rejected', async () => {
    const other = await generateKeyPair('RS256');
    const cases = [
        ['wrong nonce', (n) => sign(userClaims('someone-elses-nonce'))],
        ['wrong audience', (n) => sign(userClaims(n), { aud: 'another-client' })],
        ['wrong issuer', (n) => sign(userClaims(n), { iss: 'https://evil.example/realms/x' })],
        ['wrong key', (n) => sign(userClaims(n), { key: other.privateKey })],
        ['expired', (n) => sign(userClaims(n), { exp: Math.floor(Date.now() / 1000) - 120 })],
    ];
    for (const [label, makeToken] of cases) {
        const { started, state, nonce } = await begin();
        fakeTokenEndpoint(jsonResponse(200, { id_token: await makeToken(nonce) }));
        await assert.rejects(
            oidc.completeLogin({ query: { code: 'abc', state }, txCookie: started.txCookie }),
            { code: 'login_failed' },
            label
        );
    }
});

test('a failed code exchange is reported as a login failure', async () => {
    const { started, state } = await begin();
    fakeTokenEndpoint(jsonResponse(400, { error: 'invalid_grant' }));
    await assert.rejects(oidc.completeLogin({ query: { code: 'reused', state }, txCookie: started.txCookie }), { code: 'login_failed' });
});

// ── Fresh sign-in, account and password change checks ──────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000);

test('a forced re-authentication must come back with a fresh auth_time', async () => {
    // Keycloak reused an earlier sign-in (auth_time an hour ago): not a fresh password.
    let b = await begin('/', { forceReauth: true });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign({ ...userClaims(b.nonce), auth_time: nowSeconds() - 3600 }) }));
    await assert.rejects(oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie }), { code: 'login_not_fresh' });

    // No auth_time at all.
    b = await begin('/', { forceReauth: true });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign(userClaims(b.nonce)) }));
    await assert.rejects(oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie }), { code: 'login_not_fresh' });

    // Password entered during this sign-in.
    b = await begin('/', { forceReauth: true });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign({ ...userClaims(b.nonce), auth_time: nowSeconds() }) }));
    const out = await oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie });
    assert.equal(out.user.id, 'kc-user-1');
});

test('a normal sign-in does not require a fresh auth_time (Keycloak may reuse its sign-in)', async () => {
    const b = await begin('/');
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign({ ...userClaims(b.nonce), auth_time: nowSeconds() - 3600 }) }));
    const out = await oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie });
    assert.equal(out.user.id, 'kc-user-1');
});

test('when the signed-in account is expected, a different account is rejected', async () => {
    let b = await begin('/', { forceReauth: true, expectSub: 'kc-someone-else' });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign({ ...userClaims(b.nonce), auth_time: nowSeconds() }) }));
    await assert.rejects(oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie }), { code: 'login_wrong_account' });

    b = await begin('/', { forceReauth: true, expectSub: 'kc-user-1' });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign({ ...userClaims(b.nonce), auth_time: nowSeconds() }) }));
    const out = await oidc.completeLogin({ query: { code: 'c', state: b.state }, txCookie: b.started.txCookie });
    assert.equal(out.user.id, 'kc-user-1');
});

test('changing the password asks Keycloak for its update-password step', async () => {
    const { url } = await begin('/', { action: 'password', expectSub: 'kc-user-1' });
    assert.equal(url.searchParams.get('kc_action'), 'UPDATE_PASSWORD');
    assert.equal(url.searchParams.get('prompt'), null); // Keycloak decides whether to re-ask
});

test('a password change only counts when Keycloak reports success', async () => {
    for (const [status, code] of [['cancelled', 'login_action_cancelled'], ['error', 'login_action_failed'], [undefined, 'login_action_failed']]) {
        const b = await begin('/', { action: 'password', expectSub: 'kc-user-1' });
        const calls = fakeTokenEndpoint(jsonResponse(200, {}));
        await assert.rejects(
            oidc.completeLogin({ query: { code: 'c', state: b.state, kc_action_status: status }, txCookie: b.started.txCookie }),
            { code },
            String(status)
        );
        assert.equal(calls.length, 0, 'no code exchange');
    }
    const b = await begin('/', { action: 'password', expectSub: 'kc-user-1' });
    fakeTokenEndpoint(jsonResponse(200, { id_token: await sign(userClaims(b.nonce)) }));
    const out = await oidc.completeLogin({ query: { code: 'c', state: b.state, kc_action_status: 'success' }, txCookie: b.started.txCookie });
    assert.equal(out.action, 'password');
});

// ── Logout ────────────────────────────────────────────────────────────────

test('logout URL ends the Keycloak sign-in and returns to the app', async () => {
    const url = new URL(await oidc.buildLogoutUrl('the-id-token'));
    assert.equal(`${url.origin}${url.pathname}`, META.end_session_endpoint);
    assert.equal(url.searchParams.get('id_token_hint'), 'the-id-token');
    assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://app.example/');
});

test('without an ID token the logout URL still ends the Keycloak sign-in (Keycloak asks first)', async () => {
    const url = new URL(await oidc.buildLogoutUrl(null));
    assert.equal(`${url.origin}${url.pathname}`, META.end_session_endpoint);
    assert.equal(url.searchParams.get('id_token_hint'), null);
    assert.equal(url.searchParams.get('client_id'), 'slicer-web-backend');
    assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://app.example/');
});

const EVENT = { 'http://schemas.openid.net/event/backchannel-logout': {} };

test('a valid back-channel logout token yields the Keycloak session id', async () => {
    const token = await sign({ sub: 'kc-user-1', sid: 'kc-session-1', events: EVENT, jti: 'j1' });
    assert.deepEqual(await oidc.verifyLogoutToken(token), { sid: 'kc-session-1', sub: 'kc-user-1' });
});

test('back-channel logout tokens that are not genuine logout tokens are rejected', async () => {
    const other = await generateKeyPair('RS256');
    const bad = [
        await sign({ sub: 'u', sid: 's' }),                                        // no logout event
        await sign({ sub: 'u', sid: 's', events: EVENT, nonce: 'n' }),             // has a nonce
        await sign({ events: EVENT }),                                             // no sid or sub
        await sign({ sub: 'u', sid: 's', events: EVENT }, { aud: 'other' }),       // not for us
        await sign({ sub: 'u', sid: 's', events: EVENT }, { key: other.privateKey }), // not Keycloak's key
        'not-a-jwt',
    ];
    for (const token of bad) {
        await assert.rejects(oidc.verifyLogoutToken(token));
    }
});
