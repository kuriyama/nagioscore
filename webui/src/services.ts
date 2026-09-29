import {
	fetchServiceStatusDetails,
	fetchServiceObjectDetails,
	fetchServiceGroups,
	fetchServiceCount,
	fetchHostStatusDetails,
	fetchHostObjectDetails,
	extinfoHostUrl,
	extinfoServiceUrl,
	type ServiceStatusEntry,
	type ServiceObjectDetails,
	type ServiceGroupDetails,
	type ServiceStatusValue,
	type HostStatusDetails,
	type HostObjectDetails,
	type HostStatusValue,
	type ProblemFilterMode,
} from './api';
import { formatDuration, formatTimestamp } from './format';
import { promptAcknowledge, promptDowntime } from './actions';
import { acknowledgeService, scheduleServiceDowntime } from './commands';
import { renderStatusTotals } from './statustotals';

/**
 * Port of cgi/status.c's show_service_detail() (the "Services" nav link,
 * status.cgi?host=all): one row per host+service pair. Same design as
 * hosts.ts (flat table, no virtualization, sort/refresh/group-filter
 * operate on already-fetched data).
 */

// Matches sample-config/cgi.cfg.in's default refresh_rate=90, same as hosts.ts.
const REFRESH_INTERVAL_MS = 90_000;

// See hosts.ts's identical constant for why.
const SHOW_QUICK_ACTIONS = false;

const STATUS_LABEL: Record<ServiceStatusValue, string> = {
	ok: 'OK',
	warning: 'WARNING',
	unknown: 'UNKNOWN',
	critical: 'CRITICAL',
	pending: 'PENDING',
};

const STATUS_CLASS: Record<ServiceStatusValue, string> = {
	ok: 'statusOK',
	warning: 'statusWARNING',
	unknown: 'statusUNKNOWN',
	critical: 'statusCRITICAL',
	pending: 'statusPENDING',
};

// Ascending order here means "problems first".
const STATUS_SEVERITY: Record<ServiceStatusValue, number> = {
	critical: 0,
	warning: 1,
	unknown: 2,
	pending: 3,
	ok: 4,
};

// See hosts.ts's identical STATUS_CLASS -- used for the collapsed
// host-group cell below (renderHostGroupCell), not the per-service Status
// column (which uses the service STATUS_CLASS above).
const HOST_STATUS_CLASS: Record<HostStatusValue, string> = {
	up: 'statusHOSTUP',
	down: 'statusHOSTDOWN',
	unreachable: 'statusHOSTUNREACHABLE',
	pending: 'statusHOSTPENDING',
};

/**
 * servicestatustypes=28 (WARNING|UNKNOWN|CRITICAL) for "Problems", plus
 * serviceprops=10 (NO_SCHEDULED_DOWNTIME|STATE_UNACKNOWLEDGED) and
 * hoststatustypes=3 (UP|PENDING) for "Unhandled" -- the host-status check
 * excludes problems on a host that's itself down, since those are noise
 * caused by the host outage rather than independently actionable. See
 * ProblemFilterMode in api.ts.
 */
function matchesProblemFilter(
	entry: ServiceStatusEntry,
	mode: ProblemFilterMode,
	hostStatus: Record<string, HostStatusDetails>,
): boolean {
	if (mode === 'all') return true;
	const s = entry.status;
	const isProblem = s.status === 'warning' || s.status === 'unknown' || s.status === 'critical';
	if (mode === 'problems') return isProblem;
	if (!isProblem || s.problem_has_been_acknowledged || s.scheduled_downtime_depth > 0) return false;
	const host = hostStatus[entry.hostName];
	return !host || host.status === 'up' || host.status === 'pending';
}

type SortKey = 'host' | 'service' | 'status' | 'lastCheck' | 'duration' | 'attempt' | 'info';
type SortDirection = 'asc' | 'desc';

interface SortState {
	key: SortKey;
	direction: SortDirection;
}

