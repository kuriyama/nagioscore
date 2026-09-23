import {
	fetchHostStatusDetails,
	fetchServiceStatusDetails,
	extinfoHostUrl,
	extinfoServiceUrl,
	type HostStatusDetails,
	type ServiceStatusEntry,
} from './api';
import { formatTimestamp } from './format';

/**
 * Port of extinfo.cgi?type=7 ("Scheduling Queue"): every host/service check
 * next due to run, across both hosts and services in one merged, sorted
 * list. Needs no new API calls -- fetchHostStatusDetails()/
 * fetchServiceStatusDetails() already return next_check/
 * should_be_scheduled/check_type on every entry (details=true always
 * includes them); this view just merges and sorts what hosts.ts/
 * services.ts already fetch separately.
 *
 * Deliberate simplification vs. the original: cgi/extinfo.c's queue also
 * shows a should_be_scheduled==FALSE entry if it's a forced passive check
 * (checks_enabled==FALSE but a forced next_check is pending) -- a rare
 * edge case (a passive-only check that was manually force-rescheduled
 * once). This port only shows should_be_scheduled==TRUE entries; the
 * original's own sort-by-next-check default view is otherwise matched.
 */

const REFRESH_INTERVAL_MS = 90_000;

type SortKey = 'host' | 'service' | 'lastCheck' | 'nextCheck';
type SortDirection = 'asc' | 'desc';

interface SortState {
	key: SortKey;
	direction: SortDirection;
}

const COLUMNS: { key: SortKey; label: string }[] = [
	{ key: 'host', label: 'Host' },
	{ key: 'service', label: 'Service' },
	{ key: 'lastCheck', label: 'Last Check' },
	{ key: 'nextCheck', label: 'Next Check' },
];

interface QueueEntry {
	hostName: string;
	/** undefined for a host check row */
	description?: string;
	lastCheck: number;
	nextCheck: number;
	checkType: HostStatusDetails['check_type'];
	checksEnabled: boolean;
}

function toQueueEntries(hosts: Record<string, HostStatusDetails>, services: ServiceStatusEntry[]): QueueEntry[] {
	const entries: QueueEntry[] = [];

	for (const [hostName, status] of Object.entries(hosts)) {
		if (!status.should_be_scheduled) continue;
		entries.push({
			hostName,
			lastCheck: status.last_check,
			nextCheck: status.next_check,
			checkType: status.check_type,
			checksEnabled: status.checks_enabled,
		});
	}

	for (const entry of services) {
		if (!entry.status.should_be_scheduled) continue;
		entries.push({
			hostName: entry.hostName,
			description: entry.description,
			lastCheck: entry.status.last_check,
			nextCheck: entry.status.next_check,
			checkType: entry.status.check_type,
			checksEnabled: entry.status.checks_enabled,
		});
	}

	return entries;
}

function compareEntries(a: QueueEntry, b: QueueEntry, sort: SortState): number {
	let cmp: number;
	switch (sort.key) {
		case 'host':
			cmp = a.hostName.localeCompare(b.hostName);
			break;
		case 'service':
			cmp = (a.description ?? '').localeCompare(b.description ?? '');
			break;
		case 'lastCheck':
			cmp = a.lastCheck - b.lastCheck;
			break;
		case 'nextCheck':
			cmp = a.nextCheck - b.nextCheck;
			break;
	}
	if (cmp === 0) {
		cmp = a.hostName.localeCompare(b.hostName) || (a.description ?? '').localeCompare(b.description ?? '');
	}
	return sort.direction === 'asc' ? cmp : -cmp;
}

function renderTableBody(tbody: HTMLTableSectionElement, entries: QueueEntry[], sort: SortState): void {
	tbody.innerHTML = '';

	const sorted = [...entries].sort((a, b) => compareEntries(a, b, sort));

	for (const entry of sorted) {
		const row = document.createElement('tr');

		const hostCell = document.createElement('td');
		const hostLink = document.createElement('a');
		hostLink.href = extinfoHostUrl(entry.hostName);
		hostLink.textContent = entry.hostName;
		hostCell.appendChild(hostLink);
		row.appendChild(hostCell);

		const serviceCell = document.createElement('td');
		if (entry.description) {
			const serviceLink = document.createElement('a');
			serviceLink.href = extinfoServiceUrl(entry.hostName, entry.description);
			serviceLink.textContent = entry.description;
			serviceCell.appendChild(serviceLink);
		}
		row.appendChild(serviceCell);

		const lastCheckCell = document.createElement('td');
		lastCheckCell.textContent = formatTimestamp(entry.lastCheck);
		row.appendChild(lastCheckCell);

		const nextCheckCell = document.createElement('td');
		nextCheckCell.textContent = formatTimestamp(entry.nextCheck);
		row.appendChild(nextCheckCell);

		const typeCell = document.createElement('td');
		typeCell.textContent = entry.checkType === 'active' ? 'Active' : 'Passive';
		row.appendChild(typeCell);

		const enabledCell = document.createElement('td');
		enabledCell.textContent = entry.checksEnabled ? 'Yes' : 'No';
		row.appendChild(enabledCell);

		tbody.appendChild(row);
	}

	if (sorted.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = COLUMNS.length + 2;
		cell.textContent = 'The scheduling queue is empty.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

function sortIndicator(sort: SortState, key: SortKey): string {
	if (sort.key !== key) return '';
	return sort.direction === 'asc' ? ' ▲' : ' ▼';
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderSchedulingQueue(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading scheduling queue...</p>';

	const sort: SortState = { key: 'nextCheck', direction: 'asc' };
	let stopped = false;
	let currentEntries: QueueEntry[] = [];

	let headerCells: HTMLTableCellElement[] = [];
	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;

	function rerenderTable(): void {
		if (tbody) {
			renderTableBody(tbody, currentEntries, sort);
		}
		if (heading) {
			heading.textContent = `Scheduling Queue (${currentEntries.length})`;
		}
	}

	function updateHeaderLabels(): void {
		for (const [i, col] of COLUMNS.entries()) {
			headerCells[i].textContent = col.label + sortIndicator(sort, col.key);
		}
	}

	async function load(initial: boolean): Promise<void> {
		let hostResult;
		let serviceResult;
		try {
			[hostResult, serviceResult] = await Promise.all([fetchHostStatusDetails(), fetchServiceStatusDetails()]);
		} catch (err) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load the scheduling queue: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		currentEntries = toQueueEntries(hostResult.hosts, serviceResult.services);

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			lastUpdatedEl = document.createElement('div');
			lastUpdatedEl.id = 'detailLastUpdated';
			container.appendChild(lastUpdatedEl);

			const table = document.createElement('table');
			table.className = 'status';

			const thead = document.createElement('thead');
			const headRow = document.createElement('tr');
			headerCells = COLUMNS.map((col) => {
				const th = document.createElement('th');
				th.className = 'status';
				th.style.cursor = 'pointer';
				th.addEventListener('click', () => {
					if (sort.key === col.key) {
						sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
					} else {
						sort.key = col.key;
						sort.direction = 'asc';
					}
					updateHeaderLabels();
					rerenderTable();
				});
				headRow.appendChild(th);
				return th;
			});
			for (const label of ['Type', 'Active Checks']) {
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

			updateHeaderLabels();
		}

		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(Math.max(hostResult.queryTime, serviceResult.queryTime))}`;
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
