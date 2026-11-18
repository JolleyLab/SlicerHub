/**
 * Site admins on cases (docs: the "Case roles" decision, Nov 2026). A site admin (realm role
 * app-admin) is admin on every case through that role. When one is added to a case, the
 * membership is stored as SITE_ADMIN_CASE_ROLE rather than the role chosen, which never had
 * any effect while they were a site admin. If they stop being one, the marker gives read only
 * access, and the case's admins are asked to assign a role (without being told why).
 */

export const SITE_ADMIN_REALM_ROLE = 'app-admin';
export const SITE_ADMIN_CASE_ROLE = 'site_admin';

/** What the marker gives someone who is no longer a site admin. */
export const FORMER_SITE_ADMIN_ROLE = 'read_only';

/** A stored membership role as access, for someone who isn't (or is no longer) a site admin. */
export const memberAccessRole = (role) => (role === SITE_ADMIN_CASE_ROLE ? FORMER_SITE_ADMIN_ROLE : role);