const COLUMNS: { key: SortKey; label: string }[] = [
	{ key: 'host', label: 'Host' },
	{ key: 'service', label: 'Service' },
	{ key: 'status', label: 'Status' },
	{ key: 'lastCheck', label: 'Last Check' },
	{ key: 'duration', label: 'Duration' },
	{ key: 'attempt', label: 'Attempt' },
	{ key: 'info', label: 'Status Information' },
];

function serviceKey(hostName: string, description: string): string {
	return `${hostName}\u0000${description}`;
}

function compareServices(a: ServiceStatusEntry, b: ServiceStatusEntry, sort: SortState): number {
	let cmp: number;
	switch (sort.key) {
		case 'host':
			cmp = a.hostName.localeCompare(b.hostName);
			break;
		case 'service':
			cmp = a.description.localeCompare(b.description);
			break;
		case 'status':
			cmp = STATUS_SEVERITY[a.status.status] - STATUS_SEVERITY[b.status.status];
			break;
		case 'lastCheck':
			cmp = a.status.last_check - b.status.last_check;
			break;
		case 'duration':
			cmp = a.status.last_state_change - b.status.last_state_change;
			break;
		case 'attempt':
			cmp = a.status.current_attempt - b.status.current_attempt;
			break;
		case 'info':
			cmp = a.status.plugin_output.localeCompare(b.status.plugin_output);
			break;
	}
	if (cmp === 0) {
		cmp = a.hostName.localeCompare(b.hostName) || a.description.localeCompare(b.description);
	}
	return sort.direction === 'asc' ? cmp : -cmp;
}

function bgClass(status: ServiceStatusValue, acknowledged: boolean, inDowntime: boolean, zebraOdd: boolean): string {
	if (status === 'critical') {
		if (acknowledged) return 'statusBGCRITICALACK';
		if (inDowntime) return 'statusBGCRITICALSCHED';
		return 'statusBGCRITICAL';
	}
	if (status === 'warning') {
		if (acknowledged) return 'statusBGWARNINGACK';
		if (inDowntime) return 'statusBGWARNINGSCHED';
		return 'statusBGWARNING';
	}
	if (status === 'unknown') {
		if (acknowledged) return 'statusBGUNKNOWNACK';
		if (inDowntime) return 'statusBGUNKNOWNSCHED';
		return 'statusBGUNKNOWN';
	}
	return zebraOdd ? 'statusOdd' : 'statusEven';
}

