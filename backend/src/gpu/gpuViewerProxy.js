import fs from 'fs/promises';
import path from 'path';
import Docker from 'dockerode';

const docker = new Docker({ socketPath: process.env.DOCKER_HOST?.replace('unix://', '') || '/var/run/docker.sock' });
const NGINX_USERS_DIR = path.resolve('/nginx/users');
const PROXY_CONF_NAME = 'gpu-remote-viewer.conf';

function parseViewerBase(viewerPublicBaseUrl) {
    const raw = String(viewerPublicBaseUrl || '').trim();
    if (!raw) return null;
    const url = new URL(raw);
    const host = url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const origin = `${url.protocol}//${host}${port && port !== '80' && port !== '443' ? `:${port}` : ''}`;
    return { host, port, origin };
}

export async function writeGpuViewerProxy(viewerPublicBaseUrl) {
    const base = parseViewerBase(viewerPublicBaseUrl);
    if (!base) return;

    await fs.mkdir(NGINX_USERS_DIR, { recursive: true });
    const conf = `
# Auto-generated: proxy viewer traffic to remote GPU nginx (Vast).
location ~ ^/trame-session-port/(\\d+)(/.*)?$ {
    set $viewer_port $1;
    set $viewer_path $2;
    proxy_pass ${base.origin}/trame-session-port/$viewer_port$viewer_path$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host ${base.host}${base.port && base.port !== '80' && base.port !== '443' ? `:${base.port}` : ''};
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
`;
    const confPath = path.join(NGINX_USERS_DIR, PROXY_CONF_NAME);
    const confBody = conf.trim() + '\n';
    try {
        const existing = await fs.readFile(confPath, 'utf8');
        if (existing === confBody) {
            return;
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    await fs.writeFile(confPath, confBody);
    await reloadNginx();
    console.log(`GPU viewer proxy enabled -> ${base.origin}/trame-session-port/`);
}

export async function removeGpuViewerProxy() {
    const confPath = path.join(NGINX_USERS_DIR, PROXY_CONF_NAME);
    try {
        await fs.unlink(confPath);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    await reloadNginx();
    console.log('GPU viewer proxy removed');
}

/** Re-create nginx proxy from DB after backend restart (or if conf was lost). */
export async function restoreGpuViewerProxies(runningInstances) {
    const active = (runningInstances || []).find((i) => i.viewerPublicBaseUrl);
    if (!active) return;
    await writeGpuViewerProxy(active.viewerPublicBaseUrl);
}

async function reloadNginx() {
    try {
        const container = docker.getContainer('nginx');
        const exec = await container.exec({
            Cmd: ['nginx', '-s', 'reload'],
            AttachStdout: true,
            AttachStderr: true
        });
        await exec.start({ hijack: true, stdin: false });
    } catch (err) {
        console.warn('nginx reload after GPU proxy change failed:', err.message);
    }
}
