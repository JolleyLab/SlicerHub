const API_URL = '';

async function parseJson(res) {
    try { return await res.json(); } catch { return {}; }
}

function throwApiError(res, data, fallback) {
    const msg = data?.error?.message || data?.message || fallback;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
}

// --- My groups (non-admin) ---

export async function getMyGroups() {
    const response = await fetch(`${API_URL}/api/my-groups`, { credentials: 'include' });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to load groups');
    return data.data || [];
}

export async function getMyGroup(groupId) {
    const response = await fetch(`${API_URL}/api/my-groups/${encodeURIComponent(groupId)}`, { credentials: 'include' });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to load group');
    return data.data || null;
}

export async function createMyGroup({ name, description } = {}) {
    const response = await fetch(`${API_URL}/api/my-groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to create group');
    return data.data || null;
}

export async function updateMyGroup(groupId, updates) {
    const response = await fetch(`${API_URL}/api/my-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to update group');
    return data.data;
}

export async function getMyGroupMembers(groupId) {
    const response = await fetch(
        `${API_URL}/api/my-groups/${encodeURIComponent(groupId)}/members`,
        { credentials: 'include' }
    );
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to load group members');
    return data.data || [];
}

export async function addMyGroupMember(groupId, { email } = {}) {
    const response = await fetch(`${API_URL}/api/my-groups/${encodeURIComponent(groupId)}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to add member');
    return data.data;
}

export async function updateMyGroupMember(groupId, memberId, updates) {
    const response = await fetch(
        `${API_URL}/api/my-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
        {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        }
    );
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to update member');
    return data.data;
}

export async function removeMyGroupMember(groupId, memberId) {
    const response = await fetch(
        `${API_URL}/api/my-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE', credentials: 'include' }
    );
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to remove member');
}

// --- Admin groups ---

export async function listGroups() {
    const response = await fetch(`${API_URL}/api/admin/groups`, { credentials: 'include' });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to load groups');
    return data.data || [];
}

export async function getAdminGroup(id) {
    const response = await fetch(`${API_URL}/api/admin/groups/${encodeURIComponent(id)}`, {
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to load group');
    return data.data;
}

export async function createAdminGroup({ name, description, canApproveRegistrations }) {
    const response = await fetch(`${API_URL}/api/admin/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, canApproveRegistrations })
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to create group');
    return data.data;
}

export async function updateAdminGroup(id, updates) {
    const response = await fetch(`${API_URL}/api/admin/groups/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to update group');
    return data.data;
}

export async function deleteAdminGroup(id) {
    const response = await fetch(`${API_URL}/api/admin/groups/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to delete group');
    return data;
}

export async function addGroupMember(groupId, { email } = {}) {
    const response = await fetch(`${API_URL}/api/admin/groups/${encodeURIComponent(groupId)}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to add member');
    return data.data;
}

export async function removeGroupMember(groupId, memberId) {
    const response = await fetch(
        `${API_URL}/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE', credentials: 'include' }
    );
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to remove member');
    return data;
}

export async function updateGroupMember(groupId, memberId, updates) {
    const response = await fetch(
        `${API_URL}/api/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
        {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        }
    );
    const data = await parseJson(response);
    if (!response.ok) throwApiError(response, data, 'Failed to update member');
    return data.data;
}
