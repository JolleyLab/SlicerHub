/**
 * People and data for the workflow route tests: case 1 is owned by ADMIN, MEMBER collaborates on
 * it, READER is read_only on it, STRANGER has no access. Workflows 10 (MEMBER, private),
 * 11 (MEMBER, public), 12 (ADMIN, private).
 */

import { mocks } from './caseRouteMocks.mjs';
import { fakePayload } from './routeHarness.mjs';
import { workflowSearchText } from '../../../../backend/src/payload/collections.js';

export const ADMIN = { id: 1, role: 'user', keycloakSub: 'kc-admin' };
export const MEMBER = { id: 2, role: 'user', keycloakSub: 'kc-member' };
export const STRANGER = { id: 3, role: 'user', keycloakSub: 'kc-stranger' };
export const READER = { id: 4, role: 'user', keycloakSub: 'kc-reader' };

/** A stored workflow row; `fields` override the defaults. Has its search text, as if saved through Payload. */
export function workflow(id, owner, visibility, extensions = ['SlicerHeart'], fields = {}) {
    const doc = { id, name: `WF ${id}`, owner_id: owner, visibility, extensions, updatedAt: '2026-01-01T00:00:00.000Z', ...fields };
    return { ...doc, search_text: workflowSearchText(doc) };
}

/** Fresh in-memory data and roles; call from beforeEach. */
export function seedWorkflows() {
    mocks.reset(fakePayload({
        cases: [{ id: 1, title: 'Case', owner_id: 'kc-admin' }],
        workflows: [
            workflow(10, 'kc-member', 'private', ['SlicerIGT']),
            workflow(11, 'kc-member', 'public', ['SlicerRT', 'SlicerHeart']),
            workflow(12, 'kc-admin', 'private'),
        ],
    }));
    mocks.caseRoles['kc-member:1'] = 'collaborator';
    mocks.caseRoles['kc-reader:1'] = 'read_only';
    mocks.names = { 'kc-member': 'Mia Member', 'kc-reader': 'Rae Reader', 'kc-admin': 'Ada Admin' };
}
