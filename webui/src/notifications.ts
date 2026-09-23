import { fetchNotifications, extinfoHostUrl, extinfoServiceUrl, type NotificationEntry } from './api';
import { formatTimestamp } from './format';

/**
 * Port of notifications.cgi?contact=all: recent host/service
 * notifications. archivejson.cgi's notificationlist query needs an
 * explicit time window (unlike statusjson.cgi's live lists), so this
 * shows a rolling last-24-hours window recomputed on every refresh,
 * rather than trying to replicate notifications.cgi's own (much larger)
 * set of selection filters.
 */

const REFRESH_INTERVAL_MS = 90_000;
const WINDOW_SECONDS = 24 * 60 * 60;

const NOTIFICATION_TYPE_LABEL: Record<string, string> = {
	nodata: 'No Data',
	down: 'Host Down',
	unreachable: 'Host Unreachable',
	hostcustom: 'Host Custom',
	hostack: 'Host Acknowledgement',
	hostflapstart: 'Host Flapping Start',
	hostflapstop: 'Host Flapping Stop',
	critical: 'Service Critical',
	warning: 'Service Warning',
	custom: 'Service Custom',
	serviceack: 'Service Acknowledgement',
	serviceflapstart: 'Service Flapping Start',
	serviceflapstop: 'Service Flapping Stop',
	unknown: 'Service Unknown',
	// "recovery" is shared by both the host- and service-recovery enum
	// values server-side; the Host/Service column already disambiguates.
	recovery: 'Recovery',
};

function notificationSubject(entry: NotificationEntry): string {
	return entry.object_type === 'service' ? `${entry.host_name}/${entry.description}` : (entry.name ?? '');
}

function notificationUrl(entry: NotificationEntry): string {
	return entry.object_type === 'service'
		? extinfoServiceUrl(entry.host_name ?? '', entry.description ?? '')
		: extinfoHostUrl(entry.name ?? '');
}

function renderTableBody(tbody: HTMLTableSectionElement, entries: NotificationEntry[]): void {
	tbody.innerHTML = '';

	const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

	for (const entry of sorted) {
		const row = document.createElement('tr');

		const timeCell = document.createElement('td');
		timeCell.textContent = formatTimestamp(entry.timestamp);
		row.appendChild(timeCell);

		const subjectCell = document.createElement('td');
		const link = document.createElement('a');
		link.href = notificationUrl(entry);
		link.textContent = notificationSubject(entry);
		subjectCell.appendChild(link);
		row.appendChild(subjectCell);

		const contactCell = document.createElement('td');
		contactCell.textContent = entry.contact;
		row.appendChild(contactCell);

		const typeCell = document.createElement('td');
		typeCell.textContent = NOTIFICATION_TYPE_LABEL[entry.notification_type] ?? entry.notification_type;
		row.appendChild(typeCell);

		const methodCell = document.createElement('td');
		methodCell.textContent = entry.method;
		row.appendChild(methodCell);

		const messageCell = document.createElement('td');
		messageCell.textContent = entry.message;
		row.appendChild(messageCell);

		tbody.appendChild(row);
	}

	if (sorted.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 6;
		cell.textContent = 'No notifications in the last 24 hours.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderNotifications(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading notifications...</p>';

	let stopped = false;
	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;

	async function load(initial: boolean): Promise<void> {
		const now = Math.floor(Date.now() / 1000);
		let entries: NotificationEntry[];
		try {
			entries = await fetchNotifications({ startTime: now - WINDOW_SECONDS, endTime: now });
		} catch (err) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load notifications: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		if (initial) {
			container.innerHTML = '';

			heading = document.createElement('h2');
			container.appendChild(heading);

			const note = document.createElement('div');
			note.id = 'detailFilterBar';
			note.textContent = 'Showing the last 24 hours.';
			container.appendChild(note);

			lastUpdatedEl = document.createElement('div');
			lastUpdatedEl.id = 'detailLastUpdated';
			container.appendChild(lastUpdatedEl);

			const table = document.createElement('table');
			table.className = 'status';

			const thead = document.createElement('thead');
			const headRow = document.createElement('tr');
			for (const label of ['Time', 'Host/Service', 'Contact', 'Type', 'Method', 'Message']) {
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

		if (heading) {
			heading.textContent = `Notifications (${entries.length})`;
		}
		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(now)}`;
		}
		if (tbody) {
			renderTableBody(tbody, entries);
		}
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
