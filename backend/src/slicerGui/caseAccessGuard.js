/**
 * Full Slicer copies each case file it opens into the person's seat folder
 * (`pl-<attachmentId>-<name>`, stageFile.js), and those copies outlive the session.
 * When someone loses access to a case (removed from the case or from a group that had it,
 * or the case/file was deleted), its copies are deleted and a running seat holding them is
 * stopped, so the data isn't reachable from Slicer's file dialog or the open scene.
 *
 * Checked on the Full Slicer heartbeat (at most once a minute per seat) and before
 * opening a file, so a warm or later session never reuses copies from a lost case.
 */

import fs from 'fs';
import path from 'path';
import { getPayloadClient } from '../payload/index.js';
import { getCaseRoleForSub } from '../utils/caseAccess.js';
import { getSlicerGuiMaxSeatsPerUser, slicerGuiUserDir } from './paths.js';
import { stopSlicerGuiSession } from './sessionManager.js';

const STAGED_FILE = /^pl-(\d+)-/;
const CHECK_EVERY_MS = 60 * 1000;
const lastChecked = new Map(); // `${userId}:${seatId}` -> ms

function stagedCopies(userId, seatId) {
    const dir = slicerGuiUserDir(userId, seatId);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names
        .map((name) => ({ name, attachmentId: name.match(STAGED_FILE)?.[1] }))
        .filter((f) => f.attachmentId)
        .map((f) => ({ ...f, path: path.join(dir, f.name) }));
}

/** Site/org admins can open every case, like getCaseRole(). */
function isSiteAdmin(user) {
    return user?.role === 'admin' || user?.role === 'org-admin';
}

/**
 * Delete this seat's copies from cases the person can no longer open.
 * @returns {Promise<{ removed: string[], lostCaseIds: string[] }>}
 *   lostCaseIds: cases whose copies were removed (the seat must not keep running them).
 */
export async function removeCopiesWithoutAccess({ user, seatId }) {
    const none = { removed: [], lostCaseIds: [] };
    const userId = String(user?.id ?? '');
    if (!userId || isSiteAdmin(user)) return none;
    const copies = stagedCopies(userId, seatId);
    if (!copies.length) return none;

    // Only delete when sure: any lookup failure leaves the copies alone.
    let attachmentCase;
    let canOpen;
    try {
        const payload = getPayloadClient();
        const ids = [...new Set(copies.map((c) => Number(c.attachmentId)))];
        const atts = await payload.find({
            collection: 'attachments', where: { id: { in: ids } }, depth: 0, limit: ids.length, pagination: false,
        });
        attachmentCase = new Map(atts.docs.map((a) => [String(a.id), String(a.case?.id ?? a.case)]));
        canOpen = new Map();
        for (const caseId of new Set(attachmentCase.values())) {
            const doc = await payload.findByID({ collection: 'cases', id: caseId, depth: 0 }).catch(() => null);
            canOpen.set(caseId, Boolean(doc && await getCaseRoleForSub(doc, user.keycloakSub)));
        }
    } catch (err) {
        console.warn('[full-slicer] case access check skipped:', err?.message);
        return none;
    }

    const removed = [];
    const lost = new Set();
    for (const copy of copies) {
        const caseId = attachmentCase.get(copy.attachmentId);
        if (caseId && canOpen.get(caseId)) continue;
        // No access, or the file/case was deleted.
        try { fs.unlinkSync(copy.path); removed.push(copy.name); } catch { /* already gone */ }
        lost.add(caseId || `attachment:${copy.attachmentId}`);
    }
    if (removed.length) {
        console.log(`[full-slicer] removed ${removed.length} copy/copies after access ended (user ${userId}, seat ${seatId})`);
    }
    return { removed, lostCaseIds: [...lost] };
}

/**
 * Before opening a file: clean every seat of the person, and stop any seat that held
 * copies from a lost case (a fresh one starts for the new file).
 */
export async function enforceCaseAccessOnAllSeats(user) {
    const max = getSlicerGuiMaxSeatsPerUser();
    for (let seatId = 1; seatId <= max; seatId += 1) {
        const { lostCaseIds } = await removeCopiesWithoutAccess({ user, seatId });
        if (lostCaseIds.length) await stopSlicerGuiSession({ userId: String(user.id), seatId });
    }
}

/**
 * On a heartbeat (throttled to once a minute per seat). If the seat held copies from a
 * case the person lost, the seat is stopped and the lost case ids are returned.
 */
export async function enforceCaseAccessOnHeartbeat(user, seatId) {
    const key = `${user?.id}:${seatId}`;
    const now = Date.now();
    if (now - (lastChecked.get(key) || 0) < CHECK_EVERY_MS) return [];
    lastChecked.set(key, now);
    const { lostCaseIds } = await removeCopiesWithoutAccess({ user, seatId });
    if (lostCaseIds.length) await stopSlicerGuiSession({ userId: String(user.id), seatId });
    return lostCaseIds;
}
