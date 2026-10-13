import { fetchNotifications, extinfoHostUrl, extinfoServiceUrl, type NotificationEntry } from './api';
import { formatTimestamp } from './format';
import { startAutoRefresh } from './refresh';
import { ListControls, setHighlightedText, type FilterField, type FilterQuery } from './listcontrols';

/**
 * Port of notifications.cgi?contact=all: recent host/service
 * notifications. archivejson.cgi's notificationlist query needs an
 * explicit time window (unlike statusjson.cgi's live lists), so this
 * shows a rolling last-24-hours window recomputed on every refresh,
 * rather than trying to replicate notifications.cgi's own (much larger)
 * set of selection filters. A noisy day can mean thousands of rows, so
 * like hosts.ts/services.ts only one page is rendered (listcontrols.ts),
 * with the same filter box standing in for Ctrl-F.
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

/** Columns the filter box can address as `name:value` (see listcontrols.ts's FilterQuery). */
const FILTER_FIELDS: FilterField[] = [
	{ name: 'host', help: 'host name' },
	{ name: 'service', aliases: ['svc'], help: 'service description (host notifications have none)' },
	{ name: 'contact', help: 'contact notified' },
	{ name: 'type', help: 'notification type (type:crit, type:recovery, type:ack)' },
	{ name: 'method', help: 'notification command' },
	{ name: 'message', help: 'notification text' },
];

function typeLabel(entry: NotificationEntry): string {
	return NOTIFICATION_TYPE_LABEL[entry.notification_type] ?? entry.notification_type;
}

function notificationSubject(entry: NotificationEntry): string {
	return entry.object_type === 'service' ? `${entry.host_name}/${entry.description}` : (entry.name ?? '');
}

function notificationUrl(entry: NotificationEntry): string {
	return entry.object_type === 'service'
		? extinfoServiceUrl(entry.host_name ?? '', entry.description ?? '')
		: extinfoHostUrl(entry.name ?? '');
}

function renderTableBody(tbody: HTMLTableSectionElement, entries: NotificationEntry[], filter: FilterQuery, emptyText: string): void {
	tbody.innerHTML = '';

	for (const entry of entries) {
		const row = document.createElement('tr');

		const timeCell = document.createElement('td');
		timeCell.textContent = formatTimestamp(entry.timestamp);
		row.appendChild(timeCell);

		const subjectCell = document.createElement('td');
		const link = document.createElement('a');
		link.href = notificationUrl(entry);
		// One "host/service" link, so it highlights either column's terms.
		setHighlightedText(link, notificationSubject(entry), [...filter.highlightFor('host'), ...filter.highlightFor('service')]);
		subjectCell.appendChild(link);
		row.appendChild(subjectCell);

		const contactCell = document.createElement('td');
		setHighlightedText(contactCell, entry.contact, filter.highlightFor('contact'));
		row.appendChild(contactCell);

		const typeCell = document.createElement('td');
		setHighlightedText(typeCell, typeLabel(entry), filter.highlightFor('type'));
		row.appendChild(typeCell);

		const methodCell = document.createElement('td');
		setHighlightedText(methodCell, entry.method, filter.highlightFor('method'));
		row.appendChild(methodCell);

		const messageCell = document.createElement('td');
		setHighlightedText(messageCell, entry.message, filter.highlightFor('message'));
		row.appendChild(messageCell);

		tbody.appendChild(row);
	}

	if (entries.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 6;
		cell.textContent = emptyText;
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderNotifications(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading notifications...</p>';

	let tbody: HTMLTableSectionElement | null = null;
	let heading: HTMLElement | null = null;

	const refresher = startAutoRefresh(REFRESH_INTERVAL_MS, () => load(false));

	// Newest first, sorted once per load; the filter box only narrows it.
	let currentEntries: NotificationEntry[] = [];
	let haystacks = new WeakMap<NotificationEntry, Record<string, string>>();
	function haystack(e: NotificationEntry): Record<string, string> {
		let h = haystacks.get(e);
		if (h === undefined) {
			h = {
				host: (e.object_type === 'service' ? e.host_name ?? '' : e.name ?? '').toLowerCase(),
				service: (e.object_type === 'service' ? e.description ?? '' : '').toLowerCase(),
				contact: e.contact.toLowerCase(),
				type: typeLabel(e).toLowerCase(),
				method: e.method.toLowerCase(),
				message: e.message.toLowerCase(),
			};
			haystacks.set(e, h);
		}
		return h;
	}

	const controls = new ListControls('notifications', FILTER_FIELDS, 'contact:admin type:crit', () => rerenderTable());

	function rerenderTable(): void {
		const filter = controls.filter();
		const matched = filter.empty ? currentEntries : currentEntries.filter((e) => filter.matches(haystack(e)));
		const page = controls.slice(matched);
		if (tbody) {
			renderTableBody(tbody, page.items, filter, currentEntries.length === 0 ? 'No notifications in the last 24 hours.' : 'No notifications match this filter.');
		}
		if (heading) {
			heading.textContent = filter.empty ? `Notifications (${currentEntries.length})` : `Notifications (${matched.length} of ${currentEntries.length})`;
		}
	}

	async function load(initial: boolean): Promise<void> {
		const now = Math.floor(Date.now() / 1000);
		let entries: NotificationEntry[];
		try {
			entries = await fetchNotifications({ startTime: now - WINDOW_SECONDS, endTime: now });
		} catch (err) {
			if (!initial) {
				refresher.failed(err);
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
			container.appendChild(refresher.el);

			const filterBar = document.createElement('div');
			filterBar.id = 'detailFilterBar';
			filterBar.appendChild(document.createTextNode('Showing the last 24 hours. '));
			filterBar.appendChild(controls.input);
			container.appendChild(filterBar);

			container.appendChild(controls.topPager);

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

			container.appendChild(controls.bottomPager);
		}

		currentEntries = [...entries].sort((a, b) => b.timestamp - a.timestamp);
		haystacks = new WeakMap();
		refresher.succeeded(now);
		rerenderTable();
	}

	void load(true);

	return () => {
		controls.destroy();
		refresher.stop();
	};
}
