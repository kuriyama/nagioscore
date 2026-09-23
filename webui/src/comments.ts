import { fetchComments, extinfoHostUrl, extinfoServiceUrl, type CommentEntry } from './api';
import { formatTimestamp } from './format';
import { deleteHostComment, deleteServiceComment } from './commands';

/**
 * Port of extinfo.cgi?type=3 ("Comments"): all active host/service
 * comments (user comments, plus the comments Nagios itself generates for
 * acknowledgements/downtime/flapping). Simpler than hosts.ts/services.ts --
 * no sort/group-filter, matching the original page -- but keeps the same
 * auto-refresh and inline-action conventions.
 */

const REFRESH_INTERVAL_MS = 90_000;

const ENTRY_TYPE_LABEL: Record<CommentEntry['entry_type'], string> = {
	user: 'User',
	downtime: 'Downtime',
	flapping: 'Flapping',
	acknowledgement: 'Acknowledgement',
};

function commentSubject(entry: CommentEntry): string {
	return entry.comment_type === 'service' ? `${entry.host_name}/${entry.service_description}` : entry.host_name;
}

function renderTableBody(
	tbody: HTMLTableSectionElement,
	comments: CommentEntry[],
	onActionComplete: () => void,
	setActionStatus: (msg: string) => void,
): void {
	tbody.innerHTML = '';

	const entries = [...comments].sort((a, b) => b.entry_time - a.entry_time);

	for (const entry of entries) {
		const row = document.createElement('tr');

		const hostCell = document.createElement('td');
		const link = document.createElement('a');
		link.href = entry.comment_type === 'service' ? extinfoServiceUrl(entry.host_name, entry.service_description ?? '') : extinfoHostUrl(entry.host_name);
		link.textContent = commentSubject(entry);
		hostCell.appendChild(link);
		row.appendChild(hostCell);

		const entryTimeCell = document.createElement('td');
		entryTimeCell.textContent = formatTimestamp(entry.entry_time);
		row.appendChild(entryTimeCell);

		const authorCell = document.createElement('td');
		authorCell.textContent = entry.author;
		row.appendChild(authorCell);

		const commentCell = document.createElement('td');
		commentCell.textContent = entry.comment_data;
		row.appendChild(commentCell);

		const typeCell = document.createElement('td');
		typeCell.textContent = ENTRY_TYPE_LABEL[entry.entry_type];
		row.appendChild(typeCell);

		const persistentCell = document.createElement('td');
		persistentCell.textContent = entry.persistent ? 'Yes' : 'No';
		row.appendChild(persistentCell);

		const actionCell = document.createElement('td');
		const del = document.createElement('a');
		del.href = '#';
		del.textContent = 'Delete';
		del.className = 'actionLink';
		del.addEventListener('click', async (ev) => {
			ev.preventDefault();
			if (!window.confirm(`Delete this comment for ${commentSubject(entry)}?`)) {
				return;
			}
			const result =
				entry.comment_type === 'service' ? await deleteServiceComment(entry.comment_id) : await deleteHostComment(entry.comment_id);
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
		cell.colSpan = 7;
		cell.textContent = 'There are no comments.';
		row.appendChild(cell);
		tbody.appendChild(row);
	}
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderComments(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading comments...</p>';

	let stopped = false;
	let currentComments: CommentEntry[] = [];

	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;
	let actionStatusEl: HTMLElement | null = null;
	let heading: HTMLElement | null = null;

	function setActionStatus(msg: string): void {
		if (actionStatusEl) actionStatusEl.textContent = msg;
	}

	function rerenderTable(): void {
		if (tbody) {
			renderTableBody(tbody, currentComments, () => void load(false), setActionStatus);
		}
		if (heading) {
			heading.textContent = `Comments (${currentComments.length})`;
		}
	}

	async function load(initial: boolean): Promise<void> {
		let comments;
		try {
			comments = await fetchComments();
		} catch (err) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = `Failed to load comments: ${err instanceof Error ? err.message : String(err)}`;
			container.appendChild(p);
			return;
		}

		currentComments = comments;

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
			for (const label of ['Host/Service', 'Entry Time', 'Author', 'Comment', 'Type', 'Persistent', 'Actions']) {
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
