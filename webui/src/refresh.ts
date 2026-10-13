import { formatTimestamp } from './format';

/**
 * Shared auto-refresh driver + "Last updated" line for the list views
 * (hosts, services, comments, downtime, ...), standing in for the
 * "Last Updated: ... / Updated every 90 seconds" box at the top of the
 * legacy CGI pages.
 *
 * Why not a plain setInterval(load, 90s): after a laptop sleeps, nothing
 * on the page said whether the data was still current or hours old, and
 * the next tick could be up to a full interval (or, in a hidden tab,
 * longer under Chrome's timer throttling) away. Here a 1s ticker compares
 * wall-clock time against the last attempt instead, so a resumed or
 * re-shown page refreshes as soon as it runs again, the line keeps an
 * "(Ns ago)" age that visibly grows if refreshing has stalled, and turns
 * highlighted once the data is older than two intervals.
 *
 * Nothing is fetched while the tab is hidden: every refresh re-runs CGIs
 * that each re-read all of status.dat (seconds per request on a large
 * install), and a view left open in a background tab used to keep doing
 * that every interval -- one such tab per person who left one around.
 * Browsers' background-timer throttling (about once a minute) doesn't
 * help against a 90s interval. Showing the tab again ticks at once, so
 * it refreshes immediately if the data is due.
 */

const TICK_MS = 1000;
/** After a failed refresh (e.g. network not back yet after resume), retry sooner than the full interval. */
const RETRY_AFTER_FAILURE_MS = 15_000;

export interface AutoRefresh {
	/** The "Last updated" line; the view places it wherever it fits. */
	readonly el: HTMLElement;
	/**
	 * Record a successful load. `dataTimeEpoch` is the time shown (e.g.
	 * statusjson's query_time); the age is measured on the browser's own
	 * clock from now, so server/client clock skew can't make it negative.
	 */
	succeeded(dataTimeEpoch?: number): void;
	failed(err: unknown): void;
	stop(): void;
}

function formatAge(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * `refresh` is the view's own `load(false)`. The view still calls its
 * initial load itself; this starts counting from now as if that load were
 * the first attempt.
 */
export function startAutoRefresh(intervalMs: number, refresh: () => Promise<void>): AutoRefresh {
	const el = document.createElement('div');
	el.id = 'detailLastUpdated';

	let stopped = false;
	let lastAttemptAt = Date.now();
	let inFlightSince: number | null = null;
	let lastSuccessAt: number | null = null;
	let dataTime = 0;
	let failure: { at: number; message: string } | null = null;

	function render(): void {
		const now = Date.now();
		const every = `auto-refresh every ${Math.round(intervalMs / 1000)}s`;
		let text: string;
		if (lastSuccessAt === null) {
			text = failure ? `Refresh failed: ${failure.message}` : 'Loading...';
		} else {
			text = `Last updated: ${formatTimestamp(dataTime)} (${formatAge(now - lastSuccessAt)} ago)`;
			if (failure) {
				text += ` · refresh failed ${formatAge(now - failure.at)} ago: ${failure.message}; retrying`;
			} else if (inFlightSince !== null && now - inFlightSince >= 2000) {
				text += ' · refreshing...';
			} else {
				text += ` · ${every}`;
			}
		}
		el.textContent = text;
		el.classList.toggle('stale', lastSuccessAt !== null && now - lastSuccessAt > 2 * intervalMs);
		el.classList.toggle('failed', failure !== null);
	}

	function runRefresh(): void {
		const now = Date.now();
		lastAttemptAt = now;
		inFlightSince = now;
		render();
		refresh()
			.catch((err: unknown) => api.failed(err))
			.finally(() => {
				inFlightSince = null;
				if (!stopped) render();
			});
	}

	function tick(): void {
		if (stopped || document.hidden) return;
		const now = Date.now();
		const due = failure ? Math.min(intervalMs, RETRY_AFTER_FAILURE_MS) : intervalMs;
		// A request that never comes back (e.g. a TCP connection that died
		// while the machine slept) mustn't block refreshing forever.
		const blocked = inFlightSince !== null && now - inFlightSince < intervalMs;
		if (!blocked && now - lastAttemptAt >= due) {
			runRefresh();
		} else {
			render();
		}
	}

	function onVisibility(): void {
		if (document.visibilityState === 'visible') tick();
	}
	function onOnline(): void {
		if (failure && inFlightSince === null && !document.hidden) runRefresh();
	}

	const intervalId = window.setInterval(tick, TICK_MS);
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('online', onOnline);

	const api: AutoRefresh = {
		el,
		succeeded(dataTimeEpoch?: number): void {
			const now = Date.now();
			lastSuccessAt = now;
			// A filter change's own load counts too: the next automatic one
			// is a full interval after whatever loaded last.
			lastAttemptAt = Math.max(lastAttemptAt, now);
			dataTime = dataTimeEpoch || Math.floor(now / 1000);
			failure = null;
			render();
		},
		failed(err: unknown): void {
			failure = { at: Date.now(), message: errorMessage(err) };
			render();
		},
		stop(): void {
			stopped = true;
			window.clearInterval(intervalId);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('online', onOnline);
		},
	};
	render();
	return api;
}
