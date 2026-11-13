/**
 * Workflows: saved SlicerWeb setups (docs/workflows-design.md).
 */

import { apiRequest } from './apiResponse.js';

const enc = encodeURIComponent;

export const listMyWorkflows = () => apiRequest('/api/workflows').then((d) => d.workflows);
export const listPublicWorkflows = () => apiRequest('/api/workflows?scope=public').then((d) => d.workflows);
export const getWorkflow = (id) => apiRequest(`/api/workflows/${enc(id)}`).then((d) => d.workflow);
export const createWorkflow = (fields) => apiRequest('/api/workflows', { method: 'POST', body: fields }).then((d) => d.workflow);
export const updateWorkflow = (id, fields) => apiRequest(`/api/workflows/${enc(id)}`, { method: 'PATCH', body: fields }).then((d) => d.workflow);
export const deleteWorkflow = (id) => apiRequest(`/api/workflows/${enc(id)}`, { method: 'DELETE' });

/** What an uploaded workflow icon may be (the server checks the file's contents too). */
export const WORKFLOW_ICON_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const WORKFLOW_ICON_MAX_BYTES = 256 * 1024;

export const uploadWorkflowIcon = (id, file) => {
    const body = new FormData();
    body.append('icon', file);
    return apiRequest(`/api/workflows/${enc(id)}/icon`, { method: 'PUT', body }).then((d) => d.workflow);
};
export const removeWorkflowIcon = (id) => apiRequest(`/api/workflows/${enc(id)}/icon`, { method: 'DELETE' }).then((d) => d.workflow);

/**
 * A case's workflows: { approved, mine, myRequests, defaultWorkflow, allowPersonal, canManage, canRequest },
 * plus for admins `requests` (pending) and `available` (what they could approve).
 */
export const listCaseWorkflows = (caseId) => apiRequest(`/api/cases/${enc(caseId)}/workflows`);

/** "Find more…": public workflows not yet approved, each with `requested` and `requestedByMe`. */
export function listAvailableCaseWorkflows(caseId, { q = '', fileTypes = [] } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (fileTypes.length) params.set('fileTypes', fileTypes.join(','));
    const query = params.toString();
    return apiRequest(`/api/cases/${enc(caseId)}/workflows/available${query ? `?${query}` : ''}`).then((d) => d.workflows);
}
export const requestCaseWorkflow = (caseId, workflowId) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/requests`, { method: 'POST', body: { workflowId } });
export const declineCaseWorkflowRequest = (caseId, rowId, reason = '') =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/${enc(rowId)}/decline`, { method: 'POST', body: { reason } });
/** Case Settings: { defaultWorkflow?, allowPersonal? } → the saved { defaultWorkflow, allowPersonal }. */
export const updateCaseWorkflowSettings = (caseId, settings) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflow-settings`, { method: 'PATCH', body: settings });
export const cancelCaseWorkflowRequest = (caseId, workflowId) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/requests/${enc(workflowId)}`, { method: 'DELETE' });
export const approveCaseWorkflow = (caseId, workflowId) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows`, { method: 'POST', body: { workflowId } }).then((d) => d.approval);
export const removeCaseWorkflow = (caseId, approvalId) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/${enc(approvalId)}`, { method: 'DELETE' });

const catalogs = new Map();

/**
 * The extensions this SlicerWeb build ships ({ name, description, category }), sorted by name.
 * Icons and screenshots are left out on purpose: they are third-party URLs, and loading them
 * would tell those hosts who is browsing.
 */
export function loadExtensionCatalog(channel = 'stable') {
    if (!catalogs.has(channel)) {
        const request = fetch(`/slicerweb/${channel === 'latest' ? 'latest' : 'stable'}/extensions/index.json`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Extension list unavailable (${r.status})`))))
            .then((index) => (index.extensions || [])
                .map(({ name, description = '', category = '' }) => ({
                    name,
                    description: String(description).replace(/<[^>]*>/g, ''), // index text has <i> etc.
                    category,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)));
        request.catch(() => catalogs.delete(channel)); // retry next time
        catalogs.set(channel, request);
    }
    return catalogs.get(channel);
}
