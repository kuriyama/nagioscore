import {
	fetchHostStatusDetails,
	fetchHostObjectDetails,
	fetchHostGroups,
	extinfoHostUrl,
	statusCgiHostUrl,
	type HostStatusDetails,
	type HostObjectDetails,
	type HostGroupDetails,
	type HostStatusValue,
	type ProblemFilterMode,
} from './api';
import { formatDuration, formatTimestamp } from './format';
import { promptAcknowledge, promptDowntime } from './actions';
import { acknowledgeHost, scheduleHostDowntime } from './commands';
import { renderStatusTotals } from './statustotals';

/**
 * Port of cgi/status.c's show_host_detail() (style=hostdetail): one row per
 * host, no service rows. See the plan for the full column/CSS/icon mapping.
 *
 * Sorting/filtering re-render already-fetched data in place; refresh
 * re-fetches and re-renders, preserving whatever sort/filter is active.
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

/**
 * hoststatustypes=12 (DOWN|UNREACHABLE) for "Problems", plus hostprops=42
 * (NO_SCHEDULED_DOWNTIME|STATE_UNACKNOWLEDGED|CHECKS_ENABLED) for
 * "Unhandled" -- see ProblemFilterMode in api.ts.
 */
function matchesProblemFilter(status: HostStatusDetails, mode: ProblemFilterMode): boolean {
	if (mode === 'all') return true;
	const isProblem = status.status === 'down' || status.status === 'unreachable';
	if (mode === 'problems') return isProblem;
	return (
		isProblem &&
		!status.problem_has_been_acknowledged &&
		status.scheduled_downtime_depth === 0 &&
		status.checks_enabled
	);
}

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
	// include/cgiutils.h's STATUS_ICON_WIDTH/HEIGHT (20) -- the original CGI
	// forces every status/logo icon to this size via WIDTH/HEIGHT attributes
	// regardless of the source image's native resolution (logo PNGs are
	// commonly shipped at 40x40). Without this, the browser renders each
	// icon at its native size instead.
	img.width = 20;
	img.height = 20;
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

function actionLink(label: string, onClick: () => void): HTMLAnchorElement {
	const a = document.createElement('a');
	a.href = '#';
	a.textContent = label;
	a.className = 'actionLink';
	a.addEventListener('click', (ev) => {
		ev.preventDefault();
		onClick();
	});
	return a;
}

function renderHostCell(
	hostName: string,
	status: HostStatusDetails,
	obj: HostObjectDetails | undefined,
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): HTMLTableCellElement {
	const td = document.createElement('td');
	// cgi/status.c's show_host_detail() colors this cell with the plain
	// (ack/downtime-insensitive) statusHOST* class, distinct from the
	// paler ack/downtime-sensitive statusBG* class used on the other
	// cells (see renderTableBody's bgClass()).
	td.className = STATUS_CLASS[status.status];

	// Name and icons share one line, name left / icons right, matching
	// show_host_detail()'s nested table (a <td align=left> and a
	// <td align=right> side by side in the same cell) instead of each
	// stacking as its own line.
	const nameIconRow = document.createElement('div');
	nameIconRow.style.display = 'flex';
	nameIconRow.style.flexWrap = 'wrap';
	nameIconRow.style.alignItems = 'center';
	nameIconRow.style.justifyContent = 'space-between';
	nameIconRow.style.gap = '4px';
	td.appendChild(nameIconRow);

	const nameLink = document.createElement('a');
	nameLink.href = extinfoHostUrl(hostName);
	nameLink.textContent = hostName;
	if (obj?.address) {
		nameLink.title = obj.address;
	}
	nameIconRow.appendChild(nameLink);

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
	nameIconRow.appendChild(iconLine);

	const actionsLine = document.createElement('div');
	const isProblem = status.status === 'down' || status.status === 'unreachable';
	if (isProblem && !status.problem_has_been_acknowledged) {
		actionsLine.appendChild(
			actionLink('Ack', async () => {
				const opts = await promptAcknowledge(`host ${hostName}`);
				if (!opts) return;
				const result = await acknowledgeHost(hostName, opts);
				setActionStatus(result.message);
				if (result.ok) onActionComplete();
			}),
		);
		actionsLine.appendChild(document.createTextNode(' '));
	}
	actionsLine.appendChild(
		actionLink('Downtime', async () => {
			const opts = await promptDowntime(`host ${hostName}`);
			if (!opts) return;
			const result = await scheduleHostDowntime(hostName, opts);
			setActionStatus(result.message);
			if (result.ok) onActionComplete();
		}),
	);
	td.appendChild(actionsLine);

	return td;
}

