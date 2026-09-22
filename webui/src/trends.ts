import {
	fetchHostNames,
	fetchServices,
	fetchStateChangeList,
	fetchAvailability,
	trendsPngUrl,
	type ArchiveState,
	type TrendsReportType,
	type StateChangeEntry,
	type HostAvailability,
	type ServiceAvailability,
	type ServiceEntry,
} from './api';
import { formatDuration, formatTimestamp } from './format';

/**
 * Port of html/trends.html + html/js/trends-form.js + html/js/trends-graph.js
 * onto the TS SPA, replacing the AngularJS 1.3.9 + D3 + Bootstrap 3.3.7
 * stack those relied on (see notes/modernization-survey-2026-09-23.md item 1
 * and notes/trends-histogram-spa-2026-09-23.md for the full writeup).
 *
 * Scope deliberately narrower than the original:
 *  - No zoom/pan on the timeline (d3.behavior.zoom in the original). The
 *    time-range picker already lets you pick a narrower window and
 *    regenerate, which covers the same need with less code/no new
 *    dependency.
 *  - No hover popups with a custom positioned box -- native SVG <title>
 *    tooltips on each segment cover the same "what state was this and for
 *    how long" need with zero JS wiring.
 *  - A fixed set of time-range presets (see TIME_PRESETS below) instead of
 *    the original's full canned-timeperiod list (today/yesterday/this
 *    week/last week/this year/last year/...) -- the presets here plus the
 *    custom start/end fields cover the common cases; not a 1:1 port of
 *    nagiosTimeService's timeperiod calculations.
 * Everything else (host/service picker, hard/soft state toggle, backtrack
 * setting, the state-change timeline + availability breakdown, and a link
 * to the original PNG export for embedding/printing) has real parity.
 */

const HOST_STATE_COLOR: Record<string, string> = {
	up: '#00c000',
	down: '#ff0000',
	unreachable: '#800000',
	nodata: '#a0a0a0',
};

const HOST_STATE_LABEL: Record<string, string> = {
	up: 'Up',
	down: 'Down',
	unreachable: 'Unreachable',
	nodata: 'Indeterminate',
};

const SERVICE_STATE_COLOR: Record<string, string> = {
	ok: '#00c000',
	warning: '#b0b214',
	unknown: '#ff6419',
	critical: '#ff0000',
	nodata: '#a0a0a0',
};

const SERVICE_STATE_LABEL: Record<string, string> = {
	ok: 'OK',
	warning: 'Warning',
	unknown: 'Unknown',
	critical: 'Critical',
	nodata: 'Indeterminate',
};

function stateColor(reportType: TrendsReportType, state: ArchiveState): string {
	const table = reportType === 'hosts' ? HOST_STATE_COLOR : SERVICE_STATE_COLOR;
	return table[state] ?? '#a0a0a0';
}

function stateLabel(reportType: TrendsReportType, state: ArchiveState): string {
	const table = reportType === 'hosts' ? HOST_STATE_LABEL : SERVICE_STATE_LABEL;
	return table[state] ?? state;
}

interface TimePreset {
	label: string;
	/** Returns [startEpochSeconds, endEpochSeconds]. */
	range: () => [number, number];
}

const TIME_PRESETS: TimePreset[] = [
	{
		label: 'Last 4 Hours',
		range: () => {
			const end = Math.floor(Date.now() / 1000);
			return [end - 4 * 3600, end];
		},
	},
	{
		label: 'Last 24 Hours',
		range: () => {
			const end = Math.floor(Date.now() / 1000);
			return [end - 24 * 3600, end];
		},
	},
	{
		label: 'Last 7 Days',
		range: () => {
			const end = Math.floor(Date.now() / 1000);
			return [end - 7 * 86400, end];
		},
	},
	{
		label: 'Last 31 Days',
		range: () => {
			const end = Math.floor(Date.now() / 1000);
			return [end - 31 * 86400, end];
		},
	},
	{
		label: 'This Month',
		range: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
			return [Math.floor(start.getTime() / 1000), Math.floor(Date.now() / 1000)];
		},
	},
	{
		label: 'Last Month',
		range: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
			const end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
			return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)];
		},
	},
];

