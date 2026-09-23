import { fetchDowntimes, extinfoHostUrl, extinfoServiceUrl, type DowntimeEntry } from './api';
import { formatTimestamp } from './format';
import { deleteHostDowntime, deleteServiceDowntime } from './commands';

/**
 * Port of extinfo.cgi?type=6 ("Downtime"): all currently scheduled host/
 * service downtime. Same shape as comments.ts (no sort/group-filter,
 * matching the original page).
 */

const REFRESH_INTERVAL_MS = 90_000;

function downtimeSubject(entry: DowntimeEntry): string {
	return entry.type === 'service' ? `${entry.host_name}/${entry.service_description}` : entry.host_name;
}

/** duration is a raw seconds count (flexible-downtime window length), not
    an elapsed time -- format.ts's formatDuration computes the latter, so
    this is a small dedicated formatter instead. */
function formatFlexibleDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${hours}h ${minutes}m`;
}

function renderTableBody(
	tbody: HTMLTableSectionElement,
	downtimes: DowntimeEntry[],
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): void {
	tbody.innerHTML = '';

	const entries = [...downtimes].sort((a, b) => a.start_time - b.start_time);

	for (const entry of entries) {
		const row = document.createElement('tr');

		const hostCell = document.createElement('td');
		const link = document.createElement('a');
		link.href = entry.type === 'service' ? extinfoServiceUrl(entry.host_name, entry.service_description ?? '') : extinfoHostUrl(entry.host_name);
		link.textContent = downtimeSubject(entry);
		hostCell.appendChild(link);
		row.appendChild(hostCell);

		const entryTimeCell = document.createElement('td');
		entryTimeCell.textContent = formatTimestamp(entry.entry_time);
		row.appendChild(entryTimeCell);

		const authorCell = document.createElement('td');
		authorCell.textContent = entry.author;
		row.appendChild(authorCell);

		const commentCell = document.createElement('td');
		commentCell.textContent = entry.comment;
		row.appendChild(commentCell);

		const startCell = document.createElement('td');
		startCell.textContent = formatTimestamp(entry.start_time);
		row.appendChild(startCell);

		const endCell = document.createElement('td');
		endCell.textContent = formatTimestamp(entry.end_time);
		row.appendChild(endCell);

		const typeCell = document.createElement('td');
		typeCell.textContent = entry.fixed ? 'Fixed' : `Flexible (${formatFlexibleDuration(entry.duration)})`;
		row.appendChild(typeCell);

		const effectCell = document.createElement('td');
		effectCell.textContent = entry.is_in_effect ? 'Yes' : 'No';
		row.appendChild(effectCell);

		const actionCell = document.createElement('td');
		const del = document.createElement('a');
		del.href = '#';
		del.textContent = 'Delete';
		del.className = 'actionLink';
		del.addEventListener('click', async (ev) => {
			ev.preventDefault();
			if (!window.confirm(`Cancel this scheduled downtime for ${downtimeSubject(entry)}?`)) {
				return;
			}
			const result =
				entry.type === 'service' ? await deleteServiceDowntime(entry.downtime_id) : await deleteHostDowntime(entry.downtime_id);
			setActionStatus(result.message);
			if (result.ok) onActionComplete();
		});
		actionCell.appendChild(del);
		row.appendChild(actionCell);

		tbody.appendChild(row);
	}

	if (entries.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 9;
		cell.textContent = 'There is no scheduled downtime.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderDowntime(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading downtime...</p>';

	let stopped = false;
	let currentDowntimes: DowntimeEntry[] = [];

	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let actionStatusEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;

	function setActionStatus(msg: string): void {
		if (actionStatusEl) actionStatusEl.textContent = msg;
	}

	function rerenderTable(): void {
		if (tbody) {
			renderTableBody(tbody, currentDowntimes, () => void load(false), setActionStatus);
		}
		if (heading) {
			heading.textContent = `Scheduled Downtime (${currentDowntimes.length})`;
		}
	}

	async function load(initial: boolean): Promise<void> {
		let downtimes;
		try {
			downtimes = await fetchDowntimes();
		} catch (err) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load downtime: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		currentDowntimes = downtimes;

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			lastUpdatedEl = document.createElement('div');
			lastUpdatedEl.id = 'detailLastUpdated';
			container.appendChild(lastUpdatedEl);

			actionStatusEl = document.createElement('div');
			actionStatusEl.id = 'detailActionStatus';
			container.appendChild(actionStatusEl);

			const table = document.createElement('table');
			table.className = 'status';

			const thead = document.createElement('thead');
			const headRow = document.createElement('tr');
			for (const label of ['Host/Service', 'Entry Time', 'Author', 'Comment', 'Start Time', 'End Time', 'Type', 'In Effect', 'Actions']) {
				const th = document.createElement('th');
				th.className = 'status';
				th.textContent = label;
				headRow.appendChild(th);
			}
			thead.appendChild(headRow);
			table.appendChild(thead);

			tbody = document.createElement('tbody');
			table.appendChild(tbody);
			container.appendChild(table);
		}

		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(Math.floor(Date.now() / 1000))}`;
		}
		rerenderTable();
	}

	void load(true);

	const intervalId = window.setInterval(() => {
		if (!stopped) void load(false);
	}, REFRESH_INTERVAL_MS);

	return () => {
		stopped = true;
		window.clearInterval(intervalId);
	};
}
