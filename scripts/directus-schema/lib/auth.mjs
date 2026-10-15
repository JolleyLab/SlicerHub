import { loginDirectusAdmin, prompt } from './login.mjs';

/**
 * Shared CLI auth resolution for the directus-schema scripts.
 * Security model: CLI only, no admin token ever stored in .env.
 *   --login (default)     interactive Directus Administrator login, ephemeral session
 *   --paste-token          one-run pasted access/static token, never written to disk
 *   --allow-service-token  reuse an existing env token (lab-only escape hatch)
 */
export async function resolveAuth(url, args, { serviceTokenEnvVar = 'DIRECTUS_TOKEN' } = {}) {
    if (args.pasteToken) {
        const token = await prompt(
            'Paste a one-run Directus admin access or static token (not saved): '
        );
        if (!token) throw new Error('No token pasted');
        return { token, source: 'pasted (one-run)', refreshToken: null };
    }

    if (args.allowServiceToken) {
        const service = (process.env[serviceTokenEnvVar] || '').trim();
        if (!service) {
            throw new Error(`${serviceTokenEnvVar} is empty; cannot use --allow-service-token`);
        }
        console.warn(
            `Warning: using ${serviceTokenEnvVar} for schema. Prefer --login or --paste-token.`
        );
        return { token: service, source: `${serviceTokenEnvVar} (--allow-service-token)`, refreshToken: null };
    }

    // Default: interactive Directus Administrator login (short-lived session).
    console.log('Sign in to Directus as an Administrator (session used only for this run).');
    const session = await loginDirectusAdmin(url);
    return {
        token: session.accessToken,
        source: 'interactive login (ephemeral)',
        refreshToken: session.refreshToken
    };
}

/** Shared flag parsing for the auth-related CLI options. Callers add their own on top. */
export function parseAuthFlags(argv) {
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    return {
        pasteToken: flags.has('paste-token'),
        allowServiceToken: flags.has('allow-service-token'),
        dryRun: flags.has('dry-run'),
        help: flags.has('help') || flags.has('h')
    };
}
