import Docker from "dockerode";
import fs from "fs/promises";
import path from "path";

const docker = new Docker();

/**
 * Start a Docker container for a user
 */
export async function startContainer({ userId, image, command, volumeBinds = [] }) {
    const userDir = path.resolve(process.cwd(), "data/users", userId, "input");
    await fs.mkdir(userDir, { recursive: true });

    const containerName = `trame-${userId}`;

    // Check if container already exists
    let container;
    try {
        container = docker.getContainer(containerName);
        const info = await container.inspect();

        // If container exists and is running, return it
        if (info.State.Running) {
            console.log(`Container ${containerName} already running, reusing it`);
            return {
                containerId: container.id,
                frontendUrl: `http://localhost:9000/`
            };
        }

        // If container exists but stopped, remove it and create new one
        console.log(`Container ${containerName} exists but stopped, removing it`);
        await container.remove({ force: true });
    } catch (err) {
        // Container doesn't exist, we'll create it
        console.log(`Container ${containerName} doesn't exist, creating it`);
    }

    // When backend is running in Docker, we need to provide the host path for volume mounts
    // Determine the workspace root based on current working directory
    let workspaceRoot;
    if (process.env.WORKSPACE_ROOT) {
        // Docker environment with explicit workspace root
        workspaceRoot = process.env.WORKSPACE_ROOT;
    } else {
        // Native execution - check if we're in the backend directory
        const cwd = process.cwd();
        workspaceRoot = cwd.endsWith('backend') || cwd.endsWith('backend\\') || cwd.endsWith('backend/')
            ? path.dirname(cwd)  // Go up one level if we're in backend
            : cwd;
    }

    const hostUserDir = path.join(workspaceRoot, 'backend', 'data', 'users', userId, 'input');

    // Combine default binds with any additional volume binds (like file mounts)
    const allBinds = [
        `${hostUserDir}:/input:ro`,
        ...volumeBinds
    ];

    container = await docker.createContainer({
        Image: image,
        name: containerName,
        Cmd: command,
        Env: [
            "VTK_DEFAULT_OPENGL_WINDOW=vtkEGLRenderWindow",
        ],
        ExposedPorts: { "8080/tcp": {} },
        HostConfig: {
            PortBindings: {
                "8080/tcp": [{ HostPort: "9000" }]
            },
            Binds: allBinds,
            AutoRemove: false,
            DeviceRequests: [
                {
                    Count: -1,
                    Capabilities: [["gpu"]]
                }
            ]
        },
        NetworkingConfig: {
            EndpointsConfig: {
                "trame-net": {}
            }
        }
    });

    await container.start();

    return {
        containerId: container.id,
        frontendUrl: `http://localhost:9000/`
    };
}

/**
 * Stop and remove a user's Docker container
 */
export async function stopContainer(userId) {
    const containerName = `trame-${userId}`;

    try {
        const container = docker.getContainer(containerName);
        const info = await container.inspect();

        if (info.State.Running) {
            console.log(`Stopping container ${containerName}`);
            await container.stop();
            await container.remove();
        } else {
            console.log(`Container ${containerName} not running`);
            await container.remove();
        }
    } catch (err) {
        if (err.statusCode === 404) {
            console.log(`Container ${containerName} doesn't exist`);
        } else {
            throw err;
        }
    }
}

async function generateNginxConfig(userId, containerName) {
    const nginxUsersDir = path.resolve("/nginx/users");

    // Ensure directory exists
    await fs.mkdir(nginxUsersDir, { recursive: true });

    const conf = `
location /${userId}/ {
    resolver 127.0.0.11 valid=10s;
    proxy_pass http://${containerName}:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400;
}
`;
    await fs.writeFile(path.join(nginxUsersDir, `${userId}.conf`), conf);
}
