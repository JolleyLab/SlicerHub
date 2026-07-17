# Remote GPU billing ownership

One remote GPU instance is shared per project. Ownership tracks who holds the bill while Start Billing is active.

## Who can start / stop

| Action | Who |
|--------|-----|
| Configure providers / API keys | Project **admin** only |
| **Start billing** | **Admin** or **collaborator**, if the project has usable remote credentials and Using now is not Local |
| **Stop billing** | **Billing owner**, or any project **admin** |

Observers never own, start, or stop billing.

## Ownership

- The user who starts billing becomes **billing owner**.
- Status payloads expose `billingOwner`, `youOwnBilling`, and `activeUsers`.
- Soft-warm / keep-seat while billing is on is fine; ownership does not change idle/wall safeguards.

## Active users (for transfer)

A project member is **active** (for transfer / stop impact) if they have a recent
GPU heartbeat with an **open viewer** (`viewerActive`) within the last **10 minutes**
(`GPU_BILLING_TRANSFER_ACTIVE_MINUTES`, default `10`). Being on the project page alone
does not count.

After an **explicit handoff**, the transferor is suppressed until they close any open
viewer and open one again (so they are not still “active” right after transferring).

Logged out or silent longer than that → **not** transfer candidates (idle / gone).

## Stop Billing UX

1. If there are other **active** users → warn that stop will disconnect them; offer:
   - **Transfer** to the first candidate (see ranking), or
   - **Stop anyway**
2. If everyone else is idle or logged out → **no transfer**; stop immediately. They may see a “session ended” / GPU unavailable message if they return.
3. Admins stopping someone else’s session get the same impact notice when others are active.

## Transfer ranking and cascade

Among **active** users (excluding the current owner):

1. Prefer **admin**, then **collaborator**
2. Stable order within role (username)
3. Take the **first** in that list
4. On failure (gone mid-transfer, race with close, etc.) → **cascade** to the next still-active candidate
5. If the list empties → **stop billing**

Transfer races (B closes as A transfers) fall through to existing idle/wall safeguards. Extra billing should stay small (under an hour with default policy).

## Owner idle while others are active

If the **owner** is no longer active but ≥1 other user is active:

1. **Auto-transfer** ownership down the same ranked list (no UI)
2. Notify the new owner lightly (“You now own GPU billing on this project”)
3. If cascade fails → normal idle auto-stop

## Idle / wall safeguards

Unchanged:

- Idle auto-stop (`GPU_BILLING_IDLE_MINUTES`)
- Wall cap (`GPU_BILLING_MAX_WALL_MINUTES`)
- Watchdog + heartbeats

Ownership transfer touches billing activity so the new owner gets a fresh idle window. Wall cap still hard-stops.

# Ownership reminder on viewer close

If billing was **transferred** to you and no other users are active, closing the viewer opens a short prompt:

1. Ask whether to stop billing now.
2. If not → reminder that requires **Okay** or **X** (no backdrop / Escape dismiss).

See Project Review UI (`gpu-owner-billing-prompt`).

## Logout while owning billing

Explicit **Log out** (not inactivity auto-logout) checks `GET /api/gpu/owned-billing-sessions`:

1. If you own no running remote sessions → log out as usual.
2. If any owned session has **other active users** → same transfer / stop-anyway dialog as Stop Billing (one project at a time).
3. If you are the **only** active user on owned sessions → list those projects with per-project **Stop billing**, **Stop all & log out**, or **Log out without stopping**.

If the dialog sits idle for **2 minutes**, the default action runs automatically: **transfer** when others are active (or **stop** if no transfer target), otherwise **stop all owned sessions and log out**.

Inactivity auto-logout skips this dialog (idle / wall safeguards still apply).

## Related

- [gpu-providers.md](./gpu-providers.md) — provision, Vast, billing timers
- Soft park / warm seats for **local** Full Slicer are separate; remote soft-warm is “keep the rented box useful while billing is on,” not a second meter

## Collaborator visibility (no websocket yet)

Project Review **polls** GPU settings ~every 12s (also while Local) so provider switches and Start/Stop show up without a hard refresh. File open and Start Billing **refresh first**. True push (SSE/WebSocket) is not implemented; polling is the interim “push.”
