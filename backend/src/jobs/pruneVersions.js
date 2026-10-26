/**
 * Version retention / prune job.
 *
 * Designed as a standalone async function so it can be called from:
 *   - A cron scheduled inside the backend process (current)
 *   - An HTTP endpoint (POST /api/admin/versions/prune, useful for manual runs and Azure Functions)
 *   - A cloud scheduler (Azure Function timer trigger, AWS EventBridge) with no code changes
 *
 * Retention policy (per attachment, non-pinned versions):
 *   0–7 days   keep all
 *   7–30 days  keep latest version per calendar day
 *   30–90 days keep latest version per calendar week
 *   90+ days   keep latest version per calendar month
 *
 * Pinned versions are never pruned regardless of age.
 */

import { listAllPrunableVersions } from '../services/attachmentVersions.js';
import { pruneFile } from '../services/fileStorageStrategy.js';

// ---------------------------------------------------------------------------
// Retention helpers
// ---------------------------------------------------------------------------

const DAY_MS   = 24 * 60 * 60 * 1000;
const WEEK_MS  =  7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/** ISO date string rounded to day / week-start (Monday) / month-start. */
function bucketKey(date, bucketSize) {
    const d = new Date(date);
    if (bucketSize === 'day') {
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
    if (bucketSize === 'week') {
        const dayOfWeek = d.getUTCDay(); // 0=Sun
        const monday = new Date(d.getTime() - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * DAY_MS));
        return monday.toISOString().slice(0, 10);
    }
    // month
    return d.toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Given a list of versions (sorted oldest→newest) and the current time,
 * returns the ids that should be pruned.
 */
export function selectVersionsToPrune(versions, now = new Date()) {
    const keep = new Set();
    const buckets = { day: new Set(), week: new Set(), month: new Set() };

    // Iterate newest→oldest so the "keep" winner for each bucket is the most recent
    for (const v of [...versions].reverse()) {
        const ageMs = now - new Date(v.date_created);

        if (ageMs < 7 * DAY_MS) {
            keep.add(v.id); // keep all under 7 days
            continue;
        }

        const bucketSize = ageMs < 30 * DAY_MS ? 'day'
            : ageMs < 90 * DAY_MS ? 'week'
            : 'month';

        const key = bucketKey(v.date_created, bucketSize);
        if (!buckets[bucketSize].has(key)) {
            buckets[bucketSize].add(key);
            keep.add(v.id); // first (newest) in this bucket wins
        }
    }

    return versions.filter((v) => !keep.has(v.id)).map((v) => v.id);
}

// ---------------------------------------------------------------------------
// Job entry point
// ---------------------------------------------------------------------------

let running = false;

/**
 * Run the prune job. Safe to call concurrently — skips if already running.
 * @returns {{ pruned: number, skipped: number, errors: number }}
 */
export async function runPruneJob() {
    if (running) {
        console.log('[pruneVersions] already running — skipping');
        return { pruned: 0, skipped: 1, errors: 0 };
    }
    running = true;
    const stats = { pruned: 0, skipped: 0, errors: 0 };

    try {
        const allVersions = await listAllPrunableVersions();
        if (allVersions.length === 0) {
            console.log('[pruneVersions] no prunable versions found');
            return stats;
        }

        // Group by attachment
        const byAttachment = new Map();
        for (const v of allVersions) {
            if (!byAttachment.has(v.attachment_id)) byAttachment.set(v.attachment_id, []);
            byAttachment.get(v.attachment_id).push(v);
        }

        for (const [attachmentId, versions] of byAttachment) {
            const toPruneIds = new Set(selectVersionsToPrune(versions));
            const toPrune = versions.filter((v) => toPruneIds.has(v.id));

            for (const version of toPrune) {
                try {
                    await pruneFile(version);
                    stats.pruned++;
                } catch (err) {
                    console.error(`[pruneVersions] failed to prune version ${version.id} (attachment ${attachmentId}):`, err.message);
                    stats.errors++;
                }
            }
        }

        console.log(`[pruneVersions] done — pruned=${stats.pruned} errors=${stats.errors}`);
    } catch (err) {
        console.error('[pruneVersions] job failed:', err.message);
        stats.errors++;
    } finally {
        running = false;
    }

    return stats;
}

// ---------------------------------------------------------------------------
// Scheduler (cron-style, runs inside the backend process)
// Replace this with an Azure Function timer trigger or AWS EventBridge rule
// when moving to cloud — just call runPruneJob() from the cloud handler.
// ---------------------------------------------------------------------------

const PRUNE_INTERVAL_HOURS = 24;

export function startPruneScheduler() {
    const intervalMs = PRUNE_INTERVAL_HOURS * 60 * 60 * 1000;
    console.log(`[pruneVersions] scheduler started (every ${PRUNE_INTERVAL_HOURS}h)`);
    // Run once shortly after startup (5 min) to catch anything missed during downtime
    setTimeout(() => runPruneJob().catch((e) => console.error('[pruneVersions] scheduled run failed:', e.message)), 5 * 60 * 1000);
    setInterval(() => runPruneJob().catch((e) => console.error('[pruneVersions] scheduled run failed:', e.message)), intervalMs);
}
