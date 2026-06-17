import ProjectGpu from '../models/ProjectGpu.js';
import { evaluateRemoteBillingStop } from './orchestrator.js';
import { reconcileAllActiveRemote } from './reconcile.js';

const WATCH_INTERVAL_MS = 60 * 1000;

let timer = null;

export function startBillingWatchdog() {
    if (timer) return;

    timer = setInterval(async () => {
        try {
            await reconcileAllActiveRemote();

            const running = ProjectGpu.listRunningRemote();
            for (const instance of running) {
                const result = await evaluateRemoteBillingStop(instance.projectId);
                if (result.stopped) {
                    console.warn(
                        `Auto-destroying remote GPU for project ${instance.projectId} (${result.reason})`
                    );
                }
            }
        } catch (err) {
            console.error('GPU billing watchdog error:', err.message || err);
        }
    }, WATCH_INTERVAL_MS);

    if (timer.unref) {
        timer.unref();
    }

    console.log('GPU billing watchdog started (60s interval)');
}
