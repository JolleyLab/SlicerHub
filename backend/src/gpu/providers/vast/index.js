import crypto from 'crypto';
import {
    createInstance,
    destroyInstance,
    getMappedHostPort,
    getPublicHost,
    getVastBootFailure,
    getVastRemoteStatus,
    isInstanceNotFoundError,
    isGoneInstanceStatus,
    isProvisioningInstanceStatus,
    isOfferUnavailableError,
    isVastHostBootError,
    isPingGroupRangeHostError,
    parseEnvDict,
    searchOffers,
    showInstance,
    waitForHealth,
    waitForRunning
} from './client.js';
import { syncFileToTrame } from '../../trameFileSync.js';
import ProjectGpu from '../../../models/ProjectGpu.js';

export const id = 'vast';
export const label = 'Vast.ai';
export const consoleUrl = 'https://cloud.vast.ai/instances/';

export const credentialFields = [
    { key: 'apiKey', label: 'API Key', secret: true, required: true }
];

function getServerConfig() {
    const gpuImage = process.env.VAST_GPU_IMAGE;
    if (!gpuImage) {
        throw new Error('Server VAST_GPU_IMAGE is not configured');
    }
    if (process.env.VAST_SEARCH_QUERY && !process.env.VAST_SEARCH_JSON) {
        console.warn(
            'VAST_SEARCH_QUERY is deprecated (Vast API now expects JSON). '
            + 'Use VAST_GPU_NAME / VAST_MIN_DISK_GB / VAST_SEARCH_JSON instead.'
        );
    }
    return {
        gpuImage,
        maxDph: parseFloat(process.env.VAST_MAX_DPH || '2.0'),
        minDiskGb: parseInt(process.env.VAST_MIN_DISK_GB || '40', 10),
        instanceLabel: process.env.VAST_INSTANCE_LABEL || 'slicer-web-gpu',
        openPorts: process.env.VAST_OPEN_PORTS || '-p 8090:8090 -p 80:80',
        offerId: process.env.VAST_OFFER_ID ? parseInt(process.env.VAST_OFFER_ID, 10) : null,
        // `ssh`/`ssh_proxy` inject Vast's kaalia shim and break many custom images; `args` runs ours.
        runtype: (process.env.VAST_RUNTYPE || 'args').trim() || 'args'
    };
}

function gpuNameVariants(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return [];
    const variants = new Set([
        trimmed,
        trimmed.replace(/_/g, ' '),
        trimmed.replace(/ /g, '_')
    ]);
    return [...variants].filter(Boolean);
}

function buildOfferSearchQuery(serverConfig, { includeGpuName = true } = {}) {
    const rawJson = (process.env.VAST_SEARCH_JSON || '').trim();
    if (rawJson) {
        const parsed = JSON.parse(rawJson);
        return { limit: 20, ...parsed };
    }

    const query = {
        limit: 40,
        verified: { eq: true },
        rentable: { eq: true },
        rented: { eq: false },
        disk_space: { gte: serverConfig.minDiskGb },
        // Prefer stable hosts; cheapest-only pools often hit Docker/sysctl boot failures
        // (e.g. net.ipv4.ping_group_range) on flaky consumer machines.
        order: [['reliability', 'desc'], ['dph_total', 'asc']]
    };

    const offerType = (process.env.VAST_OFFER_TYPE || '').trim();
    if (offerType) {
        query.type = offerType;
    }

    const minCuda = parseFloat(process.env.VAST_MIN_CUDA || '0');
    if (Number.isFinite(minCuda) && minCuda > 0) {
        query.cuda_max_good = { gte: minCuda };
    }

    const minReliability = parseFloat(process.env.VAST_MIN_RELIABILITY || '0.98');
    if (Number.isFinite(minReliability) && minReliability > 0) {
        query.reliability = { gte: minReliability };
    }

    if (includeGpuName) {
        const gpuName = (process.env.VAST_GPU_NAME || 'RTX_4090').trim();
        const variants = gpuNameVariants(gpuName);
        if (variants.length === 1) {
            query.gpu_name = { eq: variants[0] };
        } else if (variants.length > 1) {
            query.gpu_name = { in: variants };
        }
    }

    return query;
}