function icon(el: HTMLElement, src: string, alt: string, href?: string): void {
	const img = document.createElement('img');
	img.src = `images/${src}`;
	img.alt = alt;
	img.title = alt;
	// See hosts.ts's matching icon() -- include/cgiutils.h's
	// STATUS_ICON_WIDTH/HEIGHT (20), forced regardless of native image size.
	img.width = 20;
	img.height = 20;
	img.style.marginRight = '2px';
	// See hosts.ts's matching icon() -- without this the img's default
	// inline vertical-align:baseline leaves descender space below it,
	// making the icon row's div taller than the 20px icons it contains.
	img.style.verticalAlign = 'middle';
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

/**
 * Port of cgi/status.c's show_service_detail() host-name column: shown
 * once per *consecutive run* of rows sharing the same host (tracked via
 * plain adjacency in the currently sorted/filtered row order -- see
 * `last_host`/`new_host` in cgi/status.c, no rowspan involved), left blank
 * on every other row. This groups visually whenever the current sort
 * happens to put a host's services next to each other (always true for
 * the default Host-then-Service order; only some of the time otherwise,
 * e.g. sorting by Status), exactly matching upstream's behavior.
 *
 * Coloring: only vivid (statusHOSTDOWN/statusHOSTUNREACHABLE) when the
 * host itself is down/unreachable, matching `host_status_bg_class` in
 * cgi/status.c -- an up/pending host here just gets plain zebra shading
 * (`odd`), same as the Host/Service name cells always do (see
 * renderServiceCell). Only the actual Status column cell is ever the
 * fully saturated statusOK/statusHOSTUP/etc. color.
 */
function renderHostGroupCell(
	hostName: string,
	hostStatus: HostStatusDetails | undefined,
	hostObj: HostObjectDetails | undefined,
	zebraOdd: boolean,
): HTMLTableCellElement {
	const td = document.createElement('td');
	if (hostStatus && (hostStatus.status === 'down' || hostStatus.status === 'unreachable')) {
		td.className = HOST_STATUS_CLASS[hostStatus.status];
	} else {
		td.className = zebraOdd ? 'statusOdd' : 'statusEven';
	}

	const row = document.createElement('div');
	row.style.display = 'flex';
	row.style.alignItems = 'center';
	row.style.justifyContent = 'space-between';
	row.style.gap = '6px';
	td.appendChild(row);

	const nameLink = document.createElement('a');
	nameLink.href = extinfoHostUrl(hostName);
	nameLink.textContent = hostName;
	row.appendChild(nameLink);

	if (hostStatus) {
		const iconLine = document.createElement('div');
		if (hostStatus.problem_has_been_acknowledged) {
			icon(iconLine, 'ack.gif', 'This host problem has been acknowledged');
		}
		if (!hostStatus.notifications_enabled) {
			icon(iconLine, 'ndisabled.gif', 'Notifications for this host have been disabled');
		}
		if (!hostStatus.checks_enabled && !hostStatus.accept_passive_checks) {
			icon(iconLine, 'disabled.gif', 'Active and passive checks have been disabled for this host');
		} else if (!hostStatus.checks_enabled) {
			icon(iconLine, 'passiveonly.gif', 'Active checks have been disabled for this host, only passive checks are being accepted');
		}
		if (hostStatus.is_flapping) {
			icon(iconLine, 'flapping.gif', 'This host is flapping between states');
		}
		if (hostStatus.scheduled_downtime_depth > 0) {
			icon(iconLine, 'downtime.gif', 'This host is currently in a period of scheduled downtime');
		}
		if (hostObj?.notes_url) {
			icon(iconLine, 'notes.gif', 'View extra host notes', hostObj.notes_url);
		}
		if (hostObj?.action_url) {
			icon(iconLine, 'action.gif', 'Perform extra host actions', hostObj.action_url);
		}
		if (hostObj?.icon_image) {
			icon(iconLine, `logos/${hostObj.icon_image}`, hostName);
		}
		row.appendChild(iconLine);
	}

	return td;
}

function renderServiceCell(
	entry: ServiceStatusEntry,
	obj: ServiceObjectDetails | undefined,
	bg: string,
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): HTMLTableCellElement {
	const td = document.createElement('td');
	// cgi/status.c's show_service_detail() colors the service name cell
	// with status_bg_class (the same paler, zebra/ack/downtime-aware
	// class used on Last Check/Duration/etc) -- NOT the vivid status_class
	// reserved for the Status column. See renderHostGroupCell's comment.
	td.className = bg;

	// Name left / icons right, one line (see hosts.ts's renderHostCell for
	// the full rationale, including why not flex-wrap and not
	// white-space: nowrap -- service descriptions can be arbitrarily long,
	// real ones seen at 70+ characters, and forcing an unbroken line would
	// let this column grow unbounded and squeeze every other column).
	const row = document.createElement('div');
	row.style.display = 'flex';
	row.style.alignItems = 'center';
	row.style.justifyContent = 'space-between';
	row.style.gap = '6px';
	td.appendChild(row);

	const nameLink = document.createElement('a');
	nameLink.href = extinfoServiceUrl(entry.hostName, entry.description);
	nameLink.textContent = entry.description;
	row.appendChild(nameLink);

	const iconLine = document.createElement('div');
	const s = entry.status;
	if (s.problem_has_been_acknowledged) {
		icon(iconLine, 'ack.gif', 'This problem has been acknowledged');
	}
	if (!s.notifications_enabled) {
		icon(iconLine, 'ndisabled.gif', 'Notifications for this service have been disabled');
	}
	if (!s.checks_enabled && !s.accept_passive_checks) {
		icon(iconLine, 'disabled.gif', 'Active and passive checks have been disabled for this service');
	} else if (!s.checks_enabled) {
		icon(iconLine, 'passiveonly.gif', 'Active checks have been disabled for this service, only passive checks are being accepted');
	}
	if (s.is_flapping) {
		icon(iconLine, 'flapping.gif', 'This service is flapping between states');
	}
	if (s.scheduled_downtime_depth > 0) {
		icon(iconLine, 'downtime.gif', 'This service is currently in a period of scheduled downtime');
	}
	if (obj?.notes_url) {
		icon(iconLine, 'notes.gif', 'View extra service notes', obj.notes_url);
	}
	if (obj?.action_url) {
		icon(iconLine, 'action.gif', 'Perform extra service actions', obj.action_url);
	}
	if (obj?.icon_image) {
		icon(iconLine, `logos/${obj.icon_image}`, entry.description);
	}
	row.appendChild(iconLine);

	if (SHOW_QUICK_ACTIONS) {
		const actionsLine = document.createElement('div');
		const isProblem = s.status === 'warning' || s.status === 'critical' || s.status === 'unknown';
		if (isProblem && !s.problem_has_been_acknowledged) {
			actionsLine.appendChild(
				actionLink('Ack', async () => {
					const opts = await promptAcknowledge(`service ${entry.description} on ${entry.hostName}`);
					if (!opts) return;
					const result = await acknowledgeService(entry.hostName, entry.description, opts);
					setActionStatus(result.message);
					if (result.ok) onActionComplete();
				}),
			);
			actionsLine.appendChild(document.createTextNode(' '));
		}
		actionsLine.appendChild(
			actionLink('Downtime', async () => {
				const opts = await promptDowntime(`service ${entry.description} on ${entry.hostName}`);
				if (!opts) return;
				const result = await scheduleServiceDowntime(entry.hostName, entry.description, opts);
				setActionStatus(result.message);
				if (result.ok) onActionComplete();
			}),
		);
		row.appendChild(actionsLine);
	}

	return td;
}

function renderTableBody(
	tbody: HTMLTableSectionElement,
	services: ServiceStatusEntry[],
	objects: Map<string, ServiceObjectDetails>,
	queryTime: number,
	sort: SortState,
	memberFilter: Set<string> | null,
	problemFilter: ProblemFilterMode,
	hostStatus: Record<string, HostStatusDetails>,
	hostObjects: Record<string, HostObjectDetails>,
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): void {
	tbody.innerHTML = '';

	let entries = memberFilter ? services.filter((e) => memberFilter.has(serviceKey(e.hostName, e.description))) : services;
	entries = entries.filter((e) => matchesProblemFilter(e, problemFilter, hostStatus));
	entries = [...entries].sort((a, b) => compareServices(a, b, sort));

	let zebraOdd = false;
	// Tracks whether the current row starts a new run of same-host rows,
	// in whatever order `entries` is currently sorted/filtered into -- see
	// renderHostGroupCell's comment.
	let lastHostName: string | null = null;

	for (const entry of entries) {
		const s = entry.status;
		const obj = objects.get(serviceKey(entry.hostName, entry.description));

		const isNewHostGroup = entry.hostName !== lastHostName;
		if (isNewHostGroup && lastHostName !== null) {
			for (let i = 0; i < 2; i++) {
				const spacerRow = document.createElement('tr');
				const spacerCell = document.createElement('td');
				spacerCell.colSpan = COLUMNS.length;
				spacerRow.appendChild(spacerCell);
				tbody.appendChild(spacerRow);
			}
		}
		lastHostName = entry.hostName;

		const row = document.createElement('tr');

		// cgi/status.c's show_service_detail() only gives the vivid
		// status_class (statusOK/statusWARNING/...) to the actual Status
		// column; the Host and Service name cells get the paler,
		// zebra-or-ack/downtime-aware status_bg_class instead (and the
		// collapsed host-group cell is plain zebra unless the HOST itself
		// is down/unreachable) -- see renderHostGroupCell.
		const bg = bgClass(s.status, s.problem_has_been_acknowledged, s.scheduled_downtime_depth > 0, zebraOdd);

		if (isNewHostGroup) {
			row.appendChild(renderHostGroupCell(entry.hostName, hostStatus[entry.hostName], hostObjects[entry.hostName], zebraOdd));
		} else {
			row.appendChild(document.createElement('td'));
		}

		row.appendChild(renderServiceCell(entry, obj, bg, onActionComplete, setActionStatus));

		const statusCell = document.createElement('td');
		statusCell.className = STATUS_CLASS[s.status];
		statusCell.textContent = STATUS_LABEL[s.status];
		row.appendChild(statusCell);

		if (s.status === 'ok' || s.status === 'pending') {
			zebraOdd = !zebraOdd;
		}

		// See hosts.ts's renderTableBody -- cgi/status.c marks these two
		// cells `nowrap` explicitly.
		const lastCheckCell = document.createElement('td');
		lastCheckCell.className = bg;
		lastCheckCell.style.whiteSpace = 'nowrap';
		lastCheckCell.textContent = formatTimestamp(s.last_check);
		row.appendChild(lastCheckCell);

		const durationCell = document.createElement('td');
		durationCell.className = bg;
		durationCell.style.whiteSpace = 'nowrap';
		durationCell.textContent = formatDuration(queryTime, s.last_state_change, s.last_state_change === 0);
		row.appendChild(durationCell);

		const attemptCell = document.createElement('td');
		attemptCell.className = bg;
		attemptCell.textContent = `${s.current_attempt}/${s.max_attempts}`;
		row.appendChild(attemptCell);

		const infoCell = document.createElement('td');
		infoCell.className = bg;
		infoCell.textContent = s.plugin_output;
		row.appendChild(infoCell);

		tbody.appendChild(row);
	}

	if (entries.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = COLUMNS.length;
		cell.textContent = 'No services match this filter.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

function sortIndicator(sort: SortState, key: SortKey): string {
	if (sort.key !== key) return '';
	return sort.direction === 'asc' ? ' ▲' : ' ▼';
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderServices(container: HTMLElement, initialFilter: ProblemFilterMode = 'all'): () => void {
	container.innerHTML = '<p>Loading services...</p>';

	// cgi/status.c defaults to sort_type=SORT_NONE (i.e. no sort at all --
	// services list in servicestatus_list's natural/registration order,
	// which groups each host's services together since they're normally
	// defined consecutively): none of its own generated links (including
	// the "Unhandled"/nav links this SPA's Problems > Services mirrors)
	// pass sorttype=/sortoption= to override that. There's no equivalent
	// "don't sort at all" state here, so sorting by host ascending is the
	// closest match -- it's what upstream's default ends up looking like,
	// and (unlike defaulting to status) it keeps a host's own rows
	// together so the collapsed Host cell (see renderHostGroupCell) has
	// something to collapse by default.
	const sort: SortState = { key: 'host', direction: 'asc' };
	let selectedGroup: string | null = null;
	let problemFilter: ProblemFilterMode = initialFilter;
	let stopped = false;

	let currentServices: ServiceStatusEntry[] = [];
	let currentObjects: Map<string, ServiceObjectDetails> = new Map();
	let currentGroups: ServiceGroupDetails[] = [];
	let currentHostStatus: Record<string, HostStatusDetails> = {};
	let currentHostObjects: Record<string, HostObjectDetails> = {};
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
		if (!group) return null;
		return new Set(group.members.map((m) => serviceKey(m.host_name, m.service_description)));
	}

	// Scoped by Service Group only, matching cgi/status.c's
	// show_service_status_totals() -- unlike the table below, this box is
	// NOT affected by the Problems/Unhandled Problems filter. Uses
	// statusjson.cgi?query=servicecount (a handful of bytes) instead of
	// computing this from currentServices, since that's now whatever the
	// Problems/Unhandled filter narrowed the main fetch to, not the true
	// breakdown across every service in scope. See hosts.ts's
	// renderTotalsPanel for the identical rationale.
	let totalsRequestId = 0;
	function renderTotalsPanel(): void {
		if (!totalsContainer) return;
		const requestId = ++totalsRequestId;
		void fetchServiceCount(selectedGroup ?? undefined).then((count) => {
			if (requestId !== totalsRequestId || !totalsContainer) return;
			totalsContainer.innerHTML = '';
			totalsContainer.appendChild(
				renderStatusTotals(
					'service',
					'Service Status Totals',
					[
						{ label: 'Ok', count: count.ok, classSuffix: 'OK' },
						{ label: 'Warning', count: count.warning, classSuffix: 'WARNING' },
						{ label: 'Unknown', count: count.unknown, classSuffix: 'UNKNOWN' },
						{ label: 'Critical', count: count.critical, classSuffix: 'CRITICAL' },
						{ label: 'Pending', count: count.pending, classSuffix: 'PENDING' },
					],
					count.warning + count.unknown + count.critical,
					count.ok + count.warning + count.unknown + count.critical + count.pending,
				),
			);
		});
	}

	function currentlyDisplayedCount(): number {
		const memberFilter = currentMemberFilter();
		return currentServices.filter(
			(e) =>
				(!memberFilter || memberFilter.has(serviceKey(e.hostName, e.description))) &&
				matchesProblemFilter(e, problemFilter, currentHostStatus),
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
				currentServices,
				currentObjects,
				currentQueryTime,
				sort,
				currentMemberFilter(),
				problemFilter,
				currentHostStatus,
				currentHostObjects,
				() => void load(false),
				setActionStatus,
			);
		}
		if (heading) {
			heading.textContent = `Services (${currentlyDisplayedCount()})`;
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
		allOption.textContent = `All Service Groups (${currentGroups.length})`;
		groupSelect.appendChild(allOption);

		for (const group of [...currentGroups].sort((a, b) => a.alias.localeCompare(b.alias))) {
			const option = document.createElement('option');
			option.value = group.group_name;
			option.textContent = `${group.alias} (${group.members.length})`;
			groupSelect.appendChild(option);
		}

		if (previous && currentGroups.some((g) => g.group_name === previous)) {
			groupSelect.value = previous;
		}
	}

	async function load(initial: boolean): Promise<void> {
		let statusResult;
		let objects;
		let groups;
		let hostStatusResult;
		let hostObjects;
		try {
			// objectjson.cgi's notes_url/action_url/icon_image and the
			// servicegroup membership list only change when the Nagios config
			// is edited and reloaded -- unlike status, they don't need
			// refetching on every 90s auto-refresh tick. Skipping them here
			// also sidesteps a real O(hosts * services) cost in objectjson.cgi's
			// query=servicelist implementation (cgi/objectjson.c's
			// json_object_servicelist(), same shape as statusjson.cgi's --
			// see that file's fix) on a large deployment. Same reasoning for
			// the host object details used by the collapsed host-group cell.
			if (initial) {
				[statusResult, objects, groups, hostStatusResult, hostObjects] = await Promise.all([
					fetchServiceStatusDetails(problemFilter),
					fetchServiceObjectDetails(),
					fetchServiceGroups(),
					fetchHostStatusDetails(),
					fetchHostObjectDetails(),
				]);
			} else {
				[statusResult, hostStatusResult] = await Promise.all([fetchServiceStatusDetails(problemFilter), fetchHostStatusDetails()]);
				objects = currentObjects;
				groups = currentGroups;
				hostObjects = currentHostObjects;
			}
		} catch (err) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load service status: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		currentServices = statusResult.services;
		currentQueryTime = statusResult.queryTime;
		currentObjects = objects;
		currentGroups = groups;
		currentHostStatus = hostStatusResult.hosts;
		currentHostObjects = hostObjects;

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			totalsContainer = document.createElement('div');
			container.appendChild(totalsContainer);

			const filterBar = document.createElement('div');
			filterBar.id = 'detailFilterBar';
			const label = document.createElement('label');
			label.textContent = 'Service Group: ';
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
				['all', 'All Services'],
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
				// Refetch (not just rerenderTable) so switching to
				// Problems/Unhandled actually narrows the request server-side
				// instead of re-filtering the already-fetched full dataset.
				void load(false);
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
