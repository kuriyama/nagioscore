/**
 * Shared paging + instant text filter for hosts.ts/services.ts's detail
 * tables (trial).
 *
 * Why: rendering every row was what made those views heavy in the
 * browser, not the fetched data -- measured at 4,000 hosts/40,000
 * services, Services held ~710,000 DOM nodes (~1.1GB more renderer RSS
 * than its Unhandled view) against only ~13MB of JS heap. So the data
 * stays fully fetched (sorting/filtering still see everything) and only
 * one page of rows is ever in the DOM, like cgi/status.c's own
 * result_limit paging (default 100).
 *
 * The text filter stands in for the browser's Ctrl-F, which can no longer
 * see rows that aren't on the current page: Ctrl-F focuses it (pressing
 * Ctrl-F again while it's focused falls through to the browser's own
 * find), "/" focuses it too, Esc clears it, PageUp/PageDown flip pages
 * from inside it. Query, page and page size are mirrored into the URL
 * hash (history.replaceState, which doesn't fire hashchange and so
 * doesn't re-render the route) so a reload or a shared link keeps them.
 */

export const PAGE_SIZES = [100, 250, 1000, 0] as const; // 0 = All
const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_STORAGE_KEY = 'nagios-webui.pageSize';

/** Same ordering as String.prototype.localeCompare with no arguments, much faster when sorting tens of thousands of rows. */
const collator = new Intl.Collator();
export function compareText(a: string, b: string): number {
	return collator.compare(a, b);
}

/** Lower-cased, whitespace-separated terms; every term must match (AND). */
export function parseTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** `haystack` must already be lower-cased (callers cache it per row). */
export function matchesTerms(haystack: string, terms: string[]): boolean {
	for (const t of terms) {
		if (!haystack.includes(t)) return false;
	}
	return true;
}

/** Sets `el`'s text to `text`, wrapping every occurrence of any term in <mark>. */
export function setHighlightedText(el: HTMLElement, text: string, terms: string[]): void {
	if (terms.length === 0 || text === '') {
		el.textContent = text;
		return;
	}
	const lower = text.toLowerCase();
	// Mark covered character ranges first so overlapping terms merge.
	const covered = new Uint8Array(text.length);
	let any = false;
	for (const t of terms) {
		for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
			covered.fill(1, i, i + t.length);
			any = true;
		}
	}
	if (!any) {
		el.textContent = text;
		return;
	}
	el.textContent = '';
	let start = 0;
	while (start < text.length) {
		const on = covered[start];
		let end = start + 1;
		while (end < text.length && covered[end] === on) end++;
		const chunk = text.slice(start, end);
		if (on) {
			const mark = document.createElement('mark');
			mark.textContent = chunk;
			el.appendChild(mark);
		} else {
			el.appendChild(document.createTextNode(chunk));
		}
		start = end;
	}
}

function loadPageSize(): number {
	try {
		const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
		if (raw !== null && (PAGE_SIZES as readonly number[]).includes(Number(raw))) return Number(raw);
	} catch {
		// storage blocked -- fall through to the default
	}
	return DEFAULT_PAGE_SIZE;
}

function savePageSize(size: number): void {
	try {
		window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
	} catch {
		// not essential
	}
}

