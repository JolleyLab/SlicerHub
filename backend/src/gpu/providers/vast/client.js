const VAST_API = 'https://console.vast.ai/api/v0';

export class VastApiError extends Error {
    constructor(message, status = 0, body = null) {
        super(message);
        this.name = 'VastApiError';
        this.status = status;
        this.body = body;
    }
}

export function isOfferUnavailableError(err) {
    if (!(err instanceof VastApiError)) return false;
    const msg = String(err.message || err.body?.msg || '').toLowerCase();
    return err.status === 404
        || err.status === 410
        || msg.includes('no_such_ask')
        || msg.includes('not available')
        || msg.includes('no longer available');
}

export function isInstanceNotFoundError(err) {
    if (!(err instanceof VastApiError)) return false;
    const msg = String(err.message || err.body?.msg || '').toLowerCase();
    return err.status === 404
        || err.status === 410
        || msg.includes('no_such_instance')
        || msg.includes('invalid instance')
        || msg.includes('not found');
}

export function isInvalidApiKeyError(err) {
    if (!(err instanceof VastApiError)) return false;
    if (err.status === 401) return true;
    const msg = String(err.message || err.body?.msg || '').toLowerCase();
    return err.body?.error === 'auth_error' || msg.includes('invalid user key');
}

/** Host-side Docker/OCI boot failure (often bad machine or wrong runtype). */
export function isVastHostBootError(err) {
    return isFatalVastContainerError(err?.message || err?.body?.msg || '');
}

/** Verify a Vast API key before persisting it. */
export async function verifyVastApiKey(apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) throw new VastApiError('Vast API key is required', 400);
    try {
        await vastRequest(key, 'GET', '/users/current/');
    } catch (err) {
        if (isInvalidApiKeyError(err)) {
            throw new VastApiError(
                'Invalid Vast API key. Copy a fresh key from https://cloud.vast.ai/cli/',
                err.status,
                err.body
            );
        }
        throw err;
    }
}

const GONE_INSTANCE_STATUSES = new Set([
    'exited',
    'offline',
    'dead',
    'stopped',
    'terminated'
]);

const PROVISIONING_INSTANCE_STATUSES = new Set([
    'loading',
    'starting',
    'created',
    'pending',
    'rebooting',
    'scheduling',
    'unknown'
]);

/** Docker pull progress in status_msg — not a boot failure. */
export function isDockerPullProgress(msg) {
    const text = String(msg || '').trim();
    if (!text) return false;
    return /^(?:[a-f0-9]{12}:?\s+)?(?:pulling|pull complete|waiting|downloading|download complete|extracting|verifying checksum|already exists|layer already exists)/i.test(text)
        || /verifying checksum|download complete|extracting.*done/i.test(text);
}

export function isBootInProgressStatus(status, statusMsg = '') {
    const s = String(status || '').toLowerCase();
    if (PROVISIONING_INSTANCE_STATUSES.has(s)) return true;
    if (s === 'unknown' && isDockerPullProgress(statusMsg)) return true;
    return false;
}

export function isGoneInstanceStatus(status) {
    return GONE_INSTANCE_STATUSES.has(String(status || '').toLowerCase());
}

/** Human-readable boot failure from Vast instance row (status_msg + actual_status). */
export function getVastBootFailure(info) {
    if (!info) return null;
    const status = String(info.actual_status || '').toLowerCase();
    const msg = String(info.status_msg || info.message || '').trim();

    // Vast often reports `unknown` + docker pull lines while the image is still downloading.
    if (isBootInProgressStatus(status, msg)) {
        return null;
    }

    if (['exited', 'offline'].includes(status) || isGoneInstanceStatus(status)) {
        return msg || `Vast instance status: ${status}`;
    }

    // Fatal container/runtime errors in status_msg — not generic log lines.
    if (msg && isFatalVastContainerError(msg)) {
        return msg;
    }

    return null;
}

/** OCI/Docker fatal errors only — do not treat arbitrary Vast log text as failure. */
export function isFatalVastContainerError(msg) {
    return /failed to create shim task|kaalia_docker_shim|oci runtime create failed|failed to create task for container|ping_group_range|did not terminate successfully|exit status \d+/i.test(
        String(msg || '')
    );
}

/** True when the host cannot start containers (bad kernel/sysctl/Docker), not an app image bug. */
export function isPingGroupRangeHostError(msg) {
    return /ping_group_range/i.test(String(msg || ''));
}

export function getVastRemoteStatus(info) {
    return {
        actualStatus: info?.actual_status ?? null,
        statusMessage: String(info?.status_msg || info?.message || '').trim() || null
    };
}

export function isProvisioningInstanceStatus(status) {
    return PROVISIONING_INSTANCE_STATUSES.has(String(status || '').toLowerCase());
}

