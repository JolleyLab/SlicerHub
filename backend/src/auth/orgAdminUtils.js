import config from '../config/index.js';

/**
 * Returns true when the Directus user has the OrgAdmin or Administrator role.
 * Accepts either a fetchDirectusCurrentUser result object or a raw role
 * field value from findDirectusUserById (object with .name, or UUID string).
 * Falls back to DIRECTUS_ORG_ADMIN_ROLE_ID config when role name is unavailable.
 */
export function isOrgAdminByRole(roleOrUser) {
    // Called with a fetchDirectusCurrentUser result
    if (roleOrUser?.roleName !== undefined) {
        if (roleOrUser.roleName === 'OrgAdmin') return true;
        if (roleOrUser.roleName === 'Administrator') return true;
        const cfgId = config.directus.orgAdminRoleId;
        if (cfgId && roleOrUser.roleId && String(roleOrUser.roleId) === cfgId) return true;
        return false;
    }
    // Called with a raw role value from findDirectusUserById
    const role = roleOrUser;
    if (!role) return false;
    if (role.name === 'OrgAdmin') return true;
    if (role.name === 'Administrator') return true;
    const cfgId = config.directus.orgAdminRoleId;
    const roleId = typeof role === 'string' ? role : role.id;
    if (cfgId && roleId && String(roleId) === cfgId) return true;
    return false;
}
