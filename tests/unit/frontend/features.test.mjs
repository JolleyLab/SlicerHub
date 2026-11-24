import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let featuresBody = {};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => featuresBody });

// A fresh copy of the module per server config (features load once per module instance).
let instance = 0;
async function loadFeatures(body) {
    featuresBody = body;
    instance += 1;
    const mod = await import(`../../../dev/services/features.js?instance=${instance}`);
    await mod.loadAppFeatures();
    return mod;
}

describe('resolveSlicerWebChannel', () => {
    it('opens the server default for a Default choice', async () => {
        const { resolveSlicerWebChannel } = await loadFeatures({ slicerWebDevMode: true, slicerWebDefaultChannel: 'latest' });
        assert.equal(resolveSlicerWebChannel('default'), 'latest');
        assert.equal(resolveSlicerWebChannel(undefined), 'latest');
    });

    it('keeps an explicit choice over the server default', async () => {
        const { resolveSlicerWebChannel } = await loadFeatures({ slicerWebDevMode: true, slicerWebDefaultChannel: 'latest' });
        assert.equal(resolveSlicerWebChannel('stable'), 'stable');
        const stableDefault = await loadFeatures({ slicerWebDevMode: true, slicerWebDefaultChannel: 'stable' });
        assert.equal(stableDefault.resolveSlicerWebChannel('latest'), 'latest');
        assert.equal(stableDefault.resolveSlicerWebChannel('default'), 'stable');
    });

    it('opens stable whenever the latest channel is unavailable', async () => {
        const { resolveSlicerWebChannel } = await loadFeatures({ slicerWebDevMode: false, slicerWebDefaultChannel: 'latest' });
        assert.equal(resolveSlicerWebChannel('default'), 'stable');
        assert.equal(resolveSlicerWebChannel('latest'), 'stable');
    });

    it('opens stable before features have loaded', async () => {
        instance += 1;
        const { resolveSlicerWebChannel } = await import(`../../../dev/services/features.js?instance=${instance}`);
        assert.equal(resolveSlicerWebChannel('default'), 'stable');
    });
});