function renderTableBody(
	tbody: HTMLTableSectionElement,
	hosts: Record<string, HostStatusDetails>,
	objects: Record<string, HostObjectDetails>,
	queryTime: number,
	sort: SortState,
	memberFilter: Set<string> | null,
	problemFilter: ProblemFilterMode,
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): void {
	tbody.innerHTML = '';

	let entries = Object.entries(hosts);
	if (memberFilter) {
		entries = entries.filter(([hostName]) => memberFilter.has(hostName));
	}
	entries = entries.filter(([, status]) => matchesProblemFilter(status, problemFilter));
	entries = entries.sort((a, b) => compareHosts(a, b, sort));

	let zebraOdd = false;

	for (const [hostName, status] of entries) {
		const obj = objects[hostName];

		const row = document.createElement('tr');
		row.appendChild(renderHostCell(hostName, status, obj, onActionComplete, setActionStatus));

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

	if (entries.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = COLUMNS.length;
		cell.textContent = 'No hosts match this filter.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

function sortIndicator(sort: SortState, key: SortKey): string {
	if (sort.key !== key) return '';
	return sort.direction === 'asc' ? ' ▲' : ' ▼';
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderHosts(container: HTMLElement, initialFilter: ProblemFilterMode = 'all'): () => void {
	container.innerHTML = '<p>Loading hosts...</p>';

	const sort: SortState = { key: 'status', direction: 'asc' };
	let selectedGroup: string | null = null;
	let problemFilter: ProblemFilterMode = initialFilter;
	let stopped = false;

	// Current data, updated in place on every successful load() so that
	// event handlers (sort clicks, filter changes) always see fresh data
	// instead of closing over whatever was current at the time the DOM was
	// first built.
	let currentHosts: Record<string, HostStatusDetails> = {};
	let currentObjects: Record<string, HostObjectDetails> = {};
	let currentGroups: HostGroupDetails[] = [];
	let currentQueryTime = 0;

	let headerCells: HTMLTableCellElement[] = [];
	let tbody: HTMLTableSectionElement | null = null;
	let groupSelect: HTMLSelectElement | null = null;
	let problemSelect: HTMLSelectElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let actionStatusEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;
	let totalsContainer: HTMLElement | null = null;

	function currentMemberFilter(): Set<string> | null {
		if (!selectedGroup) return null;
		const group = currentGroups.find((g) => g.group_name === selectedGroup);
		return group ? new Set(group.members) : null;
	}

	// Scoped by Host Group only, matching cgi/status.c's show_host_status_totals()
	// -- unlike the table below, this box is NOT affected by the
	// Problems/Unhandled Problems filter.
	function renderTotalsPanel(): void {
		if (!totalsContainer) return;
		const memberFilter = currentMemberFilter();
		let up = 0;
		let down = 0;
		let unreachable = 0;
		let pending = 0;
		for (const [hostName, status] of Object.entries(currentHosts)) {
			if (memberFilter && !memberFilter.has(hostName)) continue;
			if (status.status === 'up') up++;
			else if (status.status === 'down') down++;
			else if (status.status === 'unreachable') unreachable++;
			else pending++;
		}
		totalsContainer.innerHTML = '';
		totalsContainer.appendChild(
			renderStatusTotals(
				'host',
				'Host Status Totals',
				[
					{ label: 'Up', count: up, classSuffix: 'UP' },
					{ label: 'Down', count: down, classSuffix: 'DOWN' },
					{ label: 'Unreachable', count: unreachable, classSuffix: 'UNREACHABLE' },
					{ label: 'Pending', count: pending, classSuffix: 'PENDING' },
				],
				down + unreachable,
				up + down + unreachable + pending,
			),
		);
	}

	function currentlyDisplayedCount(): number {
		const memberFilter = currentMemberFilter();
		return Object.entries(currentHosts).filter(
			([hostName, status]) => (!memberFilter || memberFilter.has(hostName)) && matchesProblemFilter(status, problemFilter),
		).length;
	}

	function setActionStatus(msg: string): void {
		if (actionStatusEl) {
			actionStatusEl.textContent = msg;
		}
	}

	function rerenderTable(): void {
		renderTotalsPanel();
		if (tbody) {
			renderTableBody(
				tbody,
				currentHosts,
				currentObjects,
				currentQueryTime,
				sort,
				currentMemberFilter(),
				problemFilter,
				() => void load(false),
				setActionStatus,
			);
		}
		if (heading) {
			heading.textContent = `Hosts (${currentlyDisplayedCount()})`;
		}
	}

	function updateHeaderLabels(): void {
		for (const [i, col] of COLUMNS.entries()) {
			headerCells[i].textContent = col.label + sortIndicator(sort, col.key);
		}
	}

	function populateGroupSelect(): void {
		if (!groupSelect) return;
		const previous = groupSelect.value;
		groupSelect.innerHTML = '';

		const allOption = document.createElement('option');
		allOption.value = '';
		allOption.textContent = `All Host Groups (${currentGroups.length})`;
		groupSelect.appendChild(allOption);

		for (const group of [...currentGroups].sort((a, b) => a.alias.localeCompare(b.alias))) {
			const option = document.createElement('option');
			option.value = group.group_name;
			option.textContent = `${group.alias} (${group.members.length})`;
			groupSelect.appendChild(option);
		}

		// Keep the previous selection if it still exists (e.g. across a refresh).
		if (previous && currentGroups.some((g) => g.group_name === previous)) {
			groupSelect.value = previous;
		}
	}

	async function load(initial: boolean): Promise<void> {
		let statusResult;
		let objects;
		let groups;
		try {
			// objectjson.cgi's notes_url/action_url/icon_image and hostgroup
			// membership only change on a config reload -- unlike status, no
			// need to refetch them on every 90s auto-refresh tick.
			if (initial) {
				[statusResult, objects, groups] = await Promise.all([
					fetchHostStatusDetails(),
					fetchHostObjectDetails(),
					fetchHostGroups(),
				]);
			} else {
				statusResult = await fetchHostStatusDetails();
				objects = currentObjects;
				groups = currentGroups;
			}
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

		currentHosts = statusResult.hosts;
		currentQueryTime = statusResult.queryTime;
		currentObjects = objects;
		currentGroups = groups;

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			totalsContainer = document.createElement('div');
			container.appendChild(totalsContainer);

			const filterBar = document.createElement('div');
			filterBar.id = 'detailFilterBar';
			const label = document.createElement('label');
			label.textContent = 'Host Group: ';
			groupSelect = document.createElement('select');
			groupSelect.addEventListener('change', () => {
				selectedGroup = groupSelect!.value || null;
				rerenderTable();
			});
			label.appendChild(groupSelect);
			filterBar.appendChild(label);

			filterBar.appendChild(document.createTextNode(' '));
			const problemLabel = document.createElement('label');
			problemLabel.textContent = 'Show: ';
			problemSelect = document.createElement('select');
			const problemOptions: [ProblemFilterMode, string][] = [
				['all', 'All Hosts'],
				['problems', 'Problems'],
				['unhandled', 'Unhandled Problems'],
			];
			for (const [value, text] of problemOptions) {
				const option = document.createElement('option');
				option.value = value;
				option.textContent = text;
				problemSelect.appendChild(option);
			}
			problemSelect.value = problemFilter;
			problemSelect.addEventListener('change', () => {
				problemFilter = problemSelect!.value as ProblemFilterMode;
				rerenderTable();
			});
			problemLabel.appendChild(problemSelect);
			filterBar.appendChild(problemLabel);

			container.appendChild(filterBar);

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
			thead.appendChild(headRow);
			table.appendChild(thead);

			tbody = document.createElement('tbody');
			table.appendChild(tbody);
			container.appendChild(table);

			updateHeaderLabels();
		}

		populateGroupSelect();
		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(currentQueryTime)}`;
		}
		rerenderTable();
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
