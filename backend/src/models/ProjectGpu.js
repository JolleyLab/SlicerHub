import db from '../db/database.js';
import { formatGpuError, GPU_ERROR_SOURCES } from '../gpu/errors.js';
import { decryptCredentials, encryptCredentials, maskSecret } from '../gpu/credentials.js';

const STATUSES = new Set(['idle', 'provisioning', 'running', 'stopping', 'error']);

function emptyCredentialStore() {
    return { providers: {} };
}

/** @returns {{ providers: Record<string, object> }} */
function parseCredentialStore(blob) {
    if (!blob || typeof blob !== 'object') {
        return emptyCredentialStore();
    }
    if (blob.providers && typeof blob.providers === 'object') {
        return { providers: { ...blob.providers } };
    }
    if (blob.apiKey) {
        return { providers: { vast: { apiKey: blob.apiKey } } };
    }
    return emptyCredentialStore();
}

function getProviderCreds(store, providerId) {
    return store?.providers?.[providerId] || {};
}

function isProviderConfigured(store, providerId) {
    if (providerId === 'local') return true;
    return !!getProviderCreds(store, providerId).apiKey;
}

function readSettingsRow(projectId) {
    return db.prepare(`
        SELECT project_id, provider_id, default_provider_id, credentials_enc, updated_at, updated_by_user_id
        FROM project_gpu_settings
        WHERE project_id = ?
    `).get(projectId);
}

