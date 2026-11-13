/**
 * One-off setup, run by scripts/setup-payload.mjs (not by the server): the workflows every
 * SlicerHub starts with, and setting up cases from before workflows existed
 * (docs/workflows-design.md › Viewers and workflows). Safe to run again.
 *
 * - Two public workflows owned by SYSTEM_OWNER, so no person can edit or delete them:
 *   "SlicerHeart", and "SlicerHeart – Simplified" (SlicerHeart, starting in SimplifiedViewer).
 *   SlicerWeb no longer loads SlicerHeart by itself, so these replace that.
 * - Every case without `workflows_seeded` (only cases from before workflows: new cases are created
 *   with it) gets both approved and SlicerHeart as its default, so nothing changes for it. The
 *   marker is then set, so an admin who later removes them doesn't get them back. This half is a
 *   migration: once every installation has run it, it and `workflows_seeded` can go.
 */

import { getPayloadClient } from '../payload/index.js';
import { msg } from '../i18n/index.js';
import { WORKFLOWS, CASE_WORKFLOWS, SIMPLIFIED_VIEWER_MODULE, findAll, workflowCopy, isApproved } from '../services/workflows.js';

export const SYSTEM_OWNER = 'system';

/** The seeded workflows, told apart by their start module (names can be reworded in i18n). */
const SEEDS = [
    { module: null, name: 'workflow.seed_slicerheart_name', description: 'workflow.seed_slicerheart_description' },
    { module: SIMPLIFIED_VIEWER_MODULE, name: 'workflow.seed_simplified_name', description: 'workflow.seed_simplified_description' },
];

const startModule = (doc) => doc.startup_config?.module || null;

/** The seeded workflows, created if missing: [slicerHeart, simplified]. */
export async function ensureSeedWorkflows() {
    const payload = getPayloadClient();
    const existing = await findAll(WORKFLOWS, { owner_id: { equals: SYSTEM_OWNER } });
    return Promise.all(SEEDS.map(async (seed) => existing.find((d) => startModule(d) === seed.module)
        || payload.create({
            collection: WORKFLOWS,
            data: {
                name: msg(seed.name),
                description: msg(seed.description),
                owner_id: SYSTEM_OWNER,
                visibility: 'public',
                extensions: ['SlicerHeart'],
                file_types: [],
                startup_config: seed.module ? { module: seed.module } : {},
            },
        })));
}

/** Approve `source` for a case unless it's already approved there; returns the approved row. */
async function approveOnce(caseId, source) {
    const payload = getPayloadClient();
    const [row] = await findAll(CASE_WORKFLOWS, { case: { equals: caseId }, workflow: { equals: String(source.id) } });
    if (row && isApproved(row)) return row;
    const data = { ...workflowCopy(source), status: 'approved', decided_by: SYSTEM_OWNER, decided_at: new Date().toISOString() };
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
