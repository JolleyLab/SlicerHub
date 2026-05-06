import { API_URL } from '../config.js';

export async function lookupUserByEmailExact(email) {
    const response = await fetch(`${API_URL}/api/users/lookup?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        credentials: 'include'
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    if (!response.ok) {
        const message = data.error?.message || data.message || 'Failed to lookup user';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data.user;
}
