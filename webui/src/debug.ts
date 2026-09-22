/**
 * Optional, opt-in memory/perf introspection for manual investigation.
 * Does nothing for normal users -- there is no default UI, no periodic
 * timer, and no behavior change unless explicitly invoked. Two ways in:
 *
 *   - from the browser console: `__nagiosDebug()` returns a snapshot and
 *     also prints it as a table.
 *   - load the page with `?debug=1` in the URL to additionally log a
 *     snapshot (plus a rough render duration) to the console on every
 *     route change, which is the cheap way to eyeball whether heap/DOM
 *     node counts grow unboundedly over a long real session instead of
 *     settling once data of a given size is loaded.
 *
 * `performance.memory` (JS heap size) is Chrome/Chromium-only and absent
 * elsewhere; snapshot() degrades gracefully to null in that case.
 */

export interface DebugSnapshot {
	timestamp: string;
	heapUsedMB: number | null;
	heapLimitMB: number | null;
	domNodeCount: number;
	hash: string;
}

interface ChromeMemoryInfo {
	usedJSHeapSize: number;
	jsHeapSizeLimit: number;
}

function mb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

export function snapshot(): DebugSnapshot {
	const mem = (performance as Performance & { memory?: ChromeMemoryInfo }).memory;
	return {
		timestamp: new Date().toISOString(),
		heapUsedMB: mem ? mb(mem.usedJSHeapSize) : null,
		heapLimitMB: mem ? mb(mem.jsHeapSizeLimit) : null,
		domNodeCount: document.getElementsByTagName('*').length,
		hash: window.location.hash,
	};
}

declare global {
	interface Window {
		__nagiosDebug?: () => DebugSnapshot;
	}
}

export function installDebugHelper(): void {
	window.__nagiosDebug = () => {
		const s = snapshot();
		console.table(s);
		return s;
	};
}

const loggingEnabled = new URLSearchParams(window.location.search).get('debug') === '1';

/**
 * Call after a route render completes. `renderMs` only covers the
 * synchronous DOM-scaffold build (hosts.ts/services.ts fetch and populate
 * their tables asynchronously afterward), so treat it as a lower bound on
 * render cost, not the full "data visible" latency.
 */
export function logRouteSnapshot(renderMs: number): void {
	if (!loggingEnabled) return;
	console.log(`[nagios-debug] route=${window.location.hash || '(dashboard)'} scaffoldMs=${renderMs.toFixed(1)}`, snapshot());
}