function offerIdFrom(offer) {
    const id = offer?.id ?? offer?.ask_contract_id;
    return id != null ? Number(id) : null;
}

function offerMachineId(offer) {
    const id = offer?.machine_id ?? offer?.machineId;
    return id != null ? Number(id) : null;
}

function offerReliability(offer) {
    const raw = offer?.reliability ?? offer?.reliability2 ?? offer?.score;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
}

function listOfferCandidates(offers, maxDph, { skipMachineIds = null } = {}) {
    const skip = skipMachineIds instanceof Set ? skipMachineIds : null;
    const sorted = [...offers].sort((a, b) => {
        // Reliability first (desc), then price (asc) — avoid always picking the flakiest cheap host.
        const ra = offerReliability(a);
        const rb = offerReliability(b);
        if (rb !== ra) return rb - ra;
        const da = parseFloat(a.dph_total || a.dph || '0');
        const db = parseFloat(b.dph_total || b.dph || '0');
        return da - db;
    });

    const candidates = [];
    for (const offer of sorted) {
        const dph = parseFloat(offer.dph_total || offer.dph || '0');
        if (maxDph > 0 && dph > maxDph) continue;
        const machineId = offerMachineId(offer);
        if (skip && machineId != null && skip.has(machineId)) continue;
        const id = offerIdFrom(offer);
        if (id) {
            candidates.push({
                id,
                offer,
                dph,
                machineId,
                reliability: offerReliability(offer)
            });
        }
    }
    return candidates;
}

async function listOffers(apiKey, serverConfig, { skipMachineIds = null } = {}) {
    if (serverConfig.offerId) {
        return [{ id: serverConfig.offerId, offer: { id: serverConfig.offerId }, dph: 0 }];
    }

    const attempts = [
        ['default', buildOfferSearchQuery(serverConfig, { includeGpuName: true })],
        ['relaxed', buildOfferSearchQuery(serverConfig, { includeGpuName: false })]
    ];

    // If reliability floor yields nothing, retry once without it (still sorted by reliability).
    const minReliability = parseFloat(process.env.VAST_MIN_RELIABILITY || '0.98');
    if (Number.isFinite(minReliability) && minReliability > 0) {
        const noRel = buildOfferSearchQuery(serverConfig, { includeGpuName: true });
        delete noRel.reliability;
        attempts.push(['no-reliability-floor', noRel]);
    }

    const seen = new Set();
    const candidates = [];
    let cheapestSeen = null;

    for (const [label, query] of attempts) {
        const offers = await searchOffers(apiKey, query);
        for (const offer of offers) {
            const dph = parseFloat(offer.dph_total || offer.dph || '0');
            if (cheapestSeen == null || dph < cheapestSeen) {
                cheapestSeen = dph;
            }
        }

        for (const pick of listOfferCandidates(offers, serverConfig.maxDph, { skipMachineIds })) {
            if (seen.has(pick.id)) continue;
            seen.add(pick.id);
            candidates.push({ ...pick, searchLabel: label });
        }

        if (candidates.length) break;
        console.warn(`Vast search "${label}" returned ${offers.length} offer(s), none usable within VAST_MAX_DPH`);
    }

    if (!candidates.length) {
        if (cheapestSeen != null && serverConfig.maxDph > 0 && cheapestSeen > serverConfig.maxDph) {
            throw new Error(
                `Cheapest Vast offer is $${cheapestSeen.toFixed(2)}/hr but VAST_MAX_DPH=$${serverConfig.maxDph}. `
                + 'Raise VAST_MAX_DPH or set VAST_OFFER_ID to a specific offer.'
            );
        }

        const gpuLabel = process.env.VAST_GPU_NAME || 'RTX_4090';
        throw new Error(
            `No Vast offers matched (GPU=${gpuLabel}, disk>=${serverConfig.minDiskGb}GB). `
            + 'Try a different VAST_GPU_NAME, lower VAST_MIN_DISK_GB, or set VAST_OFFER_ID.'
        );
    }

    return candidates;
}