const CUSTOM_PRESET_LABEL = 'Custom Range';

function datetimeLocalValue(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocal(value: string): number | null {
	if (!value) return null;
	const ms = new Date(value).getTime();
	return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Builds the horizontal state-change timeline as inline SVG. No external
    charting library -- see the file-level comment for why. */
function renderTimeline(
	container: HTMLElement,
	reportType: TrendsReportType,
	startTime: number,
	endTime: number,
	entries: StateChangeEntry[],
): void {
	container.innerHTML = '';

	if (entries.length === 0) {
		const p = document.createElement('p');
		p.textContent = 'No state changes recorded in this time range.';
		container.appendChild(p);
		return;
	}

	const width = 900;
	const height = 90;
	const marginLeft = 8;
	const marginRight = 8;
	const barTop = 10;
	const barHeight = 40;
	const axisY = barTop + barHeight + 20;

	const span = Math.max(1, endTime - startTime);
	const x = (t: number) => marginLeft + ((Math.min(Math.max(t, startTime), endTime) - startTime) / span) * (width - marginLeft - marginRight);

	const svgNS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(svgNS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', String(height));
	svg.style.maxWidth = `${width}px`;
	svg.style.display = 'block';

	// One segment per consecutive pair of entries; the last entry is a
	// "Final .. Pseudo-State" bookend (see json_archive_statechangelist in
	// cgi/archivejson.c) so it never starts a segment of its own.
	for (let i = 0; i < entries.length - 1; i++) {
		const seg = entries[i];
		const next = entries[i + 1];
		const segStart = Math.max(seg.timestamp, startTime);
		const segEnd = Math.min(next.timestamp, endTime);
		if (segEnd <= segStart) continue;

		const rect = document.createElementNS(svgNS, 'rect');
		rect.setAttribute('x', String(x(segStart)));
		rect.setAttribute('y', String(barTop));
		rect.setAttribute('width', String(Math.max(0.5, x(segEnd) - x(segStart))));
		rect.setAttribute('height', String(barHeight));
		rect.setAttribute('fill', stateColor(reportType, seg.state));

		const title = document.createElementNS(svgNS, 'title');
		const durationSeconds = segEnd - segStart;
		title.textContent =
			`${stateLabel(reportType, seg.state)} (${seg.state_type})\n` +
			`${formatTimestamp(segStart)} → ${formatTimestamp(segEnd)}\n` +
			`Duration: ${formatDuration(durationSeconds, 0, false)}` +
			(seg.plugin_output ? `\n${seg.plugin_output}` : '');
		rect.appendChild(title);

		svg.appendChild(rect);
	}

	// Simple 5-tick x-axis.
	const tickCount = 5;
	for (let i = 0; i <= tickCount; i++) {
		const t = startTime + (span * i) / tickCount;
		const tx = x(t);

		const tick = document.createElementNS(svgNS, 'line');
		tick.setAttribute('x1', String(tx));
		tick.setAttribute('x2', String(tx));
		tick.setAttribute('y1', String(barTop));
		tick.setAttribute('y2', String(barTop + barHeight + 4));
		tick.setAttribute('stroke', '#888');
		tick.setAttribute('stroke-width', '1');
		svg.appendChild(tick);

		const label = document.createElementNS(svgNS, 'text');
		label.setAttribute('x', String(tx));
		label.setAttribute('y', String(axisY));
		label.setAttribute('font-size', '10');
		label.setAttribute(
			'text-anchor',
			i === 0 ? 'start' : i === tickCount ? 'end' : 'middle',
		);
		label.textContent = formatTimestamp(t);
		svg.appendChild(label);
	}

	container.appendChild(svg);
}

function renderLegend(container: HTMLElement, reportType: TrendsReportType): void {
	container.innerHTML = '';
	const table = reportType === 'hosts' ? HOST_STATE_COLOR : SERVICE_STATE_COLOR;
	const labels = reportType === 'hosts' ? HOST_STATE_LABEL : SERVICE_STATE_LABEL;
	for (const state of Object.keys(table)) {
		const item = document.createElement('span');
		item.className = 'trendsLegendItem';
		const swatch = document.createElement('span');
		swatch.className = 'trendsLegendSwatch';
		swatch.style.backgroundColor = table[state];
		item.appendChild(swatch);
		item.appendChild(document.createTextNode(labels[state]));
		container.appendChild(item);
	}
}

function renderAvailability(
	container: HTMLElement,
	reportType: TrendsReportType,
	availability: HostAvailability | ServiceAvailability | undefined,
): void {
	container.innerHTML = '';
	if (!availability) {
		return;
	}

	const rows: [string, number][] =
		reportType === 'hosts'
			? (() => {
					const a = availability as HostAvailability;
					return [
						['Up', a.time_up],
						['Down', a.time_down],
						['Unreachable', a.time_unreachable],
						['Indeterminate (no data)', a.time_indeterminate_nodata],
						['Indeterminate (not running)', a.time_indeterminate_notrunning],
					];
				})()
			: (() => {
					const a = availability as ServiceAvailability;
					return [
						['OK', a.time_ok],
						['Warning', a.time_warning],
						['Critical', a.time_critical],
						['Unknown', a.time_unknown],
						['Indeterminate (no data)', a.time_indeterminate_nodata],
						['Indeterminate (not running)', a.time_indeterminate_notrunning],
					];
				})();

	const total = rows.reduce((sum, [, seconds]) => sum + seconds, 0);

	const table = document.createElement('table');
	table.className = 'status';
	const thead = document.createElement('thead');
	thead.innerHTML = '<tr><th class="status">State</th><th class="status">Time</th><th class="status">Percent</th></tr>';
	table.appendChild(thead);
	const tbody = document.createElement('tbody');
	for (const [label, seconds] of rows) {
		if (seconds <= 0) continue;
		const tr = document.createElement('tr');
		const pct = total > 0 ? ((seconds / total) * 100).toFixed(2) : '0.00';
		tr.innerHTML = `<td>${label}</td><td>${formatDuration(seconds, 0, false)}</td><td>${pct}%</td>`;
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	container.appendChild(table);
}

export function renderTrends(container: HTMLElement): () => void {
	container.innerHTML = '<p>Loading...</p>';

	let hostNames: string[] = [];
	let services: ServiceEntry[] = [];
	let stopped = false;

	const form = document.createElement('form');
	form.className = 'trendsForm';

	const heading = document.createElement('h2');
	heading.textContent = 'Host and Service State Trends';
	container.innerHTML = '';
	container.appendChild(heading);

	// --- Report type ---
	const reportTypeLabel = document.createElement('label');
	reportTypeLabel.textContent = 'Report Type: ';
	const reportTypeSelect = document.createElement('select');
	for (const [value, label] of [
		['hosts', 'Host'],
		['services', 'Service'],
	] as const) {
		const opt = document.createElement('option');
		opt.value = value;
		opt.textContent = label;
		reportTypeSelect.appendChild(opt);
	}
	reportTypeLabel.appendChild(reportTypeSelect);
	form.appendChild(reportTypeLabel);
	form.appendChild(document.createElement('br'));

	// --- Host picker ---
	const hostLabel = document.createElement('label');
	hostLabel.textContent = 'Host: ';
	const hostInput = document.createElement('input');
	hostInput.type = 'text';
	hostInput.setAttribute('list', 'trendsHostList');
	hostInput.required = true;
	const hostDatalist = document.createElement('datalist');
	hostDatalist.id = 'trendsHostList';
	hostLabel.appendChild(hostInput);
	hostLabel.appendChild(hostDatalist);
	form.appendChild(hostLabel);
	form.appendChild(document.createElement('br'));

	// --- Service picker (hosts-only report type hides this) ---
	const serviceLabel = document.createElement('label');
	serviceLabel.textContent = 'Service: ';
	const serviceInput = document.createElement('input');
	serviceInput.type = 'text';
	serviceInput.setAttribute('list', 'trendsServiceList');
	const serviceDatalist = document.createElement('datalist');
	serviceDatalist.id = 'trendsServiceList';
	serviceLabel.appendChild(serviceInput);
	serviceLabel.appendChild(serviceDatalist);
	form.appendChild(serviceLabel);
	form.appendChild(document.createElement('br'));

	function updateServiceVisibility(): void {
		serviceLabel.style.display = reportTypeSelect.value === 'services' ? '' : 'none';
		serviceInput.required = reportTypeSelect.value === 'services';
	}
	reportTypeSelect.addEventListener('change', updateServiceVisibility);
	updateServiceVisibility();

	function updateServiceDatalist(): void {
		serviceDatalist.innerHTML = '';
		const host = hostInput.value;
		const matches = host ? services.filter((s) => s.hostName === host) : services;
		for (const s of matches.slice(0, 500)) {
			const opt = document.createElement('option');
			opt.value = s.description;
			serviceDatalist.appendChild(opt);
		}
	}
	hostInput.addEventListener('input', updateServiceDatalist);

	// --- Time range ---
	const timeRangeLabel = document.createElement('label');
	timeRangeLabel.textContent = 'Time Range: ';
	const timeRangeSelect = document.createElement('select');
	for (const preset of TIME_PRESETS) {
		const opt = document.createElement('option');
		opt.value = preset.label;
		opt.textContent = preset.label;
		timeRangeSelect.appendChild(opt);
	}
	const customOpt = document.createElement('option');
	customOpt.value = CUSTOM_PRESET_LABEL;
	customOpt.textContent = CUSTOM_PRESET_LABEL;
	timeRangeSelect.appendChild(customOpt);
	timeRangeSelect.value = 'Last 24 Hours';
	timeRangeLabel.appendChild(timeRangeSelect);
	form.appendChild(timeRangeLabel);
	form.appendChild(document.createElement('br'));

	const customRangeDiv = document.createElement('div');
	customRangeDiv.style.display = 'none';
	const startInput = document.createElement('input');
	startInput.type = 'datetime-local';
	const endInput = document.createElement('input');
	endInput.type = 'datetime-local';
	{
		const now = Math.floor(Date.now() / 1000);
		startInput.value = datetimeLocalValue(now - 24 * 3600);
		endInput.value = datetimeLocalValue(now);
	}
	customRangeDiv.appendChild(document.createTextNode('Start: '));
	customRangeDiv.appendChild(startInput);
	customRangeDiv.appendChild(document.createTextNode(' End: '));
	customRangeDiv.appendChild(endInput);
	form.appendChild(customRangeDiv);

	timeRangeSelect.addEventListener('change', () => {
		customRangeDiv.style.display = timeRangeSelect.value === CUSTOM_PRESET_LABEL ? '' : 'none';
	});

	function currentTimeRange(): [number, number] {
		if (timeRangeSelect.value === CUSTOM_PRESET_LABEL) {
			const now = Math.floor(Date.now() / 1000);
			const start = parseDatetimeLocal(startInput.value) ?? now - 24 * 3600;
			const end = parseDatetimeLocal(endInput.value) ?? now;
			return [start, end];
		}
		const preset = TIME_PRESETS.find((p) => p.label === timeRangeSelect.value);
		return preset ? preset.range() : [Math.floor(Date.now() / 1000) - 24 * 3600, Math.floor(Date.now() / 1000)];
	}

	// --- Soft states / backtrack ---
	const softStatesLabel = document.createElement('label');
	const softStatesCheckbox = document.createElement('input');
	softStatesCheckbox.type = 'checkbox';
	softStatesLabel.appendChild(softStatesCheckbox);
	softStatesLabel.appendChild(document.createTextNode(' Include soft states'));
	form.appendChild(softStatesLabel);
	form.appendChild(document.createElement('br'));

	const backtrackLabel = document.createElement('label');
	backtrackLabel.textContent = 'Backtracked archives: ';
	const backtrackInput = document.createElement('input');
	backtrackInput.type = 'number';
	backtrackInput.min = '0';
	backtrackInput.value = '4';
	backtrackInput.style.width = '4em';
	backtrackLabel.appendChild(backtrackInput);
	form.appendChild(backtrackLabel);
	form.appendChild(document.createElement('br'));

	const submitButton = document.createElement('button');
	submitButton.type = 'submit';
	submitButton.textContent = 'Generate Trends';
	form.appendChild(submitButton);

	const pngLink = document.createElement('a');
	pngLink.textContent = 'PNG image (for export/printing)';
	pngLink.style.marginLeft = '1em';
	pngLink.style.display = 'none';
	form.appendChild(pngLink);

	container.appendChild(form);

	const statusEl = document.createElement('p');
	container.appendChild(statusEl);

	const legendEl = document.createElement('div');
	legendEl.className = 'trendsLegend';
	container.appendChild(legendEl);

	const timelineEl = document.createElement('div');
	container.appendChild(timelineEl);

	const availabilityHeading = document.createElement('h3');
	availabilityHeading.textContent = 'Availability Breakdown';
	availabilityHeading.style.display = 'none';
	container.appendChild(availabilityHeading);

	const availabilityEl = document.createElement('div');
	container.appendChild(availabilityEl);

	async function generate(): Promise<void> {
		const reportType = reportTypeSelect.value as TrendsReportType;
		const host = hostInput.value.trim();
		const service = serviceInput.value.trim();
		const [startTime, endTime] = currentTimeRange();
		const includeSoftStates = softStatesCheckbox.checked;
		const backtrackedArchives = Math.max(0, parseInt(backtrackInput.value, 10) || 0);

		if (!host || (reportType === 'services' && !service)) {
			statusEl.textContent = reportType === 'services' ? 'Host and service are required.' : 'Host is required.';
			return;
		}
		if (endTime <= startTime) {
			statusEl.textContent = 'End time must be after start time.';
			return;
		}

		statusEl.textContent = 'Loading trends…';
		timelineEl.innerHTML = '';
		availabilityEl.innerHTML = '';
		availabilityHeading.style.display = 'none';
		pngLink.style.display = 'none';

		const scParams = { reportType, host, service, startTime, endTime, includeSoftStates, backtrackedArchives };

		try {
			const [stateChanges, availability] = await Promise.all([
				fetchStateChangeList(scParams),
				fetchAvailability({ reportType, host, service, startTime, endTime, includeSoftStates }),
			]);
			if (stopped) return;

			renderLegend(legendEl, reportType);
			renderTimeline(timelineEl, reportType, startTime, endTime, stateChanges.statechangelist ?? []);

			availabilityHeading.style.display = '';
			renderAvailability(availabilityEl, reportType, reportType === 'hosts' ? availability.host : availability.service);

			pngLink.href = trendsPngUrl(scParams);
			pngLink.style.display = '';

			statusEl.textContent = `Showing ${formatTimestamp(startTime)} → ${formatTimestamp(endTime)}.`;
		} catch (err) {
			if (stopped) return;
			statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		void generate();
	});

	async function loadPickerData(): Promise<void> {
		try {
			[hostNames, services] = await Promise.all([fetchHostNames(), fetchServices()]);
			if (stopped) return;
			hostDatalist.innerHTML = '';
			for (const name of hostNames.slice(0, 2000)) {
				const opt = document.createElement('option');
				opt.value = name;
				hostDatalist.appendChild(opt);
			}
			updateServiceDatalist();
			statusEl.textContent = 'Pick a host (and service, for a service report) and generate.';
		} catch (err) {
			if (stopped) return;
			statusEl.textContent = `Error loading host/service list: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	void loadPickerData();

	return () => {
		stopped = true;
	};
}
