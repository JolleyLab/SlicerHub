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
