import {
	fetchHostStatusDetails,
	fetchHostObjectDetails,
	extinfoHostUrl,
	statusCgiHostUrl,
	type HostStatusDetails,
	type HostObjectDetails,
	type HostStatusValue,
} from './api';
import { formatDuration, formatTimestamp } from './format';

/**
 * Port of cgi/status.c's show_host_detail() (style=hostdetail): one row per
 * host, no service rows. See the plan for the full column/CSS/icon mapping.
 *
 * Sorting and auto-refresh both operate on data already held in memory
 * (sorting doesn't refetch; refresh re-fetches and re-renders in place,
 * preserving whatever sort is active) -- no new API surface needed beyond
 * what Phase A already added.
 */

// Matches sample-config/cgi.cfg.in's default refresh_rate=90 (used by
// status.cgi/statusmap.cgi/extinfo.cgi/outages.cgi) for consistency.
const REFRESH_INTERVAL_MS = 90_000;

const STATUS_LABEL: Record<HostStatusValue, string> = {
	up: 'UP',
	down: 'DOWN',
	unreachable: 'UNREACHABLE',
	pending: 'PENDING',
};

const STATUS_CLASS: Record<HostStatusValue, string> = {
	up: 'statusHOSTUP',
	down: 'statusHOSTDOWN',
	unreachable: 'statusHOSTUNREACHABLE',
	pending: 'statusHOSTPENDING',
};

// Ascending order here means "problems first", which is the natural default
// for a status view.
const STATUS_SEVERITY: Record<HostStatusValue, number> = {
	down: 0,
	unreachable: 1,
	pending: 2,
	up: 3,
};

type SortKey = 'host' | 'status' | 'lastCheck' | 'duration' | 'info';
type SortDirection = 'asc' | 'desc';

interface SortState {
	key: SortKey;
	direction: SortDirection;
}

const COLUMNS: { key: SortKey; label: string }[] = [
	{ key: 'host', label: 'Host' },
	{ key: 'status', label: 'Status' },
	{ key: 'lastCheck', label: 'Last Check' },
	{ key: 'duration', label: 'Duration' },
	{ key: 'info', label: 'Status Information' },
];

function compareHosts(
	[nameA, statusA]: [string, HostStatusDetails],
	[nameB, statusB]: [string, HostStatusDetails],
	sort: SortState,
): number {
	let cmp: number;
	switch (sort.key) {
		case 'host':
			cmp = nameA.localeCompare(nameB);
			break;
		case 'status':
			cmp = STATUS_SEVERITY[statusA.status] - STATUS_SEVERITY[statusB.status];
			break;
		case 'lastCheck':
			cmp = statusA.last_check - statusB.last_check;
			break;
		case 'duration':
			cmp = statusA.last_state_change - statusB.last_state_change;
			break;
		case 'info':
			cmp = statusA.plugin_output.localeCompare(statusB.plugin_output);
			break;
	}
	if (cmp === 0) {
		cmp = nameA.localeCompare(nameB);
	}
	return sort.direction === 'asc' ? cmp : -cmp;
}

function bgClass(status: HostStatusValue, acknowledged: boolean, inDowntime: boolean, zebraOdd: boolean): string {
	if (status === 'down') {
		if (acknowledged) return 'statusBGDOWNACK';
		if (inDowntime) return 'statusBGDOWNSCHED';
		return 'statusBGDOWN';
	}
	if (status === 'unreachable') {
		if (acknowledged) return 'statusBGUNREACHABLEACK';
		if (inDowntime) return 'statusBGUNREACHABLESCHED';
		return 'statusBGUNREACHABLE';
	}
	return zebraOdd ? 'statusOdd' : 'statusEven';
}

function icon(el: HTMLElement, src: string, alt: string, href?: string): void {
	const img = document.createElement('img');
	img.src = `images/${src}`;
	img.alt = alt;
	img.title = alt;
	img.style.marginRight = '2px';
	if (href) {
		const a = document.createElement('a');
		a.href = href;
		a.appendChild(img);
		el.appendChild(a);
	} else {
		el.appendChild(img);
	}
}

