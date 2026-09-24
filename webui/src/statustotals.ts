/**
 * Port of cgi/status.c's show_host_status_totals()/show_service_status_totals()
 * -- the "Host Status Totals"/"Service Status Totals" boxes shown above every
 * status.cgi view. Reuses html/stylesheets/status.css's existing hostTotals
 * and serviceTotals classes (already loaded by index.html.in), so no new CSS
 * is needed.
 *
 * Not ported: each legacy count is a link that re-queries status.cgi with a
 * specific hoststatustypes/servicestatustypes bitmask. This SPA's filter
 * model (ProblemFilterMode) is coarser than that per-status bitmask, so
 * there's no exact route to link each individual count to -- these are
 * display-only here.
 */

export interface TotalsColumn {
	label: string;
	count: number;
	/** CSS class suffix (e.g. "UP"/"DOWN" for hostTotals) applied when count > 0. */
	classSuffix: string;
}

export function renderStatusTotals(
	kind: 'host' | 'service',
	title: string,
	columns: TotalsColumn[],
	problemCount: number,
	totalCount: number,
): HTMLElement {
	const base = kind === 'host' ? 'hostTotals' : 'serviceTotals';

	const wrapper = document.createElement('div');
	wrapper.className = 'statusTotalsPanel';

	const heading = document.createElement('div');
	heading.className = base;
	heading.textContent = title;
	wrapper.appendChild(heading);

	const countsTable = document.createElement('table');
	countsTable.className = base;
	const headRow = document.createElement('tr');
	const countRow = document.createElement('tr');
	for (const col of columns) {
		const th = document.createElement('th');
		th.className = base;
		th.textContent = col.label;
		headRow.appendChild(th);

		const td = document.createElement('td');
		td.className = col.count > 0 ? `${base}${col.classSuffix}` : base;
		td.textContent = String(col.count);
		countRow.appendChild(td);
	}
	countsTable.appendChild(headRow);
	countsTable.appendChild(countRow);
	wrapper.appendChild(countsTable);

	const summaryTable = document.createElement('table');
	summaryTable.className = base;
	const summaryHeadRow = document.createElement('tr');
	const summaryCountRow = document.createElement('tr');

	const problemsTh = document.createElement('th');
	problemsTh.className = base;
	problemsTh.textContent = 'All Problems';
	const typesTh = document.createElement('th');
	typesTh.className = base;
	typesTh.textContent = 'All Types';
	summaryHeadRow.appendChild(problemsTh);
	summaryHeadRow.appendChild(typesTh);

	const problemsTd = document.createElement('td');
	problemsTd.className = problemCount > 0 ? `${base}PROBLEMS` : base;
	problemsTd.textContent = String(problemCount);
	const typesTd = document.createElement('td');
	typesTd.className = base;
	typesTd.textContent = String(totalCount);
	summaryCountRow.appendChild(problemsTd);
	summaryCountRow.appendChild(typesTd);

	summaryTable.appendChild(summaryHeadRow);
	summaryTable.appendChild(summaryCountRow);
	wrapper.appendChild(summaryTable);

	return wrapper;
}
