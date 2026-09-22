/**
 * Ports of cgi/status.c's duration formatting (get_time_breakdown() +
 * show_host_detail()'s "%2dd %2dh %2dm %2ds" format) and a simplified
 * last-check timestamp format. The server's configured date_format
 * (US/EURO/ISO8601/STRICT_ISO8601) isn't exposed via the JSON API, so
 * last-check intentionally uses a fixed ISO-ish format here rather than
 * trying to match it exactly -- see plan notes.
 */

export function formatDuration(referenceEpochSeconds: number, sinceEpochSeconds: number, neverChanged: boolean): string {
	if (sinceEpochSeconds > referenceEpochSeconds) {
		return '???';
	}

	const totalSeconds = Math.max(0, Math.floor(referenceEpochSeconds - sinceEpochSeconds));
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	const pad = (n: number) => String(n).padStart(2, ' ');
	const suffix = neverChanged ? '+' : '';
	return `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s${suffix}`;
}

export function formatTimestamp(epochSeconds: number): string {
	if (!epochSeconds) {
		return 'N/A';
	}
	const d = new Date(epochSeconds * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}