async function createInstanceFromOffer(apiKey, offerId, serverConfig, syncToken, projectId) {
    const onstartCmd = buildOnstart(syncToken);
    const body = {
        image: serverConfig.gpuImage,
        disk: serverConfig.minDiskGb,
        label: `${serverConfig.instanceLabel}-p${projectId}`,
        env: parseEnvDict(serverConfig.openPorts),
        cancel_unavail: true
    };

    if (serverConfig.runtype === 'args') {
        body.runtype = 'args';
        // No ENTRYPOINT on slicer-vast-gpu image — args_str is the container command.
        body.args_str = `bash -lc ${shellQuote(onstartCmd)}`;
    } else {
        body.runtype = serverConfig.runtype;
        body.onstart = onstartCmd;
    }

    return createInstance(apiKey, offerId, body);
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function destroyInstanceQuietly(apiKey, instanceId) {
    if (!instanceId) return;
    try {
        await destroyInstance(apiKey, instanceId);
    } catch (err) {
        if (!isInstanceNotFoundError(err)) {
            console.warn(`Vast destroy after boot failure (${instanceId}):`, err.message || err);
        }
    }
}

async function provisionOnOffer(apiKey, offerId, serverConfig, syncToken, projectId, signal) {
    const createResult = await createInstanceFromOffer(
        apiKey,
        offerId,
        serverConfig,
        syncToken,
        projectId
    );
    const instanceId = String(createResult.new_contract);
    ProjectGpu.setProvisioningInstanceId(projectId, instanceId);
    try {
        const info = await waitForRunning(apiKey, instanceId, { signal });
        return { info, instanceId, offerId };
    } catch (err) {
        await destroyInstanceQuietly(apiKey, instanceId);
        throw err;
    }
}

async function acceptOfferWithRetry(apiKey, serverConfig, syncToken, projectId, signal) {
    let lastErr = null;
    /** Skip machines that already failed OCI/Docker boot this provision (e.g. ping_group_range). */
    const badMachineIds = new Set();

    for (let round = 1; round <= 3; round++) {
        const candidates = await listOffers(apiKey, serverConfig, { skipMachineIds: badMachineIds });
        console.log(
            `Vast offer round ${round}: trying ${candidates.length} candidate(s)`
            + (badMachineIds.size ? ` (skipping ${badMachineIds.size} failed machine(s))` : '')
        );

        for (const candidate of candidates) {
            try {
                console.log(
                    `Vast create attempt: offer id=${candidate.id} `
                    + `$${candidate.dph.toFixed(3)}/hr `
                    + `rel=${(candidate.reliability ?? 0).toFixed(3)} `
                    + `${candidate.offer.gpu_name || ''}`.trim()
                );
                return await provisionOnOffer(
                    apiKey,
                    candidate.id,
                    serverConfig,
                    syncToken,
                    projectId,
                    signal
                );
            } catch (err) {
                lastErr = err;
                if (isOfferUnavailableError(err)) {
                    console.warn(`Vast offer ${candidate.id} no longer available, trying next`);
                    continue;
                }
                if (isVastHostBootError(err)) {
                    const machineId = candidate.machineId ?? offerMachineId(candidate.offer);
                    if (machineId != null) badMachineIds.add(machineId);
                    const hint = isPingGroupRangeHostError(err.message)
                        ? ' (host Docker/sysctl ping_group_range — bad machine class, not our image)'
                        : '';
                    console.warn(
                        `Vast host boot failed on offer ${candidate.id}`
                        + (machineId != null ? ` machine=${machineId}` : '')
                        + `${hint}: ${err.message || err}; trying next host`
                    );
                    continue;
                }
                throw err;
            }
        }

        if (serverConfig.offerId) {
            throw new Error(
                `Pinned VAST_OFFER_ID=${serverConfig.offerId} is no longer available. `
                + 'Remove VAST_OFFER_ID from .env and try again, or pick a fresh offer id.'
            );
        }

        console.warn(`Vast offer round ${round} exhausted (${candidates.length} tried); re-searching...`);
    }

    throw lastErr || new Error(
        'All matching Vast hosts failed to start the GPU container. '
        + 'Often caused by flaky hosts (Docker ping_group_range). Try Start Billing again, '
        + 'raise VAST_MIN_RELIABILITY, or set VAST_OFFER_ID to a known-good machine.'
    );
}

function buildOnstart(syncToken) {
    let cmd;
    if (process.env.VAST_ONSTART_CMD) {
        cmd = process.env.VAST_ONSTART_CMD;
    } else if (process.env.VAST_GIT_REPO) {
        const ref = process.env.VAST_GIT_REF || 'main';
        cmd = `rm -rf /workspace/slicer-web && git clone --depth 1 --branch ${ref} ${process.env.VAST_GIT_REPO} /workspace/slicer-web && bash /workspace/slicer-web/scripts/vast/onstart-process-mode.sh`;
    } else {
        cmd = 'mkdir -p /workspace/slicer-web/backend/userFiles && bash /opt/slicer-vast/onstart-process-mode.sh';
    }
    return `export TRAME_SYNC_TOKEN='${syncToken}' && ${cmd}`;
}

export async function provision({ credentials, projectId, signal }) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Vast API key is required');

    const syncToken = crypto.randomBytes(32).toString('hex');
    const serverConfig = getServerConfig();
    const { info, instanceId, offerId } = await acceptOfferWithRetry(
        apiKey,
        serverConfig,
        syncToken,
        projectId,
        signal
    );

    const gpuHost = getPublicHost(info);
    const trameApiPort = getMappedHostPort(info, 8090);
    const viewerPort = getMappedHostPort(info, 80);
    const trameServiceUrl = `http://${gpuHost}:${trameApiPort}`;
    const viewerPublicBaseUrl = viewerPort === 80
        ? `http://${gpuHost}`
        : `http://${gpuHost}:${viewerPort}`;

    await waitForHealth(trameServiceUrl, { signal });

    return {
        instanceId,
        gpuHost,
        trameApiPort,
        viewerPort,
        trameServiceUrl,
        viewerPublicBaseUrl,
        metadata: {
            offerId,
            dph: info.dph_total || info.dph,
            gpuName: info.gpu_name,
            numGpus: info.num_gpus,
            syncToken
        }
    };
}