function writeCredentialStore(projectId, store, { providerId, defaultProviderId, updatedByUserId }) {
    const encrypted = encryptCredentials(store);
    const resolvedDefault = defaultProviderId || providerId || 'local';
    const existing = readSettingsRow(projectId);
    if (existing) {
        db.prepare(`
            UPDATE project_gpu_settings
            SET provider_id = ?, default_provider_id = ?, credentials_enc = ?,
                updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?
            WHERE project_id = ?
        `).run(providerId, resolvedDefault, encrypted, updatedByUserId, projectId);
    } else {
        db.prepare(`
            INSERT INTO project_gpu_settings (
                project_id, provider_id, default_provider_id, credentials_enc, updated_by_user_id
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(projectId, providerId, resolvedDefault, encrypted, updatedByUserId);
    }
}
function parseMetadata(row) {
    if (!row?.metadata_json) return {};
    try {
        return JSON.parse(row.metadata_json);
    } catch {
        return {};
    }
}

function rowToInstance(row) {
    if (!row) return null;
    return {
        projectId: row.project_id,
        providerId: row.provider_id,
        status: row.status,
        instanceId: row.instance_id,
        gpuHost: row.gpu_host,
        sshHost: row.ssh_host,
        sshPort: row.ssh_port,
        trameApiPort: row.trame_api_port,
        viewerPort: row.viewer_port,
        trameServiceUrl: row.trame_service_url,
        viewerPublicBaseUrl: row.viewer_public_base_url,
        metadata: parseMetadata(row),
        errorMessage: row.error_message,
        provisionStartedAt: row.provision_started_at,
        provisionFinishedAt: row.provision_finished_at,
        destroyedAt: row.destroyed_at,
        billingLastActivityAt: row.billing_last_activity_at,
        createdByUserId: row.created_by_user_id,
        updatedAt: row.updated_at
    };
}

const ProjectGpu = {
    getCredentialStore(projectId) {
        const row = readSettingsRow(projectId);
        const decrypted = decryptCredentials(row?.credentials_enc);
        if (decrypted === null && row?.credentials_enc) {
            return { store: emptyCredentialStore(), unreadable: true };
        }
        return { store: parseCredentialStore(decrypted), unreadable: false };
    },

    getSettings(projectId) {
        const row = readSettingsRow(projectId);

        if (!row) {
            return {
                projectId,
                providerId: 'local',
                defaultProviderId: 'local',
                hasApiKey: false,
                apiKeyMasked: '',
                useFullSlicer: false,
                updatedAt: null
            };
        }

        const { store, unreadable } = this.getCredentialStore(projectId);
        if (unreadable) {
            return {
                projectId: row.project_id,
                providerId: row.provider_id,
                defaultProviderId: row.default_provider_id || row.provider_id || 'local',
                hasApiKey: false,
                apiKeyMasked: '',
                useFullSlicer: false,
                credentialsUnreadable: true,
                updatedAt: row.updated_at
            };
        }

        const activeId = row.provider_id || 'local';
        const activeCreds = getProviderCreds(store, activeId);
        const localPrefs = getProviderCreds(store, 'local');
        return {
            projectId: row.project_id,
            providerId: activeId,
            defaultProviderId: row.default_provider_id || activeId || 'local',
            hasApiKey: activeId !== 'local' ? !!activeCreds.apiKey : false,
            apiKeyMasked: maskSecret(activeCreds.apiKey),
            useFullSlicer: localPrefs.useFullSlicer === true,
            updatedAt: row.updated_at
        };
    },

    setLocalOptions({ projectId, useFullSlicer, updatedByUserId }) {
        const row = readSettingsRow(projectId);
        const { store, unreadable } = this.getCredentialStore(projectId);
        if (unreadable) {
            throw new Error(
                'Stored GPU credentials cannot be read. Re-configure remote providers before changing local options.'
            );
        }

        store.providers.local = {
            ...getProviderCreds(store, 'local'),
            useFullSlicer: useFullSlicer === true
        };

        const activeId = row?.provider_id || 'local';
        const defaultId = row?.default_provider_id || activeId || 'local';
        writeCredentialStore(projectId, store, {
            providerId: activeId,
            defaultProviderId: defaultId,
            updatedByUserId
        });
    },

    getCredentials(projectId) {
        const row = readSettingsRow(projectId);
        const activeId = row?.provider_id || 'local';
        if (activeId === 'local') {
            return {};
        }

        const { store, unreadable } = this.getCredentialStore(projectId);
        if (unreadable) {
            throw new Error(
                'Stored GPU API key cannot be read (encryption key may have changed). '
                + 'Re-enter your API key in project GPU settings and save.'
            );
        }

        const creds = getProviderCreds(store, activeId);
        if (!creds.apiKey) {
            throw new Error(`No credentials configured for GPU provider: ${activeId}`);
        }
        return creds;
    },

    configureProvider({ projectId, providerId, credentials, setAsDefault, updatedByUserId }) {
        const row = readSettingsRow(projectId);
        const { store, unreadable } = this.getCredentialStore(projectId);
        if (unreadable && !credentials?.apiKey) {
            throw new Error(
                'Stored GPU API key cannot be read. Re-enter your API key and save again.'
            );
        }

        const prev = getProviderCreds(store, providerId);
        const next = { ...prev, ...(credentials || {}) };
        if (!credentials?.apiKey && prev.apiKey) {
            next.apiKey = prev.apiKey;
        }

        if (providerId === 'vast' && !next.apiKey) {
            throw new Error('Vast API key is required');
        }

        store.providers[providerId] = next;
        const activeId = row?.provider_id || 'local';
        const defaultId = row?.default_provider_id || activeId || 'local';
        writeCredentialStore(projectId, store, {
            providerId: activeId,
            defaultProviderId: defaultId,
            updatedByUserId
        });

        if (setAsDefault) {
            this.setDefaultProvider({ projectId, providerId, updatedByUserId });
            const instance = this.getInstance(projectId);
            const status = instance?.status || 'idle';
            if (['idle', 'error'].includes(status)) {
                this.setActiveProvider({ projectId, providerId, updatedByUserId });
            }
        }
    },

    setDefaultProvider({ projectId, providerId, updatedByUserId }) {
        if (providerId !== 'local') {
            const { store, unreadable } = this.getCredentialStore(projectId);
            if (unreadable) {
                throw new Error(
                    'Stored GPU credentials cannot be read. Re-configure the provider.'
                );
            }
            if (!isProviderConfigured(store, providerId)) {
                throw new Error('Configure this GPU provider before setting it as default.');
            }
        }

        const row = readSettingsRow(projectId);
        if (row) {
            db.prepare(`
                UPDATE project_gpu_settings
                SET default_provider_id = ?, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?
                WHERE project_id = ?
            `).run(providerId, updatedByUserId, projectId);
        } else {
            writeCredentialStore(projectId, emptyCredentialStore(), {
                providerId: providerId,
                defaultProviderId: providerId,
                updatedByUserId
            });
        }
    },

    setActiveProvider({ projectId, providerId, updatedByUserId }) {
        const row = readSettingsRow(projectId);
        const { store, unreadable } = this.getCredentialStore(projectId);
        if (providerId !== 'local') {
            const referencedOnRow = row?.provider_id === providerId
                || row?.default_provider_id === providerId;
            if (unreadable) {
                if (!referencedOnRow) {
                    throw new Error(
                        'Stored GPU credentials cannot be read. Re-configure the provider.'
                    );
                }
            } else if (!isProviderConfigured(store, providerId)) {
                throw new Error('Configure this GPU provider before selecting it.');
            }
        }

        if (row) {
            db.prepare(`
                UPDATE project_gpu_settings
                SET provider_id = ?, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?
                WHERE project_id = ?
            `).run(providerId, updatedByUserId, projectId);
        } else {
            writeCredentialStore(projectId, emptyCredentialStore(), {
                providerId,
                defaultProviderId: row?.default_provider_id || providerId,
                updatedByUserId
            });
        }

        if (providerId !== 'local') {
            this.ensureInstanceRow({
                projectId,
                providerId,
                createdByUserId: updatedByUserId
            });
        }
    },

    /** @deprecated Use configureProvider / setActiveProvider */
    upsertSettings({ projectId, providerId, credentials, updatedByUserId }) {
        if (credentials?.apiKey) {
            this.configureProvider({
                projectId,
                providerId: providerId === 'local' ? 'vast' : providerId,
                credentials,
                updatedByUserId
            });
        }
        this.setActiveProvider({ projectId, providerId, updatedByUserId });
    },

    getInstance(projectId) {
        const row = db.prepare('SELECT * FROM project_gpu_instances WHERE project_id = ?').get(projectId);
        return rowToInstance(row);
    },

    ensureInstanceRow({ projectId, providerId, createdByUserId }) {
        const existing = db.prepare('SELECT project_id FROM project_gpu_instances WHERE project_id = ?').get(projectId);
        if (existing) return;
        db.prepare(`
            INSERT INTO project_gpu_instances (project_id, provider_id, status, created_by_user_id)
            VALUES (?, ?, 'idle', ?)
        `).run(projectId, providerId, createdByUserId);
    },

    setProvisioning({ projectId, providerId, createdByUserId }) {
        this.ensureInstanceRow({ projectId, providerId, createdByUserId });
        db.prepare(`
            UPDATE project_gpu_instances
            SET provider_id = ?, status = 'provisioning', error_message = NULL,
                provision_started_at = CURRENT_TIMESTAMP, provision_finished_at = NULL,
                destroyed_at = NULL, updated_at = CURRENT_TIMESTAMP,
                created_by_user_id = COALESCE(created_by_user_id, ?)
            WHERE project_id = ?
        `).run(providerId, createdByUserId, projectId);
    },

    setProvisioningInstanceId(projectId, instanceId) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET instance_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ? AND status = 'provisioning'
        `).run(String(instanceId), projectId);
    },

    touchBillingActivity(projectId) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET billing_last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ? AND status = 'running'
        `).run(projectId);
    },

    listRunningRemote() {
        const rows = db.prepare(`
            SELECT * FROM project_gpu_instances
            WHERE status = 'running' AND provider_id != 'local'
        `).all();
        return rows.map(rowToInstance);
    },

    listActiveRemote() {
        const rows = db.prepare(`
            SELECT * FROM project_gpu_instances
            WHERE status IN ('running', 'provisioning', 'stopping')
            AND provider_id != 'local'
        `).all();
        return rows.map(rowToInstance);
    },

    patchMetadata(projectId, updater) {
        const row = db.prepare('SELECT metadata_json FROM project_gpu_instances WHERE project_id = ?').get(projectId);
        const current = parseMetadata(row);
        const next = updater(current) || current;
        db.prepare(`
            UPDATE project_gpu_instances
            SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(JSON.stringify(next), projectId);
        return next;
    },

    setRunning(projectId, fields) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'running',
                instance_id = ?,
                gpu_host = ?,
                ssh_host = ?,
                ssh_port = ?,
                trame_api_port = ?,
                viewer_port = ?,
                trame_service_url = ?,
                viewer_public_base_url = ?,
                metadata_json = ?,
                error_message = NULL,
                provision_finished_at = CURRENT_TIMESTAMP,
                billing_last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(
            fields.instanceId,
            fields.gpuHost,
            fields.sshHost,
            fields.sshPort,
            fields.trameApiPort,
            fields.viewerPort,
            fields.trameServiceUrl,
            fields.viewerPublicBaseUrl,
            JSON.stringify(fields.metadata || {}),
            projectId
        );
    },

    setStopping(projectId) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'stopping', error_message = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(projectId);
    },

    setIdle(projectId) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'idle',
                instance_id = NULL,
                gpu_host = NULL,
                ssh_host = NULL,
                ssh_port = NULL,
                trame_api_port = NULL,
                viewer_port = NULL,
                trame_service_url = NULL,
                viewer_public_base_url = NULL,
                metadata_json = NULL,
                error_message = NULL,
                billing_last_activity_at = NULL,
                destroyed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(projectId);
    },

    setError(projectId, message, { source = GPU_ERROR_SOURCES.APP } = {}) {
        const safe = formatGpuError(message, source).slice(0, 2000);
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(safe, projectId);
    },

    /** Clear error state when there is no remote instance to destroy. */
    clearError(projectId) {
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'idle',
                error_message = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ? AND status = 'error' AND (instance_id IS NULL OR instance_id = '')
        `).run(projectId);
    },

    /** Remote instance removed outside the app (Vast console, revoked, etc.). */
    setExternallyStopped(projectId, message) {
        const safe = String(message || 'GPU instance is no longer available').slice(0, 2000);
        db.prepare(`
            UPDATE project_gpu_instances
            SET status = 'error',
                error_message = ?,
                instance_id = NULL,
                gpu_host = NULL,
                ssh_host = NULL,
                ssh_port = NULL,
                trame_api_port = NULL,
                viewer_port = NULL,
                trame_service_url = NULL,
                viewer_public_base_url = NULL,
                metadata_json = NULL,
                billing_last_activity_at = NULL,
                destroyed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(safe, projectId);
    },

    isRemoteRunning(instance) {
        return instance
            && instance.providerId !== 'local'
            && instance.status === 'running'
            && instance.trameServiceUrl;
    }
};

export default ProjectGpu;
