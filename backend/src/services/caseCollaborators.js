/**
 * Case collaborators and their roles, stored in Directus on the `case_directus_users` junction
 * (`case_id`, `directus_users_id`, `role`). Directus is the only source of truth: there is no
 * app-side copy, and nothing is implied by who created a case. A creator is an ordinary admin row.
 *
 * All junction reads and writes use the service token; callers authorize the actor first (see
 * getCaseCollabActorContext). A missing or unrecognised role grants nothing.
 */

import { AppError, ForbiddenError, ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { directusFetch, mapDirectusPerson } from './directus.js';

const JUNCTION = 'case_directus_users';

export const CASE_COLLAB_ROLES = Object.freeze({
    ADMIN: 'admin',
    COLLABORATOR: 'collaborator',
    READ_ONLY: 'read_only'
});

const KNOWN_ROLES = new Set(Object.values(CASE_COLLAB_ROLES));

/** A role as stored in Directus: one of the three values, or null (missing or unrecognised). */
export function parseCaseRole(value) {
    const role = typeof value === 'string' ? value.trim() : '';
    return KNOWN_ROLES.has(role) ? role : null;
}

/**
 * A role asked for by a client. Nothing given means collaborator; "readonly" and "observer" are
 * accepted spellings of read only; anything else is an error rather than a guess.
 */
export function requestedCaseRole(value) {
    if (value == null || value === '') return CASE_COLLAB_ROLES.COLLABORATOR;
    const raw = String(value).trim().toLowerCase().replace(/-/g, '_');
    if (KNOWN_ROLES.has(raw)) return raw;
    if (raw === 'readonly' || raw === 'observer') return CASE_COLLAB_ROLES.READ_ONLY;
    throw new ValidationError(msg('case.role_invalid'), null, 'case.role_invalid');
}

function userIdOf(ref) {
    return ref && typeof ref === 'object' ? String(ref.id || '') : String(ref || '');
}

/** A junction row as a member. `role` is null when Directus holds nothing usable. */
function mapMember(row) {
    const user = row?.directus_users_id && typeof row.directus_users_id === 'object'
        ? row.directus_users_id
        : { id: row?.directus_users_id };
    const person = mapDirectusPerson(user);
    if (!person?.id) return null;
    return {
        ...person,
        role: parseCaseRole(row.role),
        junctionId: row?.id != null ? String(row.id) : null
    };
}

/** What the UI shows: a member whose role is unusable is shown as read only, the least access. */
export function toDisplayMember(member) {
    return { ...member, role: member.role || CASE_COLLAB_ROLES.READ_ONLY };
}

const MEMBER_FIELDS = [
    'id',
    'case_id',
    'role',
    'directus_users_id.id',
    'directus_users_id.email',
    'directus_users_id.first_name',
    'directus_users_id.last_name'
].join(',');

export function createCaseCollaborators({ fetchDirectus = directusFetch } = {}) {
    async function listMembersByCaseIds(caseIds) {
        const ids = [...new Set((caseIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
        const byCase = Object.fromEntries(ids.map((id) => [id, []]));
        if (!ids.length) return byCase;
        const payload = await fetchDirectus(`/items/${JUNCTION}`, {
            query: {
                'filter[case_id][_in]': ids.join(','),
                fields: MEMBER_FIELDS,
                sort: 'id',
                limit: '-1'
            }
        });
        for (const row of payload?.data || []) {
            const caseKey = userIdOf(row?.case_id);
            const member = mapMember(row);
            if (caseKey in byCase && member) byCase[caseKey].push(member);
        }
        return byCase;
    }

    /** Ids of the cases a user is on with one of the given roles. */
    async function listCaseIdsForUser(userId, roles) {
        const payload = await fetchDirectus(`/items/${JUNCTION}`, {
            query: {
                'filter[directus_users_id][_eq]': String(userId),
                'filter[role][_in]': roles.join(','),
                fields: 'case_id',
                limit: '-1'
            }
        });
        return [...new Set((payload?.data || []).map((row) => userIdOf(row.case_id)).filter(Boolean))];
    }

    async function listMembers(caseId) {
        const key = String(caseId || '').trim();
        return (await listMembersByCaseIds([key]))[key] || [];
    }

    /** Add a member, or change the role of one who is already on the case. */
    async function upsertMember(caseId, userId, role) {
        const caseKey = String(caseId || '').trim();
        const uid = String(userId || '').trim();
        if (!caseKey || !uid) {
            throw new ValidationError(msg('case.case_and_user_required'), null, 'case.case_and_user_required');
        }
        const next = requestedCaseRole(role);
        const current = (await listMembers(caseKey)).find((m) => m.id === uid);
        if (!current) {
            await fetchDirectus(`/items/${JUNCTION}`, {
                method: 'POST',
                body: { case_id: caseKey, directus_users_id: uid, role: next }
            });
        } else if (current.role !== next) {
            await fetchDirectus(`/items/${JUNCTION}/${encodeURIComponent(current.junctionId)}`, {
                method: 'PATCH',
                body: { role: next }
            });
        }
        return (await listMembers(caseKey)).map(toDisplayMember);
    }

    /**
     * Who the actor is on the case. The actor must be able to read the case as themselves; their role
     * then comes from the junction, so someone with no usable role can do nothing here.
     */
    async function getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId } = {}) {
        if (!accessToken) {
            throw new ValidationError(msg('directus.user_token_required'), null, 'directus.user_token_required');
        }
        const caseKey = String(caseId || '').trim();
        if (!caseKey) {
            throw new ValidationError(msg('case.case_id_required'), null, 'case.case_id_required');
        }
        const actorId = String(actorDirectusUserId || '').trim();
        if (!actorId) {
            throw new ValidationError(msg('directus.actor_directus_user_id_required'), null, 'directus.actor_directus_user_id_required');
        }

        const meta = (await fetchDirectus(`/items/case/${encodeURIComponent(caseKey)}`, {
            accessToken,
            query: { fields: 'id,title' }
        }))?.data;

        const members = await listMembers(caseKey);
        const actorRole = members.find((m) => m.id === actorId)?.role || null;
        return {
            caseKey,
            caseTitle: meta?.title != null ? String(meta.title) : null,
            actorId,
            actorRole,
            actorIsAdmin: actorRole === CASE_COLLAB_ROLES.ADMIN,
            actorCanInvite: actorRole === CASE_COLLAB_ROLES.ADMIN || actorRole === CASE_COLLAB_ROLES.COLLABORATOR,
            existingList: members.map(toDisplayMember)
        };
    }

    /** Add one collaborator (admin path and invite approval). Changes the role if already on the case. */
    async function addCaseCollaborator(caseId, userId, role, { accessToken, actorDirectusUserId } = {}) {
        const ctx = await getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId });
        if (!ctx.actorIsAdmin) {
            throw new ForbiddenError(msg('case.people_add_admin_only'), null, 'case.people_add_admin_only');
        }
        return { id: ctx.caseKey, collaborators: await upsertMember(ctx.caseKey, userId, role) };
    }

    /** Add a collaborator with no acting user: a verified signup-invite redeem or a migration. */
    async function addCaseCollaboratorAsSystem(caseId, userId, role) {
        const caseKey = String(caseId || '').trim();
        return { id: caseKey, collaborators: await upsertMember(caseKey, userId, role) };
    }

    /** The creator of a new case becomes its admin. */
    async function addCaseCreatorAsAdmin(caseId, userId) {
        return upsertMember(caseId, userId, CASE_COLLAB_ROLES.ADMIN);
    }

    /**
     * Replace the whole collaborator set of a case (the People dialog).
     * Admins may add, remove and change roles. Collaborators may not change people here: they add
     * through an invite that an admin approves. A case always keeps at least one admin.
     */
    async function setCaseCollaborators(caseId, collaborators, {
        accessToken,
        actorDirectusUserId,
        allowCollaboratorCreates = false
    } = {}) {
        const ctx = await getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId });
        if (!ctx.actorCanInvite) {
            throw new ForbiddenError(msg('case.people_change_forbidden'), null, 'case.people_change_forbidden');
        }

        const desired = new Map();
        for (const entry of Array.isArray(collaborators) ? collaborators : []) {
            const userId = typeof entry === 'string'
                ? entry.trim()
                : String(entry?.userId || entry?.id || entry?.directus_users_id || '').trim();
            if (!userId) continue;
            let role = typeof entry === 'string' ? CASE_COLLAB_ROLES.COLLABORATOR : requestedCaseRole(entry.role);
            if (!ctx.actorIsAdmin && role === CASE_COLLAB_ROLES.ADMIN) role = CASE_COLLAB_ROLES.COLLABORATOR;
            desired.set(userId, role);
        }

        const existing = new Map((await listMembers(ctx.caseKey)).map((m) => [m.id, m]));
        const toDelete = [...existing.values()].filter((m) => !desired.has(m.id));
        const toCreate = [...desired].filter(([id]) => !existing.has(id));
        const toUpdate = [...desired].filter(([id, role]) => existing.has(id) && existing.get(id).role !== role);

        if (!ctx.actorIsAdmin) {
            if (toDelete.length || toUpdate.length) {
                throw new ForbiddenError(msg('case.people_change_denied'), null, 'case.people_change_denied');
            }
            if (toCreate.length && !allowCollaboratorCreates) {
                throw new ForbiddenError(msg('case.people_add_needs_admin'), null, 'case.people_add_needs_admin');
            }
        }
        if (![...desired.values()].includes(CASE_COLLAB_ROLES.ADMIN)) {
            throw new ValidationError(msg('case.last_admin_required'), null, 'case.last_admin_required');
        }

        // Adds first, then promotions to admin, then other role changes, and removals last, so the case
        // never passes through "no admin" (the database also refuses that state).
        const promotionsFirst = (a, b) => Number(b[1] === CASE_COLLAB_ROLES.ADMIN) - Number(a[1] === CASE_COLLAB_ROLES.ADMIN);
        toUpdate.sort(promotionsFirst);
        try {
            for (const [userId, role] of toCreate) {
                await fetchDirectus(`/items/${JUNCTION}`, {
                    method: 'POST',
                    body: { case_id: ctx.caseKey, directus_users_id: userId, role }
                });
            }
            for (const [userId, role] of toUpdate) {
                await fetchDirectus(`/items/${JUNCTION}/${encodeURIComponent(existing.get(userId).junctionId)}`, {
                    method: 'PATCH',
                    body: { role }
                });
            }
            for (const member of toDelete) {
                await fetchDirectus(`/items/${JUNCTION}/${encodeURIComponent(member.junctionId)}`, { method: 'DELETE' });
            }
        } catch (err) {
            console.error('Case collaborators update failed:', err.message || err);
            throw new AppError(msg('case.people_update_failed'), 502, 'CASE_COLLABORATORS_UPDATE_FAILED', 'case.people_update_failed');
        }

        return { id: ctx.caseKey, collaborators: (await listMembers(ctx.caseKey)).map(toDisplayMember) };
    }

    return {
        listMembersByCaseIds,
        listCaseIdsForUser,
        getCaseCollabActorContext,
        addCaseCollaborator,
        addCaseCollaboratorAsSystem,
        addCaseCreatorAsAdmin,
        setCaseCollaborators
    };
}

const defaultInstance = createCaseCollaborators({ fetchDirectus: (...args) => directusFetch(...args) });

export const {
    listMembersByCaseIds,
    listCaseIdsForUser,
    getCaseCollabActorContext,
    addCaseCollaborator,
    addCaseCollaboratorAsSystem,
    addCaseCreatorAsAdmin,
    setCaseCollaborators
} = defaultInstance;
