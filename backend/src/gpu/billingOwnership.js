import Project from '../models/Project.js';
import ProjectGpu from '../models/ProjectGpu.js';
import User from '../models/User.js';

const PRESENCE_META_KEY = 'billingPresence';

/** Minutes without heartbeat before a user is not a transfer candidate. */
export function getTransferActiveMinutes() {
    const raw = parseInt(process.env.GPU_BILLING_TRANSFER_ACTIVE_MINUTES || '10', 10);
    return Math.max(1, Number.isFinite(raw) ? raw : 10);
}

export function getTransferActiveMs() {
    return getTransferActiveMinutes() * 60 * 1000;
}

function roleRank(role) {
    if (role === 'admin') return 0;
    if (role === 'collaborator') return 1;
    return 2;
}

function parsePresence(metadata) {
    const raw = metadata?.[PRESENCE_META_KEY];
    if (!raw || typeof raw !== 'object') return {};
    return { ...raw };
}

function isTimestampActive(iso, nowMs = Date.now()) {
    if (!iso) return false;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return false;
    return (nowMs - ms) <= getTransferActiveMs();
}

/**
 * Record that a user is present on the project GPU (heartbeat).
 * After an explicit billing handoff, the transferor stays inactive for transfer
 * purposes until they close any open viewer and open one again.
 */
export function touchBillingUserPresence(projectId, userId, { viewerActive = false } = {}) {
    if (!projectId || !userId) return;
    const at = new Date().toISOString();
    const key = String(userId);
    const active = viewerActive === true;
    ProjectGpu.patchMetadata(projectId, (meta) => {
        const presence = parsePresence(meta);
        const prev = presence[key] || {};
        if (prev.suppressUntilViewerReopen) {
            if (!active) {
                presence[key] = {
                    lastSeenAt: at,
                    viewerActive: false,
                    suppressUntilViewerReopen: true,
                    sawViewerClosed: true
                };
            } else if (prev.sawViewerClosed) {
                // Closed after handoff, then opened a viewer again → eligible.
                presence[key] = {
                    lastSeenAt: at,
                    viewerActive: true
                };
            } else {
                // Same viewer still open after handoff — not a transfer candidate.
                presence[key] = {
                    lastSeenAt: at,
                    viewerActive: false,
                    suppressUntilViewerReopen: true,
                    sawViewerClosed: false
                };
            }
        } else {
            presence[key] = {
                lastSeenAt: at,
                viewerActive: active
            };
        }
        return { ...meta, [PRESENCE_META_KEY]: presence };
    });
}

/** Clear / suppress a user after they explicitly transfer billing ownership. */
export function suppressBillingUserPresenceAfterHandoff(projectId, userId) {
    if (!projectId || !userId) return;
    const at = new Date().toISOString();
    ProjectGpu.patchMetadata(projectId, (meta) => {
        const presence = parsePresence(meta);
        presence[String(userId)] = {
            lastSeenAt: at,
            viewerActive: false,
            suppressUntilViewerReopen: true,
            sawViewerClosed: false
        };
        return { ...meta, [PRESENCE_META_KEY]: presence };
    });
}

export function getBillingOwnerUserId(instance) {
    if (!instance) return null;
    const ownerId = instance.billingOwnerUserId ?? instance.createdByUserId;
    return ownerId != null ? Number(ownerId) : null;
}

/**
 * Active project members for transfer, ranked admin → collaborator → username.
 * Only users with a recent viewer-open heartbeat count (project page alone is not enough).
 */
export function listActiveBillingUsers(projectId, {
    excludeUserIds = [],
    nowMs = Date.now()
} = {}) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) return [];

    const presence = parsePresence(instance.metadata);
    const exclude = new Set((excludeUserIds || []).map((id) => Number(id)));
    const members = Project.listCollaborators(projectId);

    const active = [];
    for (const member of members) {
        const userId = Number(member.user?.id);
        if (!userId || exclude.has(userId)) continue;
        if (member.role !== 'admin' && member.role !== 'collaborator') continue;

        const entry = presence[String(userId)];
        if (!entry || entry.suppressUntilViewerReopen) continue;
        if (entry.viewerActive !== true) continue;
        if (!isTimestampActive(entry.lastSeenAt, nowMs)) continue;

        active.push({
            userId,
            username: member.user?.username || `User ${userId}`,
            role: member.role,
            lastSeenAt: entry.lastSeenAt,
            viewerActive: true
        });
    }

    active.sort((a, b) => {
        const rr = roleRank(a.role) - roleRank(b.role);
        if (rr !== 0) return rr;
        return String(a.username).localeCompare(String(b.username), undefined, { sensitivity: 'base' });
    });
    return active;
}

