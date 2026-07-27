import { API_URL } from '../config.js';

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
        const message = data.error?.message || data.message || 'Failed to create project';
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
        const message = data.error?.message || data.message || 'Failed to load projects';
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
        const message = data.error?.message || data.message || 'Failed to load project';
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
        const message = data.error?.message || data.message || 'Failed to update collaborators';
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
        const message = data.error?.message || data.message || 'Failed to load project files';
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
        const message = data.error?.message || data.message || 'Failed to update file title';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}