function hashParams(): URLSearchParams {
	const hash = window.location.hash.replace(/^#/, '');
	const q = hash.indexOf('?');
	return new URLSearchParams(q === -1 ? '' : hash.slice(q + 1));
}

function writeHashParams(params: URLSearchParams): void {
	const hash = window.location.hash.replace(/^#/, '');
	const q = hash.indexOf('?');
	const route = q === -1 ? hash : hash.slice(0, q);
	const qs = params.toString();
	const url = `${window.location.pathname}${window.location.search}#${route}${qs ? `?${qs}` : ''}`;
	history.replaceState(history.state, '', url);
}

export interface PageSlice<T> {
	items: T[];
	/** 0-based index of items[0] within the full (filtered) list. */
	offset: number;
	total: number;
}

interface PagerParts {
	root: HTMLElement;
	summary: HTMLElement;
	first: HTMLButtonElement;
	prev: HTMLButtonElement;
	pageInput: HTMLInputElement;
	pageCount: HTMLElement;
	next: HTMLButtonElement;
	last: HTMLButtonElement;
	sizeSelect: HTMLSelectElement;
}

export class ListControls {
	/** The filter <input>, for the caller to place (e.g. in its filter bar). */
	readonly input: HTMLInputElement;
	/** Pagers to place above and below the table. */
	readonly topPager: HTMLElement;
	readonly bottomPager: HTMLElement;

	private query: string;
	private page: number;
	private pageSize: number;
	private lastPageCount = 1;
	private readonly pagers: PagerParts[] = [];
	private readonly noun: string;
	private readonly onChange: () => void;
	private readonly onKeydown: (ev: KeyboardEvent) => void;

	constructor(noun: string, onChange: () => void) {
		this.noun = noun;
		this.onChange = onChange;

		const params = hashParams();
		this.query = params.get('q') ?? '';
		this.page = Math.max(0, (Number(params.get('page')) || 1) - 1);
		const sizeParam = Number(params.get('size'));
		this.pageSize = params.get('size') !== null && (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : loadPageSize();

		this.input = document.createElement('input');
		this.input.type = 'search';
		this.input.className = 'listFilter';
		this.input.placeholder = `Filter ${noun}... (Ctrl-F, /)`;
		this.input.value = this.query;
		this.input.spellcheck = false;
		this.input.autocomplete = 'off';
		this.input.addEventListener('input', () => {
			this.query = this.input.value;
			this.page = 0;
			this.changed();
		});
		this.input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				if (this.input.value !== '') {
					this.input.value = '';
					this.query = '';
					this.page = 0;
					this.changed();
				} else {
					this.input.blur();
				}
			} else if (ev.key === 'PageDown') {
				ev.preventDefault();
				this.goTo(this.page + 1);
			} else if (ev.key === 'PageUp') {
				ev.preventDefault();
				this.goTo(this.page - 1);
			}
		});

		this.topPager = this.buildPager();
		this.bottomPager = this.buildPager();

		this.onKeydown = (ev: KeyboardEvent) => {
			// Leave every key alone while a modal dialog (modal.ts) is up.
			if (document.querySelector('.modalOverlay')) return;
			const isFindKey = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'f';
			if (isFindKey) {
				// Second press while already in the filter = the browser's own find.
				if (document.activeElement === this.input) return;
				ev.preventDefault();
				this.focus();
				return;
			}
			if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isEditable(ev.target)) {
				ev.preventDefault();
				this.focus();
			}
		};
		document.addEventListener('keydown', this.onKeydown);
	}

	/** Call from the view's cleanup function. */
	destroy(): void {
		document.removeEventListener('keydown', this.onKeydown);
	}

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	/** For changes that reorder or re-scope the whole list (sort, group, Show:). */
	resetPage(): void {
		this.page = 0;
	}

	terms(): string[] {
		return parseTerms(this.query);
	}

	/**
	 * Returns the current page of `items` (already filtered and sorted by
	 * the caller) and updates both pagers. Clamps the page if `items` got
	 * shorter (e.g. after an auto-refresh), keeping the user on the last
	 * page instead of showing an empty one.
	 */
	slice<T>(items: T[]): PageSlice<T> {
		const total = items.length;
		const size = this.pageSize === 0 ? Math.max(total, 1) : this.pageSize;
		this.lastPageCount = Math.max(1, Math.ceil(total / size));
		if (this.page > this.lastPageCount - 1) this.page = this.lastPageCount - 1;
		const offset = this.page * size;
		const slice = items.slice(offset, offset + size);
		this.updatePagers(offset, slice.length, total);
		this.syncHash();
		return { items: slice, offset, total };
	}

	private goTo(page: number, fromPager = false): void {
		const clamped = Math.min(Math.max(0, page), this.lastPageCount - 1);
		if (clamped === this.page) {
			// e.g. an out-of-range number typed into the page box
			for (const p of this.pagers) p.pageInput.value = String(this.page + 1);
			return;
		}
		this.page = clamped;
		this.changed();
		// Paging from the bottom pager would otherwise leave the user
		// looking at the end of the new page.
		if (fromPager) this.topPager.scrollIntoView({ block: 'nearest' });
	}

	private changed(): void {
		this.onChange();
	}

	private syncHash(): void {
		const params = hashParams();
		if (this.query) params.set('q', this.query);
		else params.delete('q');
		if (this.page > 0) params.set('page', String(this.page + 1));
		else params.delete('page');
		// Only carry size in the URL when it differs from this browser's
		// own remembered preference, so ordinary links stay short.
		if (this.pageSize !== loadPageSize()) params.set('size', String(this.pageSize));
		else params.delete('size');
		writeHashParams(params);
	}

	private buildPager(): HTMLElement {
		const root = document.createElement('div');
		root.className = 'listPager';

		const summary = document.createElement('span');
		summary.className = 'listPagerSummary';
		root.appendChild(summary);

		const nav = document.createElement('span');
		nav.className = 'listPagerNav';
		const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = label;
			b.title = title;
			b.addEventListener('click', onClick);
			nav.appendChild(b);
			return b;
		};
		const first = button('«', 'First page', () => this.goTo(0, true));
		const prev = button('‹', 'Previous page (PageUp in the filter)', () => this.goTo(this.page - 1, true));

		const pageLabel = document.createElement('span');
		pageLabel.textContent = ' Page ';
		nav.appendChild(pageLabel);
		const pageInput = document.createElement('input');
		pageInput.type = 'number';
		pageInput.min = '1';
		pageInput.className = 'listPagerPage';
		pageInput.addEventListener('change', () => this.goTo((Number(pageInput.value) || 1) - 1, true));
		nav.appendChild(pageInput);
		const pageCount = document.createElement('span');
		nav.appendChild(pageCount);

		const next = button('›', 'Next page (PageDown in the filter)', () => this.goTo(this.page + 1, true));
		const last = button('»', 'Last page', () => this.goTo(this.lastPageCount - 1, true));
		root.appendChild(nav);

		const sizeLabel = document.createElement('label');
		sizeLabel.className = 'listPagerSize';
		sizeLabel.textContent = 'Show ';
		const sizeSelect = document.createElement('select');
		for (const size of PAGE_SIZES) {
			const option = document.createElement('option');
			option.value = String(size);
			option.textContent = size === 0 ? 'All' : String(size);
			sizeSelect.appendChild(option);
		}
		sizeSelect.addEventListener('change', () => {
			const size = Number(sizeSelect.value);
			// Keep the first row currently shown on screen in view.
			const firstRow = this.page * (this.pageSize || 0);
			this.pageSize = size;
			savePageSize(size);
			this.page = size === 0 ? 0 : Math.floor(firstRow / size);
			this.changed();
		});
		sizeLabel.appendChild(sizeSelect);
		sizeLabel.appendChild(document.createTextNode(' per page'));
		root.appendChild(sizeLabel);

		this.pagers.push({ root, summary, first, prev, pageInput, pageCount, next, last, sizeSelect });
		return root;
	}

	private updatePagers(offset: number, shown: number, total: number): void {
		const summaryText =
			total === 0 ? `No matching ${this.noun}` : `Results ${offset + 1} - ${offset + shown} of ${total} Matching ${capitalize(this.noun)}`;
		for (const p of this.pagers) {
			p.summary.textContent = summaryText;
			p.pageInput.value = String(this.page + 1);
			p.pageInput.max = String(this.lastPageCount);
			p.pageCount.textContent = ` of ${this.lastPageCount} `;
			p.first.disabled = p.prev.disabled = this.page === 0;
			p.next.disabled = p.last.disabled = this.page >= this.lastPageCount - 1;
			p.sizeSelect.value = String(this.pageSize);
			// A single page has nothing to navigate; keep the summary.
			(p.root.querySelector('.listPagerNav') as HTMLElement).style.visibility = this.lastPageCount > 1 ? 'visible' : 'hidden';
		}
	}
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
