import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';

export async function createProject({ name, collaborators }) {
    const response = await fetch(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ name, collaborators })
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.createProjectFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function listMyProjects({ limit = 20, offset = 0 } = {}) {
    const response = await fetch(`${API_URL}/api/projects?limit=${limit}&offset=${offset}`, {
        method: 'GET',
        credentials: 'include'
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.loadProjectsFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function getProjectById(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}`, {
        method: 'GET',
        credentials: 'include'
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.loadProjectFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function updateProjectCollaborators(projectId, collaborators) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/collaborators`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ collaborators })
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.updateCollaboratorsFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function listProjectFiles(projectId) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/files`, {
        method: 'GET',
        credentials: 'include'
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.loadProjectFilesFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function updateProjectFileTitle(projectId, fileId, displayTitle) {
    const response = await fetch(`${API_URL}/api/projects/${projectId}/files/${fileId}/title`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ displayTitle })
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || t('errors.updateFileTitleFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

/** CUTOVER (project-case-migrate) */
export async function getProjectCaseMigrateStatus(projectId) {
    const response = await fetch(
        `${API_URL}/api/projects/${encodeURIComponent(projectId)}/migrate-to-case`,
        { method: 'GET', credentials: 'include', cache: 'no-store' }
    );
    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }
    if (!response.ok) {
        const message = data.error?.message || data.message || t('projects.migrateStatusFailed');
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }
    return data;
}

/** CUTOVER (project-case-migrate) — streams NDJSON progress when supported. */
export async function migrateProjectToCase(projectId, { onProgress } = {}) {
    const response = await fetch(
        `${API_URL}/api/projects/${encodeURIComponent(projectId)}/migrate-to-case?stream=1`,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                Accept: 'application/x-ndjson, application/json'
            }
        }
    );

    const contentType = String(response.headers.get('content-type') || '');
    if (contentType.includes('ndjson') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;
        let streamError = null;

        const handleLine = (line) => {
            const trimmed = String(line || '').trim();
            if (!trimmed) return;
            let evt;
            try {
                evt = JSON.parse(trimmed);
            } catch (_) {
                return;
            }
            if (evt.phase === 'done') {
                finalResult = evt.result || evt;
                return;
            }
            if (evt.phase === 'error') {
                streamError = new Error(evt.message || t('projects.migrateFailed'));
                streamError.status = response.status;
                streamError.code = evt.code || null;
                return;
            }
            onProgress?.(evt);
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                handleLine(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
            }
        }
        if (buffer.trim()) handleLine(buffer);

        if (streamError) throw streamError;
        if (!finalResult) {
            const err = new Error(t('projects.migrateFailed'));
            err.status = response.status;
            throw err;
        }
        return finalResult;
    }

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }
    if (!response.ok) {
        const message = data.error?.message || data.message || t('projects.migrateFailed');
        const err = new Error(message);
        err.status = response.status;
        err.code = data.error?.code || null;
        throw err;
    }
    return data;
}
