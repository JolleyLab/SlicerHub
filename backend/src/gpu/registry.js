import * as localProvider from './providers/local.js';
import * as vastProvider from './providers/vast/index.js';

const providers = new Map([
    [localProvider.id, localProvider],
    [vastProvider.id, vastProvider]
]);

export function listProviders() {
    return [...providers.values()].map((p) => ({
        id: p.id,
        label: p.label,
        credentialFields: p.credentialFields || [],
        supportsBilling: p.id !== 'local',
        consoleUrl: p.consoleUrl || null
    }));
}

export function getProvider(providerId) {
    const provider = providers.get(providerId);
    if (!provider) {
        throw new Error(`Unknown GPU provider: ${providerId}`);
    }
    return provider;
}
