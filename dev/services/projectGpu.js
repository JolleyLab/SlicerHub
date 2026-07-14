import { API_URL } from '../config.js';

async function parseResponse(response) {
    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }
    if (!response.ok) {
        const message = data.error?.message || data.message || data.error || 'Request failed';
        const err = new Error(typeof message === 'string' ? message : 'Request failed');
        err.status = response.status;
        throw err;
    }
    return data;
}

export async function listGpuProviders() {
    const response = await fetch(`${API_URL}/api/gpu/providers`, {
        credentials: 'include'
    });
    return parseResponse(response);
}

export async function getProjectGpu(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu`, {
        credentials: 'include'
    });
    return parseResponse(response);
}

export async function saveProjectGpuSettings(projectId, settings) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings)
    });
    return parseResponse(response);
}

export async function configureProjectGpuProvider(projectId, { providerId, apiKey, setAsDefault }) {
    const payload = { configureProvider: providerId };
    if (apiKey) payload.apiKey = apiKey;
    if (setAsDefault) payload.setAsDefault = true;
    return saveProjectGpuSettings(projectId, payload);
}

export async function setActiveProjectGpuProvider(projectId, providerId) {
    return saveProjectGpuSettings(projectId, { providerId });
}

export async function setProjectGpuDefaultProvider(projectId, defaultProviderId) {
    return saveProjectGpuSettings(projectId, { defaultProviderId });
}

export async function setProjectGpuLocalSlicerViewerOptions(projectId, options = {}) {
    const payload = {};
    if (options.useFullSlicer !== undefined) {
        payload.useFullSlicer = !!options.useFullSlicer;
    }
    if (options.useSimplifiedViewer !== undefined) {
        payload.useSimplifiedViewer = !!options.useSimplifiedViewer;
    }
    return saveProjectGpuSettings(projectId, payload);
}

/** @deprecated Prefer setProjectGpuLocalSlicerViewerOptions */
export async function setProjectGpuUseFullSlicer(projectId, useFullSlicer) {
    return setProjectGpuLocalSlicerViewerOptions(projectId, { useFullSlicer: !!useFullSlicer });
}

export async function openFullSlicerViewer(projectId, fileId, options = {}) {
    const body = { fileId };
    if (options.useSimplifiedViewer !== undefined) {
        body.useSimplifiedViewer = !!options.useSimplifiedViewer;
    }
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/open-full-slicer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    return parseResponse(response);
}

export async function startProjectGpuBilling(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/start`, {
        method: 'POST',
        credentials: 'include'
    });
    return parseResponse(response);
}

export async function stopProjectGpuBilling(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/stop`, {
        method: 'POST',
        credentials: 'include'
    });
    return parseResponse(response);
}

export async function acknowledgeProjectGpuError(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/acknowledge-error`, {
        method: 'POST',
        credentials: 'include'
    });
    return parseResponse(response);
}

export async function sendProjectGpuHeartbeat(projectId, { viewerActive = false } = {}) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ viewerActive: !!viewerActive })
    });
    return parseResponse(response);
}

export async function prestageProjectGpu(projectId, { fileIds = null } = {}) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/gpu/prestage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(fileIds?.length ? { fileIds } : {})
    });
    return parseResponse(response);
}