async function vastRequest(apiKey, method, path, body) {
    const res = await fetch(`${VAST_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (!res.ok) {
        const msg = typeof data === 'object' && data?.msg
            ? data.msg
            : (typeof data === 'string' ? data : `Vast API ${res.status}`);
        throw new VastApiError(msg, res.status, data);
    }

    return data;
}

/**
 * Search offers via POST /bundles/ (Vast API v0 JSON filter body).
 * @param {object} query - Filter object, e.g. { gpu_name: { eq: "RTX_4090" }, limit: 5 }
 */
export async function searchOffers(apiKey, query) {
    const body = { limit: 20, ...query };
    const data = await vastRequest(apiKey, 'POST', '/bundles/', body);
    const offers = data?.offers || data || [];
    return Array.isArray(offers) ? offers : [];
}

/**
 * Parse VAST_OPEN_PORTS / --env docker flags into the dict format the API expects.
 * Example: "-p 8090:8090 -p 80:80" -> { "-p 8090:8090": "1", "-p 80:80": "1" }
 */
export function parseEnvDict(spec) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        return spec;
    }
    const raw = String(spec || '').trim();
    if (!raw) {
        return { '-p 8090:8090': '1', '-p 80:80': '1' };
    }
    if (raw.startsWith('{')) {
        return JSON.parse(raw);
    }

    const env = {};
    for (const match of raw.matchAll(/-p\s+(\S+)/g)) {
        env[`-p ${match[1]}`] = '1';
    }
    for (const match of raw.matchAll(/-e\s+(\S+)/g)) {
        const pair = match[1];
        const eq = pair.indexOf('=');
        if (eq > 0) {
            env[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
    }
    return Object.keys(env).length
        ? env
        : { '-p 8090:8090': '1', '-p 80:80': '1' };
}

export async function createInstance(apiKey, offerId, config) {
    const body = { ...config };
    if (body.env != null && typeof body.env !== 'object') {
        body.env = parseEnvDict(body.env);
    } else if (body.env == null) {
        body.env = parseEnvDict('');
    }
    return vastRequest(apiKey, 'PUT', `/asks/${offerId}/`, body);
}

export async function showInstance(apiKey, instanceId) {
    const data = await vastRequest(apiKey, 'GET', `/instances/${instanceId}/`);
    // REST API wraps the row as { instances: { ... } }; CLI returns the row directly.
    return data?.instances ?? data;
}

export async function destroyInstance(apiKey, instanceId) {
    return vastRequest(apiKey, 'DELETE', `/instances/${instanceId}/`);
}

export function getPublicHost(instance) {
    const ip = instance?.public_ipaddr || instance?.ext_ip;
    if (!ip) throw new Error('Vast instance has no public IP yet');
    return String(ip).trim();
}

export function getMappedHostPort(instance, containerPort) {
    const key = `${containerPort}/tcp`;
    let binding = instance?.ports?.[key];
    if (!binding && instance?.ports) {
        const prop = Object.keys(instance.ports).find((k) => k === key);
        if (prop) binding = instance.ports[prop];
    }
    if (!binding) {
        throw new Error(`No public mapping for container port ${containerPort}`);
    }
    if (typeof binding === 'number' || typeof binding === 'string') {
        return parseInt(binding, 10);
    }
    const hostPort = Array.isArray(binding) ? binding[0]?.HostPort : binding?.HostPort;
    return parseInt(hostPort, 10);
}

export function isBillingCancelledError(err) {
    return err?.code === 'BILLING_CANCELLED' || err?.name === 'AbortError';
}

function throwIfCancelled(signal) {
    if (signal?.aborted) {
        const err = new Error('GPU billing cancelled');
        err.code = 'BILLING_CANCELLED';
        throw err;
    }
}

function delay(ms, signal) {
    throwIfCancelled(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
            clearTimeout(timer);
            const err = new Error('GPU billing cancelled');
            err.code = 'BILLING_CANCELLED';
            reject(err);
        };
        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export async function waitForRunning(apiKey, instanceId, { timeoutMs = 20 * 60 * 1000, intervalMs = 15000, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        throwIfCancelled(signal);
        const info = await showInstance(apiKey, instanceId);
        const status = info?.actual_status;
        const bootFailure = getVastBootFailure(info);
        if (bootFailure) {
            throw new Error(bootFailure);
        }
        console.log(`Vast instance ${instanceId} status: ${status ?? 'unknown'}`);
        if (status === 'running') return info;
        if (['exited', 'offline'].includes(String(status || '').toLowerCase())) {
            const statusMsg = String(info?.status_msg || info?.message || '').trim();
            throw new Error(statusMsg || `Vast instance entered status: ${status}`);
        }
        await delay(intervalMs, signal);
    }
    throw new Error(`Timed out waiting for Vast instance ${instanceId} to run`);
}

export async function waitForHealth(trameServiceUrl, { timeoutMs = 15 * 60 * 1000, intervalMs = 10000, signal } = {}) {
    const healthUrl = `${trameServiceUrl.replace(/\/+$/, '')}/health`;
    const deadline = Date.now() + timeoutMs;
    console.log(`Waiting for trame health at ${healthUrl}`);
    while (Date.now() < deadline) {
        throwIfCancelled(signal);
        try {
            const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                const h = await res.json();
                if (h.runtime === 'process' && h.status === 'healthy') {
                    console.log(`trame healthy at ${healthUrl}`);
                    return h;
                }
            }
        } catch (err) {
            if (isBillingCancelledError(err)) throw err;
            // keep polling
        }
        await delay(intervalMs, signal);
    }
    throw new Error(`trame-service did not become healthy at ${healthUrl}`);
}
