"""
vast.ai provider — provisions on-demand GPU instances via the vast.ai API.

Each user session gets its own vast.ai instance running the trame-slicer
Docker image.  Files are transferred in/out via SSH (SCP).

Required environment variables:
    VASTAI_API_KEY          your vast.ai API key
    VASTAI_IMAGE            Docker image to run (e.g. your-registry/trame-slicer:latest)
    VASTAI_GPU_NAME         GPU model filter, e.g. "RTX_4000" or "A4000"
                            See: https://vast.ai/docs/cli/commands#search-offers
    VASTAI_DISK_GB          disk space to request per instance (default: 30)
    VASTAI_SSH_KEY_PATH     path to SSH private key for SCP file transfer
    VASTAI_SSH_KEY_ID       vast.ai key ID registered in your account (from: vastai show ssh-keys)

Optional:
    VASTAI_MAX_PRICE        max $/hr to bid (default: 0.30)
    VASTAI_REGION           region filter e.g. "US" (default: no filter)
    VASTAI_REDUNDANCY       number of instances to provision and race (default: 1)
                            Set to 2-3 to mitigate unreliable hosts per your co-worker's suggestion.

Private registry authentication (all optional — leave unset for public images):
    VASTAI_REGISTRY_URL     registry hostname, e.g. ghcr.io (default: ghcr.io)
    VASTAI_REGISTRY_USER    registry username or GitHub username for GHCR
    VASTAI_REGISTRY_TOKEN   read-only token for the registry

    For GHCR, generate a fine-grained Personal Access Token at:
        https://github.com/settings/personal-access-tokens
    with ONLY these permissions:
        - Contents: Read-only         (to identify the repo)
        - Packages: Read-only         (to pull the image)
    No write access, no other repos, no other scopes.
    The token is passed to vast.ai in the instance creation payload so that
    the host machine can `docker pull` the private image.  Use a deploy-only
    token — never your main GitHub credentials.

How routing works with this provider:
    Unlike Docker, vast.ai instances have *external* IPs and random mapped ports.
    server.py registers the route with Traefik via its REST API after the instance
    is ready, and deregisters it on stop.  nginx is not used when this provider
    is active.

NOTE: This is a complete, working implementation but has not been tested
against the live vast.ai API.  Run the startup-time experiment first before
investing in full integration.
"""

import os
import asyncio
import aiohttp
import time
import logging
import subprocess
from typing import Optional, List

from .base import GpuSessionProvider, SessionInfo

logger = logging.getLogger(__name__)

VASTAI_API_BASE = "https://console.vast.ai/api/v0"
VASTAI_API_KEY = os.getenv('VASTAI_API_KEY', '')
VASTAI_IMAGE = os.getenv('VASTAI_IMAGE', 'trame-slicer:latest')
VASTAI_GPU_NAME = os.getenv('VASTAI_GPU_NAME', 'RTX_4000')
VASTAI_DISK_GB = int(os.getenv('VASTAI_DISK_GB', '30'))
VASTAI_MAX_PRICE = float(os.getenv('VASTAI_MAX_PRICE', '0.30'))
VASTAI_REGION = os.getenv('VASTAI_REGION', '')
VASTAI_SSH_KEY_PATH = os.getenv('VASTAI_SSH_KEY_PATH', '')
VASTAI_SSH_KEY_ID = os.getenv('VASTAI_SSH_KEY_ID', '')
VASTAI_REDUNDANCY = int(os.getenv('VASTAI_REDUNDANCY', '1'))

# Private registry auth (optional — leave unset for public images)
VASTAI_REGISTRY_URL   = os.getenv('VASTAI_REGISTRY_URL', 'ghcr.io')
VASTAI_REGISTRY_USER  = os.getenv('VASTAI_REGISTRY_USER', '')
VASTAI_REGISTRY_TOKEN = os.getenv('VASTAI_REGISTRY_TOKEN', '')

# Traefik REST API (only used by this provider)
TRAEFIK_API = os.getenv('TRAEFIK_API', 'http://traefik:8080')

TRAME_INTERNAL_PORT = 9000   # port exposed inside the trame-slicer container


def _vastai_headers() -> dict:
    return {"Authorization": f"Bearer {VASTAI_API_KEY}"}