export function buildBillingOwnerPublic(projectId, viewerUserId = null) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!instance || instance.providerId === 'local') {
        return {
            billingOwner: null,
            youOwnBilling: false,
            activeUsers: [],
            transferTarget: null,
            transferActiveMinutes: getTransferActiveMinutes()
        };
    }

    const ownerId = getBillingOwnerUserId(instance);
    let billingOwner = null;
    if (ownerId) {
        const user = User.findById(ownerId);
        const member = Project.listCollaborators(projectId)
            .find((m) => Number(m.user?.id) === ownerId);
        billingOwner = {
            userId: ownerId,
            username: user?.username || member?.user?.username || `User ${ownerId}`,
            role: member?.role || null
        };
    }

    const activeUsers = listActiveBillingUsers(projectId);
    const othersActive = activeUsers.filter((u) => u.userId !== ownerId);
    const transferTarget = othersActive[0] || null;

    return {
        billingOwner,
        youOwnBilling: ownerId != null && Number(viewerUserId) === ownerId,
        activeUsers,
        transferTarget,
        transferActiveMinutes: getTransferActiveMinutes()
    };
}

export function setBillingOwner(projectId, userId) {
    ProjectGpu.setBillingOwner(projectId, userId);
    ProjectGpu.touchBillingActivity(projectId);
}

/**
 * Transfer to first still-active candidate; cascade on failure until empty.
 * @returns {{ transferred: boolean, owner?: object, stopped?: boolean }}
 */
export function cascadeTransferOwnership(projectId, { excludeUserIds = [] } = {}) {
    const exclude = [...excludeUserIds];
    const attempted = new Set();

    while (true) {
        const candidates = listActiveBillingUsers(projectId, { excludeUserIds: exclude });
        const next = candidates.find((c) => !attempted.has(c.userId));
        if (!next) {
            return { transferred: false };
        }
        attempted.add(next.userId);
        // Re-check presence after ranking (race: B closed).
        const stillActive = listActiveBillingUsers(projectId, { excludeUserIds: exclude })
            .some((c) => c.userId === next.userId);
        if (!stillActive) {
            exclude.push(next.userId);
            continue;
        }
        setBillingOwner(projectId, next.userId);
        return { transferred: true, owner: next };
    }
}

/**
 * If owner is idle but others are active, auto-transfer. Does not stop billing.
 */
export function evaluateOwnerIdleHandoff(projectId, { nowMs = Date.now() } = {}) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) {
        return { transferred: false };
    }

    const ownerId = getBillingOwnerUserId(instance);
    if (!ownerId) {
        return { transferred: false };
    }

    const ownerStillActive = listActiveBillingUsers(projectId, { nowMs })
        .some((u) => u.userId === ownerId);
    if (ownerStillActive) {
        return { transferred: false };
    }

    const others = listActiveBillingUsers(projectId, {
        excludeUserIds: [ownerId],
        nowMs
    });
    if (others.length === 0) {
        return { transferred: false };
    }

    return cascadeTransferOwnership(projectId, { excludeUserIds: [ownerId] });
}

export function canStartRemoteBilling(project, settings) {
    if (!project || !settings) return false;
    if (project.userRole !== 'admin' && project.userRole !== 'collaborator') return false;
    if (settings.providerId === 'local') return false;
    if (settings.credentialsUnreadable) return false;
    return settings.hasApiKey === true;
}

export function canStopRemoteBilling(project, instance, userId) {
    if (!project) return false;
    if (project.userRole === 'admin') return true;
    const ownerId = getBillingOwnerUserId(instance);
    return ownerId != null && Number(userId) === ownerId;
}

/**
 * Running remote GPU sessions where this user is the billing owner.
 * Used at logout to remind / transfer / stop before signing out.
 */
export function listOwnedRunningBillingSessions(userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return [];

    const sessions = [];
    for (const instance of ProjectGpu.listRunningRemote()) {
        const ownerId = getBillingOwnerUserId(instance);
        if (ownerId !== uid) continue;

        const project = Project.findForUser({ projectId: instance.projectId, userId: uid });
        if (!project) continue;

        const ownership = buildBillingOwnerPublic(instance.projectId, uid);
        const othersActive = (ownership.activeUsers || []).filter((u) => u.userId !== uid);
        sessions.push({
            projectId: instance.projectId,
            projectName: project.name || `Project ${instance.projectId}`,
            providerId: instance.providerId,
            status: instance.status,
            othersActive: othersActive.length > 0,
            activeUsers: othersActive,
            transferTarget: othersActive[0] || null,
            youOwnBilling: true
        });
    }

    sessions.sort((a, b) => String(a.projectName).localeCompare(String(b.projectName), undefined, {
        sensitivity: 'base'
    }));
    return sessions;
}