export async function destroy({ credentials, instance }) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Vast API key is required');
    if (!instance?.instanceId) return;
    try {
        await destroyInstance(apiKey, instance.instanceId);
    } catch (err) {
        if (isInstanceNotFoundError(err)) return;
        throw err;
    }
}

/**
 * @returns {{ alive: boolean, reason?: string, remoteStatus?: string }}
 */
export async function checkInstance({ credentials, instance }) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Vast API key is required');
    if (!instance?.instanceId) {
        return { alive: false, reason: 'No GPU instance id on record' };
    }

    try {
        const info = await showInstance(apiKey, instance.instanceId);
        const bootFailure = getVastBootFailure(info);
        if (bootFailure) {
            return {
                alive: false,
                reason: bootFailure,
                remoteStatus: info?.actual_status ?? null,
                statusMessage: info?.status_msg ?? null
            };
        }

        const status = String(info?.actual_status || '').toLowerCase();
        if (!status || isProvisioningInstanceStatus(status) || status === 'running') {
            return {
                alive: true,
                remoteStatus: status || 'loading',
                statusMessage: info?.status_msg ?? null
            };
        }
        if (isGoneInstanceStatus(status)) {
            const msg = String(info?.status_msg || '').trim();
            return {
                alive: false,
                reason: msg || `GPU instance is no longer running on Vast (status: ${status})`,
                remoteStatus: status,
                statusMessage: info?.status_msg ?? null
            };
        }
        // Unrecognized status — assume still coming up rather than destroy billing.
        return {
            alive: true,
            remoteStatus: status,
            statusMessage: info?.status_msg ?? null
        };
    } catch (err) {
        if (isInstanceNotFoundError(err)) {
            return {
                alive: false,
                reason: 'GPU instance was removed on Vast (no longer exists)'
            };
        }
        throw err;
    }
}

/** Poll Vast while our DB is still provisioning (surfaces status_msg in the UI). */
export async function getProvisionStatus({ credentials, instanceId }) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Vast API key is required');
    if (!instanceId) return null;

    const info = await showInstance(apiKey, instanceId);
    const remote = getVastRemoteStatus(info);
    const failure = getVastBootFailure(info);
    return { ...remote, failure };
}

export async function syncFile({ instance, userId, storageKey, fileName, localBytes = null }) {
    return syncFileToTrame(instance, { userId, storageKey, fileName }, { localBytes });
}