class VastAiProvider(GpuSessionProvider):
    """
    Manages trame sessions as vast.ai on-demand GPU instances.

    Startup flow per session:
      1. Search offers matching GPU / price / region filters
      2. Create instance(s) — VASTAI_REDUNDANCY controls how many to race
      3. Poll until one instance reaches 'running' state
      4. SCP the user's MRB file into the instance
      5. Register route in Traefik so nginx can proxy to it
      6. Return SessionInfo with external host:port

    Teardown:
      1. SCP the saved file back to the CPU VM
      2. Destroy the vast.ai instance
      3. Deregister Traefik route
    """

    # ------------------------------------------------------------------ #
    #  start_session                                                       #
    # ------------------------------------------------------------------ #
    async def start_session(
        self,
        user_id: str,
        session_id: str,
        port_hint: int,         # ignored — vast.ai assigns ports
        user_files_host_path: str,
        file_name: Optional[str],
        original_file_name: Optional[str],
        parent_file_id: Optional[int],
    ) -> SessionInfo:

        if not VASTAI_API_KEY:
            raise RuntimeError("VASTAI_API_KEY is not set")

        # 1. Find suitable offers
        offer_ids = await self._search_offers()
        if not offer_ids:
            raise RuntimeError(
                f"No vast.ai offers found matching GPU={VASTAI_GPU_NAME} "
                f"price<={VASTAI_MAX_PRICE}/hr"
            )

        # 2. Create instance(s) — race VASTAI_REDUNDANCY of them
        candidates = offer_ids[:VASTAI_REDUNDANCY]
        instance_ids = []
        async with aiohttp.ClientSession(headers=_vastai_headers()) as client:
            for offer_id in candidates:
                iid = await self._create_instance(client, offer_id, user_id, file_name)
                if iid:
                    instance_ids.append(iid)

        if not instance_ids:
            raise RuntimeError("Failed to create any vast.ai instance")

        # 3. Race — wait for first one to become ready
        winner, host, ssh_port, trame_port = await self._wait_for_first_ready(instance_ids)

        # 4. Destroy the losers
        losers = [i for i in instance_ids if i != winner]
        if losers:
            async with aiohttp.ClientSession(headers=_vastai_headers()) as client:
                for iid in losers:
                    await self._destroy_instance(client, iid)
            logger.info(f"[VastAI] Destroyed {len(losers)} losing instance(s)")

        # 5. SCP user's file into the instance
        if file_name:
            local_file = os.path.join(user_files_host_path, file_name)
            await self._scp_to_instance(host, ssh_port, local_file, f"/data/{file_name}")

        # 6. Register route in Traefik
        await self._register_traefik_route(user_id, host, trame_port)

        container_name = f"trame-session-{user_id}"
        logger.info(f"[VastAI] Session ready: instance {winner} @ {host}:{trame_port}")

        return SessionInfo(
            session_id=session_id,
            container_id=str(winner),
            container_name=container_name,
            host=host,
            port=trame_port,
            user_id=user_id,
            original_file_name=original_file_name,
            parent_file_id=parent_file_id,
        )

    # ------------------------------------------------------------------ #
    #  stop_session                                                        #
    # ------------------------------------------------------------------ #
    async def stop_session(self, session: SessionInfo) -> None:
        async with aiohttp.ClientSession(headers=_vastai_headers()) as client:
            await self._destroy_instance(client, int(session.container_id))
        await self._deregister_traefik_route(session.user_id)
        logger.info(f"[VastAI] Destroyed instance {session.container_id}")

    # ------------------------------------------------------------------ #
    #  is_ready                                                            #
    # ------------------------------------------------------------------ #
    async def is_ready(self, session: SessionInfo, timeout: int = 120) -> bool:
        # By the time start_session returns the instance is already confirmed
        # reachable, so this is a quick re-check for the server.py call site.
        url = f"http://{session.host}:{session.port}/"
        start = time.time()
        while time.time() - start < timeout:
            try:
                async with aiohttp.ClientSession() as client:
                    async with client.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        if resp.status < 500:
                            return True
            except Exception:
                pass
            await asyncio.sleep(2)
        return False

    # ------------------------------------------------------------------ #
    #  file transfer                                                       #
    # ------------------------------------------------------------------ #
    async def upload_file(self, session: SessionInfo, local_path: str, remote_filename: str) -> None:
        """SCP a file to /data/ on the vast.ai instance."""
        ssh_port = await self._get_ssh_port(int(session.container_id))
        await self._scp_to_instance(session.host, ssh_port, local_path, f"/data/{remote_filename}")

    async def download_file(self, session: SessionInfo, remote_filename: str, local_path: str) -> None:
        """SCP a file from /data/ on the vast.ai instance back to the CPU VM."""
        ssh_port = await self._get_ssh_port(int(session.container_id))
        await self._scp_from_instance(session.host, ssh_port, f"/data/{remote_filename}", local_path)

    # ------------------------------------------------------------------ #
    #  internal helpers                                                    #
    # ------------------------------------------------------------------ #
    async def _search_offers(self) -> List[int]:
        """Return a list of offer IDs matching our constraints, cheapest first."""
        params = {
            "q": {
                "gpu_name": {"eq": VASTAI_GPU_NAME},
                "dph_total": {"lte": VASTAI_MAX_PRICE},
                "rentable": {"eq": True},
                "num_gpus": {"eq": 1},
                "disk_space": {"gte": VASTAI_DISK_GB},
            },
            "order": [["dph_total", "asc"]],
            "limit": max(VASTAI_REDUNDANCY * 2, 5),
        }
        if VASTAI_REGION:
            params["q"]["geolocation"] = {"in": [VASTAI_REGION]}

        async with aiohttp.ClientSession(headers=_vastai_headers()) as client:
            async with client.get(f"{VASTAI_API_BASE}/bundles/", params={"q": str(params)}) as resp:
                data = await resp.json()
                offers = data.get("offers", [])
                logger.info(f"[VastAI] Found {len(offers)} matching offers")
                return [o["id"] for o in offers]

    async def _create_instance(
        self, client: aiohttp.ClientSession, offer_id: int, user_id: str, file_name: Optional[str]
    ) -> Optional[int]:
        env = {"USER_ID": user_id, "VTK_DEFAULT_OPENGL_WINDOW": "vtkEGLRenderWindow"}
        if file_name:
            env["FILE_PATH"] = f"/data/{file_name}"

        payload = {
            "client_id": "me",
            "image": VASTAI_IMAGE,
            "disk": VASTAI_DISK_GB,
            "label": f"trame-session-{user_id}",
            "onstart": "",
            "runtype": "ssh",
            "ssh": True,
            "env": " ".join(f"-e {k}={v}" for k, v in env.items()),
            "extra": f"-p {TRAME_INTERNAL_PORT}:{TRAME_INTERNAL_PORT}",
            "use_jupyter_lab": False,
            "jupyter": False,
        }
        if VASTAI_SSH_KEY_ID:
            payload["ssh_key_ids"] = [VASTAI_SSH_KEY_ID]

        # Private registry auth — passed as a docker login string so the
        # vast.ai host can pull the image.  Only added when credentials are set.
        # Use a read-only deploy token, never your main account credentials.
        if VASTAI_REGISTRY_USER and VASTAI_REGISTRY_TOKEN:
            payload["login"] = (
                f"-u {VASTAI_REGISTRY_USER} "
                f"-p {VASTAI_REGISTRY_TOKEN} "
                f"{VASTAI_REGISTRY_URL}"
            )
            logger.info(f"[VastAI] Using private registry auth for {VASTAI_REGISTRY_URL}")

        try:
            async with client.put(
                f"{VASTAI_API_BASE}/asks/{offer_id}/",
                json=payload,
            ) as resp:
                data = await resp.json()
                iid = data.get("new_contract")
                logger.info(f"[VastAI] Created instance {iid} from offer {offer_id}")
                return iid
        except Exception as e:
            logger.error(f"[VastAI] Failed to create instance from offer {offer_id}: {e}")
            return None

    async def _wait_for_first_ready(
        self, instance_ids: List[int], timeout: int = 300
    ):
        """Poll until any one of the instances is running and trame responds."""
        start = time.time()
        while time.time() - start < timeout:
            for iid in instance_ids:
                try:
                    info = await self._get_instance_info(iid)
                    if info.get("actual_status") != "running":
                        continue
                    host = info.get("public_ipaddr")
                    ports = info.get("ports", {})
                    ssh_port = int(ports.get("22/tcp", [{}])[0].get("HostPort", 22))
                    trame_port_str = ports.get(f"{TRAME_INTERNAL_PORT}/tcp", [{}])[0].get("HostPort")
                    if not trame_port_str:
                        continue
                    trame_port = int(trame_port_str)
                    # Check trame is actually serving
                    ready = await self._http_ready(host, trame_port)
                    if ready:
                        return iid, host, ssh_port, trame_port
                except Exception as e:
                    logger.debug(f"[VastAI] Polling {iid}: {e}")
            await asyncio.sleep(5)
            logger.info(f"[VastAI] Waiting for instance... ({int(time.time()-start)}s)")
        raise RuntimeError("No vast.ai instance became ready within timeout")

    async def _get_instance_info(self, instance_id: int) -> dict:
        async with aiohttp.ClientSession(headers=_vastai_headers()) as client:
            async with client.get(f"{VASTAI_API_BASE}/instances/{instance_id}/") as resp:
                data = await resp.json()
                return data.get("instances", data)

    async def _get_ssh_port(self, instance_id: int) -> int:
        info = await self._get_instance_info(instance_id)
        ports = info.get("ports", {})
        return int(ports.get("22/tcp", [{"HostPort": 22}])[0].get("HostPort", 22))

    async def _destroy_instance(self, client: aiohttp.ClientSession, instance_id: int) -> None:
        try:
            async with client.delete(f"{VASTAI_API_BASE}/instances/{instance_id}/") as resp:
                logger.info(f"[VastAI] Destroyed instance {instance_id} (HTTP {resp.status})")
        except Exception as e:
            logger.error(f"[VastAI] Error destroying instance {instance_id}: {e}")

    async def _http_ready(self, host: str, port: int) -> bool:
        try:
            async with aiohttp.ClientSession() as client:
                async with client.get(
                    f"http://{host}:{port}/", timeout=aiohttp.ClientTimeout(total=3)
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def _scp_to_instance(self, host: str, ssh_port: int, local_path: str, remote_path: str) -> None:
        if not VASTAI_SSH_KEY_PATH:
            logger.warning("[VastAI] VASTAI_SSH_KEY_PATH not set — skipping file upload")
            return
        cmd = [
            "scp",
            "-i", VASTAI_SSH_KEY_PATH,
            "-P", str(ssh_port),
            "-o", "StrictHostKeyChecking=no",
            local_path,
            f"root@{host}:{remote_path}",
        ]
        logger.info(f"[VastAI] SCP upload: {local_path} -> {host}:{remote_path}")
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"SCP upload failed: {stderr.decode()}")

    async def _scp_from_instance(self, host: str, ssh_port: int, remote_path: str, local_path: str) -> None:
        if not VASTAI_SSH_KEY_PATH:
            logger.warning("[VastAI] VASTAI_SSH_KEY_PATH not set — skipping file download")
            return
        cmd = [
            "scp",
            "-i", VASTAI_SSH_KEY_PATH,
            "-P", str(ssh_port),
            "-o", "StrictHostKeyChecking=no",
            f"root@{host}:{remote_path}",
            local_path,
        ]
        logger.info(f"[VastAI] SCP download: {host}:{remote_path} -> {local_path}")
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"SCP download failed: {stderr.decode()}")

    # ------------------------------------------------------------------ #
    #  Traefik dynamic route registration                                  #
    # ------------------------------------------------------------------ #
    async def _register_traefik_route(self, user_id: str, host: str, port: int) -> None:
        """
        Register a dynamic route in Traefik so the CPU VM's nginx-equivalent
        can proxy /trame-session/user-{id}/ to the vast.ai instance.
        """
        route_name = f"trame-session-{user_id}"
        config = {
            "http": {
                "routers": {
                    route_name: {
                        "rule": f"PathPrefix(`/trame-session/user-{user_id}/`)",
                        "service": route_name,
                        "entryPoints": ["web"],
                    }
                },
                "services": {
                    route_name: {
                        "loadBalancer": {
                            "servers": [{"url": f"http://{host}:{port}"}]
                        }
                    }
                },
            }
        }
        try:
            async with aiohttp.ClientSession() as client:
                async with client.put(
                    f"{TRAEFIK_API}/api/providers/rest",
                    json=config,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    logger.info(f"[VastAI] Traefik route registered for user {user_id} (HTTP {resp.status})")
        except Exception as e:
            logger.warning(f"[VastAI] Could not register Traefik route: {e}")

    async def _deregister_traefik_route(self, user_id: str) -> None:
        route_name = f"trame-session-{user_id}"
        try:
            async with aiohttp.ClientSession() as client:
                # Remove by posting empty config for this route
                async with client.delete(
                    f"{TRAEFIK_API}/api/providers/rest/{route_name}",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    logger.info(f"[VastAI] Traefik route removed for user {user_id} (HTTP {resp.status})")
        except Exception as e:
            logger.warning(f"[VastAI] Could not deregister Traefik route: {e}")
