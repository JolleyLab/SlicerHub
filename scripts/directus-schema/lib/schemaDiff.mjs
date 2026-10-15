/**
 * Safety wrapper around Directus's official /schema/diff + /schema/apply.
 *
 * Those endpoints sync a target to *exactly* match a given snapshot — including deleting
 * collections/fields/relations that exist on the target but aren't in the snapshot, and
 * editing ones that differ. That's the opposite of the "never touch what's already there,
 * only add what's missing" behavior this tool promises, so we inspect the diff before
 * ever applying it.
 *
 * The diff response is hash-guarded (/schema/apply rejects a diff whose hash doesn't match
 * what the server just computed), so the diff payload itself cannot be edited and resubmitted
 * — we can only decide whether to send the *whole* diff, unmodified, or not send it at all.
 */

/** A deep-diff entry is additive ("new") only when every entry in its own diff array is kind 'N'. */
function isAdditiveEntry(entry) {
    const ops = Array.isArray(entry?.diff) ? entry.diff : [];
    return ops.length > 0 && ops.every((op) => op.kind === 'N');
}

function describeEntry(entry) {
    const ops = Array.isArray(entry?.diff) ? entry.diff : [];
    const kinds = [...new Set(ops.map((op) => op.kind))].join(',');
    const name = entry.collection || entry.field || entry.relation || JSON.stringify(entry).slice(0, 60);
    return `${name} (${kinds || 'empty'})`;
}

/**
 * @returns {{ hasDiff: boolean, additiveOnly: boolean, nonAdditive: string[], raw: object|null }}
 */
export function analyzeSchemaDiff(diffResponse) {
    if (!diffResponse || !diffResponse.diff) {
        return { hasDiff: false, additiveOnly: true, nonAdditive: [], raw: null };
    }
    const sections = ['collections', 'fields', 'relations'];
    const nonAdditive = [];
    for (const section of sections) {
        const entries = Array.isArray(diffResponse.diff[section]) ? diffResponse.diff[section] : [];
        for (const entry of entries) {
            if (!isAdditiveEntry(entry)) {
                nonAdditive.push(`${section}: ${describeEntry(entry)}`);
            }
        }
    }
    return { hasDiff: true, additiveOnly: nonAdditive.length === 0, nonAdditive, raw: diffResponse };
}

/**
 * Diff the source snapshot against the target's current schema, then apply it — but only
 * when every change is purely additive, unless the caller explicitly allows edits/deletes.
 */
export async function applySchemaSnapshot(client, snapshot, { dryRun, allowChanges }) {
    const diffResponse = await client.post('/schema/diff', snapshot);
    const analysis = analyzeSchemaDiff(diffResponse);

    if (!analysis.hasDiff) {
        return { ...analysis, applied: false, message: 'Target schema already matches — nothing to do.' };
    }

    if (!analysis.additiveOnly && !allowChanges) {
        return {
            ...analysis,
            applied: false,
            message:
                'Diff includes edits or deletions to things that already exist on the target '
                + '(see list above) — refusing to apply. Re-run with --allow-changes to apply it '
                + 'exactly as Directus computed it, or resolve the conflicts by hand first.'
        };
    }

    if (dryRun) {
        return { ...analysis, applied: false, message: '(dry-run) Would apply the diff above.' };
    }

    await client.post('/schema/apply', diffResponse);
    return { ...analysis, applied: true, message: 'Schema diff applied.' };
}
