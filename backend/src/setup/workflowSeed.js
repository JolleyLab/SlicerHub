/**
 * Run by scripts/setup-payload.mjs, not the server; safe to run again.
 * - The built-in public workflows "SlicerHeart" and "SlicerHeart – Simplified", owned by
 *   SYSTEM_OWNER so nobody can edit or delete them. They replace SlicerWeb loading SlicerHeart itself.
 * - A one-off migration (remove once every installation has run it): cases from before workflows
 *   get both approved, SlicerHeart as default, and `workflows_seeded`, so removing them later sticks.
 */

import { getPayloadClient } from '../payload/index.js';
import { msg } from '../i18n/index.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, REQUEST_STATUS, SIMPLIFIED_VIEWER_MODULE, VIEWER, viewerOf, findAll, workflowCopy, isApproved,
} from '../services/workflows.js';
import { clearRequesters } from '../services/workflowRequests.js';

export const SYSTEM_OWNER = 'system';

/** The seeded workflows, told apart by their start module (names can be reworded in i18n). */
const SEEDS = [
    { module: null, viewer: VIEWER.SLICERWEB, name: 'workflow.seed_slicerheart_name', description: 'workflow.seed_slicerheart_description' },
    // SimplifiedViewer only starts in Full Slicer.
    { module: SIMPLIFIED_VIEWER_MODULE, viewer: VIEWER.FULL, name: 'workflow.seed_simplified_name', description: 'workflow.seed_simplified_description' },
];

const startModule = (doc) => doc.startup_config?.module || null;

/** The seeded workflows, created if missing (and given their viewer if it differs): [slicerHeart, simplified]. */
export async function ensureSeedWorkflows() {
    const payload = getPayloadClient();
    const existing = await findAll(WORKFLOWS, { owner_id: { equals: SYSTEM_OWNER } });
    return Promise.all(SEEDS.map(async (seed) => {
        const doc = existing.find((d) => startModule(d) === seed.module);
        if (doc) {
            return viewerOf(doc) === seed.viewer
                ? doc
                : payload.update({ collection: WORKFLOWS, id: doc.id, data: { viewer: seed.viewer } });
        }
        return payload.create({
            collection: WORKFLOWS,
            data: {
                name: msg(seed.name),
                description: msg(seed.description),
                owner_id: SYSTEM_OWNER,
                visibility: 'public',
                extensions: ['SlicerHeart'],
                file_types: [],
                startup_config: seed.module ? { module: seed.module } : {},
                viewer: seed.viewer,
            },
        });
    }));
}

/** Approve `source` for a case unless it's already approved there; returns the approved row. */
async function approveOnce(caseId, source) {
    const payload = getPayloadClient();
    const [row] = await findAll(CASE_WORKFLOWS, { case: { equals: caseId }, workflow: { equals: String(source.id) } });
    if (row && isApproved(row)) return row;
    const data = { ...workflowCopy(source), status: REQUEST_STATUS.APPROVED, decided_by: SYSTEM_OWNER, decided_at: new Date().toISOString() };
    if (row) await clearRequesters(caseId, source.id); // a request for it is simply met
    return row
        ? payload.update({ collection: CASE_WORKFLOWS, id: row.id, data })
        : payload.create({ collection: CASE_WORKFLOWS, data: { case: caseId, ...data } });
}

/** Set up every case from before workflows: both seeds approved, SlicerHeart the default. Returns how many. */
export async function seedExistingCases([slicerHeart, simplified]) {
    const payload = getPayloadClient();
    let done = 0;
    for (;;) {
        const pending = await findAll('cases', { or: [{ workflows_seeded: { equals: false } }, { workflows_seeded: { exists: false } }] });
        if (!pending.length) return done;
        for (const caseDoc of pending) {
            const heartRow = await approveOnce(caseDoc.id, slicerHeart);
            await approveOnce(caseDoc.id, simplified);
            await payload.update({
                collection: 'cases',
                id: caseDoc.id,
                data: { workflows_seeded: true, ...(caseDoc.default_workflow ? {} : { default_workflow: String(heartRow.id) }) },
            });
            done += 1;
        }
    }
}

/** Both steps, for setup-payload.mjs: { workflows: their names, cases: how many were set up }. */
export async function seedWorkflows() {
    const seeds = await ensureSeedWorkflows();
    return { workflows: seeds.map((w) => w.name), cases: await seedExistingCases(seeds) };
}
