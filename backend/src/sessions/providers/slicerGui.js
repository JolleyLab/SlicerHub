import Docker from 'dockerode';
import { SESSION_KINDS } from '../kinds.js';
import { getSession } from '../leaseRegistry.js';
import { slicerGuiContainerName, safeSlicerGuiUserId } from '../../slicerGui/paths.js';

const docker = new Docker({
    socketPath: process.env.DOCKER_HOST?.replace('unix://', '') || '/var/run/docker.sock'
});

async function removeIfExists(containerName) {
    try {
        const container = docker.getContainer(containerName);
        await container.remove({ force: true });
    } catch (err) {
        if (err.statusCode !== 404) {
            throw err;
        }
    }
}

export async function listPerUserSlicerGuiContainers() {
    const containers = await docker.listContainers({ all: true });
    return containers
        .filter((item) => {
            const name = (item.Names?.[0] || '').replace(/^\//, '');
            return name.startsWith('slicer-gui-') && name !== 'slicer-gui';
        })
        .map((item) => {
            const name = (item.Names?.[0] || '').replace(/^\//, '');
            const userId = item.Labels?.['slicer-gui-user']
                || name.slice('slicer-gui-'.length);
            return { sessionKey: userId, containerName: name, state: item.State };
        });
}

export async function stopSlicerGuiContainer({ sessionKey }) {
    const safeUserId = safeSlicerGuiUserId(sessionKey);
    const containerName = slicerGuiContainerName(safeUserId);
    await removeIfExists(containerName);
    return { stopped: true, containerName };
}

export async function stopAllPerUserSlicerGuiContainers() {
    const running = await listPerUserSlicerGuiContainers();
    for (const { sessionKey } of running) {
        try {
            await stopSlicerGuiContainer({ sessionKey });
        } catch (err) {
            console.warn(`Failed to stop Full Slicer session for user ${sessionKey}:`, err.message);
        }
    }
}

export const slicerGuiProvider = {
    kind: SESSION_KINDS.SLICER_GUI,
    async stop({ sessionKey }) {
        return stopSlicerGuiContainer({ sessionKey });
    },
    async listOrphans() {
        const running = await listPerUserSlicerGuiContainers();
        return running.filter(({ sessionKey }) => !getSession(SESSION_KINDS.SLICER_GUI, sessionKey));
    }
};
