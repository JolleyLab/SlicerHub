import readline from 'readline';

/**
 * Prompt on stderr so stdout stays clean for piping.
 * @param {string} question
 * @param {{ silent?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export function prompt(question, { silent = false } = {}) {
    if (!silent || !process.stdin.isTTY) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr
        });
        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(String(answer || '').trim());
            });
        });
    }

    process.stderr.write(question);
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        const chunks = [];

        const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode?.(wasRaw);
            stdin.pause();
        };

        const onData = (buf) => {
            const s = buf.toString('utf8');
            for (const ch of s) {
                if (ch === '\n' || ch === '\r') {
                    cleanup();
                    process.stderr.write('\n');
                    resolve(chunks.join('').trim());
                    return;
                }
                if (ch === '\u0003') {
                    cleanup();
                    reject(new Error('Cancelled'));
                    return;
                }
                if (ch === '\u007f' || ch === '\b') {
                    chunks.pop();
                    continue;
                }
                chunks.push(ch);
                process.stderr.write('*');
            }
        };

        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}

/**
 * Interactive Directus Administrator login for one schema run.
 * Returns short-lived tokens; caller should logout when finished.
 */
export async function loginDirectusAdmin(baseUrl, { email, password, otp } = {}) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    const identity = email || await prompt('Directus admin email: ');
    const pass = password || await prompt('Password: ', { silent: true });
    if (!identity || !pass) {
        throw new Error('Email and password are required');
    }

    async function attempt(otpValue) {
        const payload = {
            email: String(identity).toLowerCase(),
            password: String(pass)
        };
        if (otpValue) payload.otp = String(otpValue);

        const res = await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(payload)
        });
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = null;
        }
        return { res, body };
    }

    let { res, body } = await attempt(otp);
    const msg = String(body?.errors?.[0]?.message || body?.message || '').toLowerCase();
    const needsOtp =
        !otp
        && (
            /otp|totp|two.?factor|2fa|one.?time/.test(msg)
            || (res.status === 401 && /otp|totp|2fa/.test(msg))
        );

    if (needsOtp || (res.status === 401 && /INVALID_OTP|otp/i.test(JSON.stringify(body || {})))) {
        const code = await prompt('OTP (authenticator): ');
        ({ res, body } = await attempt(code));
    }

    if (!res.ok) {
        const errMsg = body?.errors?.[0]?.message || body?.message || `Login failed (${res.status})`;
        throw new Error(errMsg);
    }

    const data = body?.data || body;
    const accessToken = data?.access_token;
    if (!accessToken) {
        throw new Error('Login succeeded but no access_token returned');
    }
    return {
        accessToken,
        refreshToken: data?.refresh_token || null
    };
}

export async function logoutDirectus(baseUrl, refreshToken) {
    if (!refreshToken) return;
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    try {
        await fetch(`${base}/auth/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
    } catch {
        // best-effort
    }
}
