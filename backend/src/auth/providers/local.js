/**
 * Built-in local auth: credentials checked against the app SQLite users table.
 */

import User from '../../models/User.js';

export const localProvider = {
    name: 'local',

    /**
     * @param {{ identity: string, password: string }} credentials
     * @returns {Promise<{ user: object, externalTokens?: null } | null>}
     */
    async login({ identity, password }) {
        const user = await User.verifyPassword(identity, password);
        if (!user) return null;
        return { user, externalTokens: null };
    }
};
