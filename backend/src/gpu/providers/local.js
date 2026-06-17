export const id = 'local';
export const label = 'Local (Docker Compose)';

export const credentialFields = [];

export async function provision() {
    throw new Error('Local provider does not support remote billing');
}

export async function destroy() {
    // no-op
}

export async function syncFile() {
    // files already on local disk
}
