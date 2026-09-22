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
 */

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

export async function renderHosts(container: HTMLElement): Promise<void> {
	container.innerHTML = '<p>Loading hosts...</p>';

	let statusResult;
	let objects;
	try {
		[statusResult, objects] = await Promise.all([fetchHostStatusDetails(), fetchHostObjectDetails()]);
	} catch (err) {
		container.innerHTML = '';
		const p = document.createElement('p');
		p.textContent = `Failed to load host status: ${err instanceof Error ? err.message : String(err)}`;
		container.appendChild(p);
		return;
	}

	const { queryTime, hosts } = statusResult;
	const hostNames = Object.keys(hosts).sort((a, b) => a.localeCompare(b));

	container.innerHTML = '';

	const heading = document.createElement('h2');
	heading.textContent = `Hosts (${hostNames.length})`;
	container.appendChild(heading);

	const table = document.createElement('table');
	table.className = 'status';

	const thead = document.createElement('thead');
	const headRow = document.createElement('tr');
	for (const label of ['Host', 'Status', 'Last Check', 'Duration', 'Status Information']) {
		const th = document.createElement('th');
		th.className = 'status';
		th.textContent = label;
		headRow.appendChild(th);
	}
	thead.appendChild(headRow);
	table.appendChild(thead);

	const tbody = document.createElement('tbody');
	let zebraOdd = false;

	for (const hostName of hostNames) {
		const status = hosts[hostName];
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

	table.appendChild(tbody);
	container.appendChild(table);
}
