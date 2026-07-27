import Docker from 'dockerode';
import { SESSION_KINDS } from '../kinds.js';
import { getSession } from '../leaseRegistry.js';
import {
    slicerGuiContainerNameFromSessionKey,
    parseSlicerGuiSessionKey
} from '../../slicerGui/paths.js';

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
            const labelUser = item.Labels?.['slicer-gui-user'];
            const labelSeat = item.Labels?.['slicer-gui-seat'];
            let sessionKey;
            if (labelUser && labelSeat) {
                sessionKey = `${labelUser}-seat${labelSeat}`;
            } else if (labelUser) {
                sessionKey = labelUser;
            } else {
                sessionKey = name.slice('slicer-gui-'.length);
            }
            let seatId = null;
            try {
                seatId = parseSlicerGuiSessionKey(sessionKey).seatId;
            } catch {
                seatId = null;
            }
            return {
                sessionKey,
                containerName: name,
                state: item.State,
                seatId
            };
        });
}

export async function stopSlicerGuiContainer({ sessionKey }) {
    const containerName = slicerGuiContainerNameFromSessionKey(sessionKey);
    await removeIfExists(containerName);
    return { stopped: true, containerName };
}

export async function stopAllPerUserSlicerGuiContainers() {
    const running = await listPerUserSlicerGuiContainers();
    for (const { sessionKey } of running) {
        try {
            await stopSlicerGuiContainer({ sessionKey });
        } catch (err) {
            console.warn(`Failed to stop Full Slicer session ${sessionKey}:`, err.message);
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
