/**
 * Workflows: saved SlicerWeb setups (docs/workflows-design.md).
 */

import { apiRequest } from './apiResponse.js';
import { NO_TODOS, toBellCount } from '../utils/bellCount.js';

const enc = encodeURIComponent;

/** Who can use a workflow: its owner only, or everyone (backend VISIBILITY). */
export const WORKFLOW_VISIBILITY = Object.freeze({ PRIVATE: 'private', PUBLIC: 'public' });

/** A query string from `params`, leaving out empty values and page 1: '' or '?scope=public&q=…'. */
function queryString(params) {
    const kept = Object.entries(params).filter(([key, value]) => value && !(key === 'page' && Number(value) <= 1));
    return kept.length ? `?${new URLSearchParams(kept.map(([k, v]) => [k, String(v)]))}` : '';
}
/** A page of a list: { items, hasMore }. */
const toPage = (d) => ({ items: d.workflows || [], hasMore: d.hasMore === true });

export const listMyWorkflows = () => apiRequest('/api/workflows').then((d) => d.workflows);
/** Everyone's public workflows, a page at a time: { q, sort ('title' | 'newest' | 'oldest'), page } → { items, hasMore }. */
export const listPublicWorkflows = ({ q, sort, page } = {}) =>
    apiRequest(`/api/workflows${queryString({ scope: WORKFLOW_VISIBILITY.PUBLIC, q, sort, page })}`).then(toPage);
export const getWorkflow = (id) => apiRequest(`/api/workflows/${enc(id)}`).then((d) => d.workflow);
export const createWorkflow = (fields) => apiRequest('/api/workflows', { method: 'POST', body: fields }).then((d) => d.workflow);
export const updateWorkflow = (id, fields) => apiRequest(`/api/workflows/${enc(id)}`, { method: 'PATCH', body: fields }).then((d) => d.workflow);
export const deleteWorkflow = (id) => apiRequest(`/api/workflows/${enc(id)}`, { method: 'DELETE' });

/** Home's To do: pending requests on the cases the user administers, with requester names. */
export const listPendingWorkflowRequests = () => apiRequest('/api/workflow-requests/pending').then((d) => d.requests);
/** The bell's count of those, { count, latestAt }; none if it can't be had, so the bell still works. */
export const pendingWorkflowRequestCount = () =>
    apiRequest('/api/workflow-requests/pending-count').then(toBellCount, () => NO_TODOS);

/** What an uploaded workflow icon may be (the server checks the file's contents too). */
export const WORKFLOW_ICON_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const WORKFLOW_ICON_MAX_BYTES = 256 * 1024;

export const uploadWorkflowIcon = (id, file) => {
    const body = new FormData();
    body.append('icon', file);
    return apiRequest(`/api/workflows/${enc(id)}/icon`, { method: 'PUT', body }).then((d) => d.workflow);
};
export const removeWorkflowIcon = (id) => apiRequest(`/api/workflows/${enc(id)}/icon`, { method: 'DELETE' }).then((d) => d.workflow);

/** What members can launch on a case, its settings, and (admins) the pending requests. */
export const listCaseWorkflows = (caseId) => apiRequest(`/api/cases/${enc(caseId)}/workflows`);

/** "Request or Add": workflows that could join the case, paged: { q, page } → { items, hasMore }. */
export const listAvailableCaseWorkflows = (caseId, { q, page } = {}) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/available${queryString({ q, page })}`).then(toPage);
export const requestCaseWorkflow = (caseId, workflowId) =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/requests`, { method: 'POST', body: { workflowId } });
export const declineCaseWorkflowRequest = (caseId, rowId, reason = '') =>
    apiRequest(`/api/cases/${enc(caseId)}/workflows/${enc(rowId)}/decline`, { method: 'POST', body: { reason } });
/** Case Settings: { defaultWorkflow?, allowPersonal? } → the saved { defaultWorkflow, allowPersonal }. */
/** A file's default for everyone (a menu key), or null for the case default: resolves to { openWith }. */
export const setFileOpenWith = (caseId, attachmentId, openWith) =>
    apiRequest(`/api/cases/${enc(caseId)}/attachments/${enc(attachmentId)}/open-with`, { method: 'PATCH', body: { openWith } });
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
                .map(({ name, description = '', category = '', modules }) => ({
                    name,
                    description: String(description).replace(/<[^>]*>/g, ''), // index text has <i> etc.
                    category,
                    modules: Array.isArray(modules) ? modules.filter((m) => typeof m === 'string') : [],
                }))
                .sort((a, b) => a.name.localeCompare(b.name)));
        request.catch(() => catalogs.delete(channel)); // retry next time
        catalogs.set(channel, request);
    }
    return catalogs.get(channel);
}
