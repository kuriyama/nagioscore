import { fetchScheduledChecks, extinfoHostUrl, extinfoServiceUrl, type ScheduledCheckStatus } from './api';
import { formatTimestamp } from './format';
import { startAutoRefresh } from './refresh';
import { ListControls, compareText, setHighlightedText, type FilterField, type FilterQuery } from './listcontrols';

/**
 * Port of extinfo.cgi?type=7 ("Scheduling Queue"): every host/service check
 * next due to run, across both hosts and services in one merged, sorted
 * list, from fetchScheduledChecks() (the same hostlist/servicelist
 * queries hosts.ts/services.ts use, narrowed with fields= to the five
 * fields this view reads). Like those views, every row is fetched and
 * sorted/filtered here but only one page is rendered (listcontrols.ts) --
 * this list has a row per host *and* per service, so it's the largest
 * table in the webui.
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
	checkType: ScheduledCheckStatus['check_type'];
	checksEnabled: boolean;
}

/** Columns the filter box can address as `name:value` (see listcontrols.ts's FilterQuery). */
const FILTER_FIELDS: FilterField[] = [
	{ name: 'host', help: 'host name' },
	{ name: 'service', aliases: ['svc'], help: 'service description (host checks have none)' },
	{ name: 'type', prefix: true, help: 'check type, from the start (type:p = Passive)' },
];

function toQueueEntries(hosts: Record<string, ScheduledCheckStatus>, services: Record<string, Record<string, ScheduledCheckStatus>>): QueueEntry[] {
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

	for (const [hostName, byDescription] of Object.entries(services)) {
		for (const [description, status] of Object.entries(byDescription)) {
			if (!status.should_be_scheduled) continue;
			entries.push({
				hostName,
				description,
				lastCheck: status.last_check,
				nextCheck: status.next_check,
				checkType: status.check_type,
				checksEnabled: status.checks_enabled,
			});
		}
	}

	return entries;
}

function compareEntries(a: QueueEntry, b: QueueEntry, sort: SortState): number {
	let cmp: number;
	switch (sort.key) {
		case 'host':
			cmp = compareText(a.hostName, b.hostName);
			break;
		case 'service':
			cmp = compareText(a.description ?? '', b.description ?? '');
			break;
		case 'lastCheck':
			cmp = a.lastCheck - b.lastCheck;
			break;
		case 'nextCheck':
			cmp = a.nextCheck - b.nextCheck;
			break;
	}
	if (cmp === 0) {
		cmp = compareText(a.hostName, b.hostName) || compareText(a.description ?? '', b.description ?? '');
	}
	return sort.direction === 'asc' ? cmp : -cmp;
}

function renderTableBody(tbody: HTMLTableSectionElement, entries: QueueEntry[], filter: FilterQuery, emptyText: string): void {
	tbody.innerHTML = '';

	for (const entry of entries) {
		const row = document.createElement('tr');

		const hostCell = document.createElement('td');
		const hostLink = document.createElement('a');
		hostLink.href = extinfoHostUrl(entry.hostName);
		setHighlightedText(hostLink, entry.hostName, filter.highlightFor('host'));
		hostCell.appendChild(hostLink);
		row.appendChild(hostCell);

		const serviceCell = document.createElement('td');
		if (entry.description) {
			const serviceLink = document.createElement('a');
			serviceLink.href = extinfoServiceUrl(entry.hostName, entry.description);
			setHighlightedText(serviceLink, entry.description, filter.highlightFor('service'));
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
		setHighlightedText(typeCell, entry.checkType === 'active' ? 'Active' : 'Passive', filter.highlightFor('type'));
		row.appendChild(typeCell);

		const enabledCell = document.createElement('td');
		enabledCell.textContent = entry.checksEnabled ? 'Yes' : 'No';
		row.appendChild(enabledCell);

		tbody.appendChild(row);
	}

	if (entries.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = COLUMNS.length + 2;
		cell.textContent = emptyText;
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
	let currentEntries: QueueEntry[] = [];

	let headerCells: HTMLTableCellElement[] = [];
	let tbody: HTMLTableSectionElement | null = null;
	let heading: HTMLElement | null = null;

	// See hosts.ts's matching sortedEntries()/haystack().
	let dataVersion = 0;
	let sortedCache: { key: string; entries: QueueEntry[] } | null = null;
	function sortedEntries(): QueueEntry[] {
		const key = `${dataVersion}|${sort.key}|${sort.direction}`;
		if (sortedCache?.key !== key) {
			sortedCache = { key, entries: [...currentEntries].sort((a, b) => compareEntries(a, b, sort)) };
		}
		return sortedCache.entries;
	}

	let haystacks = new WeakMap<QueueEntry, Record<string, string>>();
	function haystack(e: QueueEntry): Record<string, string> {
		let h = haystacks.get(e);
		if (h === undefined) {
			h = {
				host: e.hostName.toLowerCase(),
				service: (e.description ?? '').toLowerCase(),
				type: e.checkType === 'active' ? 'active' : 'passive',
			};
			haystacks.set(e, h);
		}
		return h;
	}

	const controls = new ListControls('checks', FILTER_FIELDS, 'host:web type:p', () => rerenderTable());

	function rerenderTable(): void {
		const all = sortedEntries();
		const filter = controls.filter();
		const matched = filter.empty ? all : all.filter((e) => filter.matches(haystack(e)));
		const page = controls.slice(matched);
		if (tbody) {
			renderTableBody(tbody, page.items, filter, all.length === 0 ? 'The scheduling queue is empty.' : 'No checks match this filter.');
		}
		if (heading) {
			heading.textContent = filter.empty ? `Scheduling Queue (${all.length})` : `Scheduling Queue (${matched.length} of ${all.length})`;
		}
	}

	function updateHeaderLabels(): void {
		for (const [i, col] of COLUMNS.entries()) {
			headerCells[i].textContent = col.label + sortIndicator(sort, col.key);
		}
	}

	const refresher = startAutoRefresh(REFRESH_INTERVAL_MS, () => load(false));

	async function load(initial: boolean): Promise<void> {
		let result;
		try {
			result = await fetchScheduledChecks();
		} catch (err) {
			if (!initial) {
				refresher.failed(err);
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load the scheduling queue: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		currentEntries = toQueueEntries(result.hosts, result.services);
		dataVersion++;
		haystacks = new WeakMap();

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);
			container.appendChild(refresher.el);

			const filterBar = document.createElement('div');
			filterBar.id = 'detailFilterBar';
			filterBar.appendChild(controls.input);
			container.appendChild(filterBar);

			container.appendChild(controls.topPager);

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
					controls.resetPage();
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

			container.appendChild(controls.bottomPager);

			updateHeaderLabels();
		}

		refresher.succeeded(result.queryTime);
		rerenderTable();
	}

	void load(true);

	return () => {
		controls.destroy();
		refresher.stop();
	};
}
