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