function renderHostCell(hostName: string, status: HostStatusDetails, obj: HostObjectDetails | undefined): HTMLTableCellElement {
	const td = document.createElement('td');

	const nameLine = document.createElement('div');
	const nameLink = document.createElement('a');
	nameLink.href = extinfoHostUrl(hostName);
	nameLink.textContent = hostName;
	if (obj?.address) {
		nameLink.title = obj.address;
	}
	nameLine.appendChild(nameLink);
	td.appendChild(nameLine);

	const iconLine = document.createElement('div');
	if (status.problem_has_been_acknowledged) {
		icon(iconLine, 'ack.gif', 'This problem has been acknowledged');
	}
	if (!status.notifications_enabled) {
		icon(iconLine, 'ndisabled.gif', 'Notifications for this host have been disabled');
	}
	if (!status.checks_enabled && !status.accept_passive_checks) {
		icon(iconLine, 'disabled.gif', 'Active and passive checks have been disabled for this host');
	} else if (!status.checks_enabled) {
		icon(iconLine, 'passiveonly.gif', 'Active checks have been disabled for this host, only passive checks are being accepted');
	}
	if (status.is_flapping) {
		icon(iconLine, 'flapping.gif', 'This host is flapping between states');
	}
	if (status.scheduled_downtime_depth > 0) {
		icon(iconLine, 'downtime.gif', 'This host is currently in a period of scheduled downtime');
	}
	if (obj?.notes_url) {
		icon(iconLine, 'notes.gif', 'View extra host notes', obj.notes_url);
	}
	if (obj?.action_url) {
		icon(iconLine, 'action.gif', 'Perform extra host actions', obj.action_url);
	}
	if (obj?.icon_image) {
		// Convention: icon_image is relative to images/logos/, matching how
		// nagios object config traditionally references them.
		icon(iconLine, `logos/${obj.icon_image}`, hostName);
	}
	icon(iconLine, 'status2.gif', 'View the status of all services for this host', statusCgiHostUrl(hostName));
	td.appendChild(iconLine);

	return td;
}

function renderTableBody(
	tbody: HTMLTableSectionElement,
	hosts: Record<string, HostStatusDetails>,
	objects: Record<string, HostObjectDetails>,
	queryTime: number,
	sort: SortState,
): void {
	tbody.innerHTML = '';

	const entries = Object.entries(hosts).sort((a, b) => compareHosts(a, b, sort));
	let zebraOdd = false;

	for (const [hostName, status] of entries) {
		const obj = objects[hostName];

		const row = document.createElement('tr');
		row.appendChild(renderHostCell(hostName, status, obj));

		const statusCell = document.createElement('td');
		statusCell.className = STATUS_CLASS[status.status];
		statusCell.textContent = STATUS_LABEL[status.status];
		row.appendChild(statusCell);

		const bg = bgClass(status.status, status.problem_has_been_acknowledged, status.scheduled_downtime_depth > 0, zebraOdd);
		if (status.status === 'up' || status.status === 'pending') {
			zebraOdd = !zebraOdd;
		}

		const lastCheckCell = document.createElement('td');
		lastCheckCell.className = bg;
		lastCheckCell.textContent = formatTimestamp(status.last_check);
		row.appendChild(lastCheckCell);

		const durationCell = document.createElement('td');
		durationCell.className = bg;
		durationCell.textContent = formatDuration(queryTime, status.last_state_change, status.last_state_change === 0);
		row.appendChild(durationCell);

		const infoCell = document.createElement('td');
		infoCell.className = bg;
		infoCell.textContent = status.plugin_output;
		row.appendChild(infoCell);

		tbody.appendChild(row);
	}
}

function sortIndicator(sort: SortState, key: SortKey): string {
	if (sort.key !== key) return '';
	return sort.direction === 'asc' ? ' ▲' : ' ▼';
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderHosts(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading hosts...</p>';

	const sort: SortState = { key: 'status', direction: 'asc' };
	let headerCells: HTMLTableCellElement[] = [];
	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;
	let stopped = false;

	function updateHeaderLabels(): void {
		for (const [i, col] of COLUMNS.entries()) {
			headerCells[i].textContent = col.label + sortIndicator(sort, col.key);
		}
	}

	async function load(initial: boolean): Promise<void> {
		let statusResult;
		let objects;
		try {
			[statusResult, objects] = await Promise.all([fetchHostStatusDetails(), fetchHostObjectDetails()]);
		} catch (err) {
			if (!initial) {
				// Keep showing the last-good table; just surface the error.
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load host status: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		const { queryTime, hosts } = statusResult;

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			lastUpdatedEl = document.createElement('div');
			lastUpdatedEl.id = 'hostsLastUpdated';
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
					if (tbody) {
						renderTableBody(tbody, hosts, objects, queryTime, sort);
					}
				});
				headRow.appendChild(th);
				return th;
			});
			thead.appendChild(headRow);
			table.appendChild(thead);

			tbody = document.createElement('tbody');
			table.appendChild(tbody);
			container.appendChild(table);

			updateHeaderLabels();
		}

		if (heading) {
			heading.textContent = `Hosts (${Object.keys(hosts).length})`;
		}
		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(queryTime)}`;
		}
		if (tbody) {
			renderTableBody(tbody, hosts, objects, queryTime, sort);
		}
	}

	void load(true);

	const intervalId = window.setInterval(() => {
		if (!stopped) {
			void load(false);
		}
	}, REFRESH_INTERVAL_MS);

	return () => {
		stopped = true;
		window.clearInterval(intervalId);
	};
}
