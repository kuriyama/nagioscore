import { fetchProgramStatus, type ProgramStatus } from './api';
import { formatTimestamp } from './format';

/**
 * Port of extinfo.cgi?type=0 ("Process Info"): a read-only fact sheet of
 * the running Nagios process's identity and global feature toggles.
 * statusjson.cgi's programstatus query doesn't expose the process-control
 * actions the original page also offers (shutdown/restart/enable-disable
 * links) -- this is display-only, matching what the JSON API can actually
 * answer.
 */

const REFRESH_INTERVAL_MS = 90_000;

function yesNo(value: boolean | undefined): string {
	if (value === undefined) return 'N/A';
	return value ? 'Yes' : 'No';
}

function addRow(tbody: HTMLTableSectionElement, label: string, value: string): void {
	const row = document.createElement('tr');
	const labelCell = document.createElement('td');
	labelCell.textContent = label;
	labelCell.style.fontWeight = 'bold';
	row.appendChild(labelCell);
	const valueCell = document.createElement('td');
	valueCell.textContent = value;
	row.appendChild(valueCell);
	tbody.appendChild(row);
}

function renderFacts(tbody: HTMLTableSectionElement, status: ProgramStatus): void {
	tbody.innerHTML = '';
	addRow(tbody, 'Nagios Version', status.version ?? 'N/A');
	addRow(tbody, 'Process ID', String(status.nagios_pid));
	addRow(tbody, 'Daemon Mode', yesNo(status.daemon_mode));
	addRow(tbody, 'Program Start Time', status.program_start ? formatTimestamp(status.program_start) : 'N/A');
	addRow(tbody, 'Last Log Rotation', status.last_log_rotation ? formatTimestamp(status.last_log_rotation) : 'N/A');
	addRow(tbody, 'Notifications Enabled', yesNo(status.enable_notifications));
	addRow(tbody, 'Event Handlers Enabled', yesNo(status.enable_event_handlers));
	addRow(tbody, 'Flap Detection Enabled', yesNo(status.enable_flap_detection));
	addRow(tbody, 'Process Performance Data', yesNo(status.process_performance_data));
	addRow(tbody, 'Active Host Checks Enabled', yesNo(status.execute_host_checks));
	addRow(tbody, 'Passive Host Checks Enabled', yesNo(status.accept_passive_host_checks));
	addRow(tbody, 'Active Service Checks Enabled', yesNo(status.execute_service_checks));
	addRow(tbody, 'Passive Service Checks Enabled', yesNo(status.accept_passive_service_checks));
	addRow(tbody, 'Obsessing Over Hosts', yesNo(status.obsess_over_hosts));
	addRow(tbody, 'Obsessing Over Services', yesNo(status.obsess_over_services));
	addRow(tbody, 'Host Freshness Checking Enabled', yesNo(status.check_host_freshness));
	addRow(tbody, 'Service Freshness Checking Enabled', yesNo(status.check_service_freshness));
}

/** Returns a cleanup function the caller should invoke when navigating away (stops auto-refresh). */
export function renderProcessInfo(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading process information...</p>';

	let stopped = false;
	let tbody: HTMLTableSectionElement | null = null;
	let lastUpdatedEl: HTMLElement | null = null;

	async function load(initial: boolean): Promise<void> {
		const status = await fetchProgramStatus();
		if (!status) {
			if (!initial) {
				if (lastUpdatedEl) {
					lastUpdatedEl.textContent = 'Refresh failed: could not load process information.';
				}
				return;
			}
			container.innerHTML = '';
			const p = document.createElement('p');
			p.textContent = 'Failed to load process information.';
			container.appendChild(p);
			return;
		}

		if (initial) {
			container.innerHTML = '';

			const heading = document.createElement('h2');
			heading.textContent = 'Process Information';
			container.appendChild(heading);

			lastUpdatedEl = document.createElement('div');
			lastUpdatedEl.id = 'detailLastUpdated';
			container.appendChild(lastUpdatedEl);

			const table = document.createElement('table');
			table.className = 'status';
			tbody = document.createElement('tbody');
			table.appendChild(tbody);
			container.appendChild(table);
		}

		if (lastUpdatedEl) {
			lastUpdatedEl.textContent = `Last updated: ${formatTimestamp(Math.floor(Date.now() / 1000))}`;
		}
		if (tbody) {
			renderFacts(tbody, status);
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
