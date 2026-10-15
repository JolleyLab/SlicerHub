// Name of the pre-configured group that can approve invitations.
export const INVITE_APPROVERS_GROUP_NAME = 'Registration Reviewers';

// Role names (case-insensitive) whose members are seeded into that group.
const ADMIN_ROLE_NAMES = ['administrator', 'orgadmin'];

/**
 * Ensure the "Registration Reviewers" special group exists and contains all current
 * Administrator / OrgAdmin users. Idempotent — safe to re-run.
 */
export async function seedInviteApprovers(client, { dryRun }) {
    console.log(`▸ seed: ${INVITE_APPROVERS_GROUP_NAME}`);
    const plan = [];

    // 1. Find or create the group
    let groupId;
    let existing;
    try {
        existing = await client.get(
            `/items/task_groups?filter[name][_eq]=${encodeURIComponent(INVITE_APPROVERS_GROUP_NAME)}&fields=id&limit=1`
        );
    } catch (err) {
        // On a brand-new target, --dry-run never actually creates task_groups (step 1 is a
        // preview, not a write) — so this collection may genuinely not exist yet. That's
        // expected here, not a failure: a real (non-dry-run) run creates it in step 1 first.
        if (dryRun && /doesn't have permission|does not exist|forbidden/i.test(err.message || '')) {
            console.log('  - (dry-run) task_groups doesn\'t exist yet on this target — schema step would create it first on a real run');
            console.log('');
            return;
        }
        throw err;
    }
    const existingRows = Array.isArray(existing) ? existing : [];
    if (existingRows.length > 0) {
        groupId = existingRows[0].id;
        plan.push(`group already exists (id: ${groupId})`);
        // Ensure can_approve_registrations is true
        if (!dryRun) {
            await client.patch(`/items/task_groups/${encodeURIComponent(groupId)}`, {
                can_approve_registrations: true
            });
        }
    } else {
        plan.push(`create group "${INVITE_APPROVERS_GROUP_NAME}" with can_approve_registrations=true`);
        if (!dryRun) {
            const created = await client.post('/items/task_groups', {
                name: INVITE_APPROVERS_GROUP_NAME,
                description: 'Members of this group can approve new user registration requests.',
                can_approve_registrations: true
            });
            groupId = created?.id;
        }
    }

    if (dryRun) {
        plan.push('(dry-run: skipping user sync)');
        for (const line of plan) console.log(`  - ${line}`);
        console.log('');
        return;
    }

    // 2. Find roles matching admin names
    const roles = await client.get('/roles?fields=id,name&limit=-1');
    const roleRows = Array.isArray(roles) ? roles : [];
    const adminRoleIds = roleRows
        .filter(r => ADMIN_ROLE_NAMES.includes(String(r.name || '').toLowerCase()))
        .map(r => r.id);

    if (adminRoleIds.length === 0) {
        plan.push('no Administrator/OrgAdmin roles found — skipping user sync');
        for (const line of plan) console.log(`  - ${line}`);
        console.log('');
        return;
    }

    // 3. Fetch all users with those roles
    const usersFilter = adminRoleIds
        .map(id => `filter[role][_in]=${encodeURIComponent(id)}`)
        .join('&');
    const users = await client.get(`/users?${usersFilter}&fields=id,email,first_name&limit=-1`);
    const userRows = Array.isArray(users) ? users : [];

    // 4. Fetch existing members to avoid duplicates
    const membersRes = await client.get(
        `/items/task_group_members?filter[task_group][_eq]=${encodeURIComponent(groupId)}&fields=directus_user&limit=-1`
    );
    const memberRows = Array.isArray(membersRes) ? membersRes : [];
    const existingMemberIds = new Set(memberRows.map(m =>
        typeof m.directus_user === 'object' ? m.directus_user?.id : m.directus_user
    ).filter(Boolean));

    // 5. Add missing users
    let added = 0;
    for (const user of userRows) {
        if (existingMemberIds.has(user.id)) continue;
        await client.post('/items/task_group_members', {
            task_group: groupId,
            directus_user: user.id,
            can_manage_group: false
        });
        plan.push(`added ${user.email || user.id}`);
        added++;
    }

    if (added === 0) plan.push('all admin users already members — nothing to add');
    for (const line of plan) console.log(`  - ${line}`);
    console.log('');
}
