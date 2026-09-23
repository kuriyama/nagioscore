/**
 * Data-driven port of the link structure from html/side.html.in.
 * The old Quick Search form that lived in the "Current Status" section is
 * intentionally NOT reproduced here -- it's replaced by the unified
 * host+service search in dashboard.ts.
 */

export interface NavLink {
	label: string;
	href: string;
	external?: boolean;
	/** A second, "(Legacy)" link shown next to this one. */
	legacyHref?: string;
	children?: NavLink[];
}

export interface NavSection {
	title: string;
	links: NavLink[];
	/** Extra freeform links shown below the main list, e.g. "Problems". */
	extraTitle?: string;
	extraLinks?: NavLink[];
}

export function buildNavSections(cgiUrl: string): NavSection[] {
	return [
		{
			title: 'General',
			links: [
				{ label: 'Home', href: '#' },
				{ label: 'Documentation', href: 'https://go.nagios.com/nagioscore/docs', external: true },
			],
		},
		{
			title: 'Current Status',
			links: [
				{ label: 'Tactical Overview', href: `${cgiUrl}/tac.cgi` },
				{ label: 'Map', href: `${cgiUrl}/statusmap.cgi?host=all` },
				{ label: 'Hosts', href: '#hosts' },
				{ label: 'Services', href: '#services' },
				{
					label: 'Host Groups',
					href: `${cgiUrl}/status.cgi?hostgroup=all&style=overview`,
					children: [
						{ label: 'Summary', href: `${cgiUrl}/status.cgi?hostgroup=all&style=summary` },
						{ label: 'Grid', href: `${cgiUrl}/status.cgi?hostgroup=all&style=grid` },
					],
				},
				{
					label: 'Service Groups',
					href: `${cgiUrl}/status.cgi?servicegroup=all&style=overview`,
					children: [
						{ label: 'Summary', href: `${cgiUrl}/status.cgi?servicegroup=all&style=summary` },
						{ label: 'Grid', href: `${cgiUrl}/status.cgi?servicegroup=all&style=grid` },
					],
				},
			],
			extraTitle: 'Problems',
			extraLinks: [
				{ label: 'Services', href: '#services?filter=problems' },
				{ label: 'Services (Unhandled)', href: '#services?filter=unhandled' },
				{ label: 'Hosts', href: '#hosts?filter=problems' },
				{ label: 'Hosts (Unhandled)', href: '#hosts?filter=unhandled' },
				{ label: 'Network Outages', href: `${cgiUrl}/outages.cgi` },
			],
		},
		{
			title: 'Reports',
			links: [
				{ label: 'Availability', href: `${cgiUrl}/avail.cgi` },
				{ label: 'Trends', href: '#trends', legacyHref: `${cgiUrl}/trends.cgi` },
				{ label: 'Alerts / History', href: `${cgiUrl}/history.cgi?host=all` },
				{ label: 'Alerts / Summary', href: `${cgiUrl}/summary.cgi` },
				{ label: 'Histogram', href: 'histogram.html', legacyHref: `${cgiUrl}/histogram.cgi` },
				{ label: 'Notifications', href: '#notifications' },
				{ label: 'Event Log', href: `${cgiUrl}/showlog.cgi` },
			],
		},
		{
			title: 'System',
			links: [
				{ label: 'Comments', href: '#comments' },
				{ label: 'Downtime', href: '#downtime' },
				{ label: 'Process Info', href: '#processinfo' },
				{ label: 'Performance Info', href: `${cgiUrl}/extinfo.cgi?type=4` },
				{ label: 'Scheduling Queue', href: `${cgiUrl}/extinfo.cgi?type=7` },
				{ label: 'Configuration', href: `${cgiUrl}/config.cgi` },
			],
		},
	];
}

function linkAnchor(link: NavLink): HTMLLIElement {
	const li = document.createElement('li');

	const a = document.createElement('a');
	a.href = link.href;
	if (link.external) {
		a.target = '_blank';
		a.rel = 'noopener';
	}
	a.textContent = link.label;
	li.appendChild(a);

	if (link.legacyHref) {
		li.appendChild(document.createTextNode(' '));
		const legacy = document.createElement('a');
		legacy.href = link.legacyHref;
		legacy.textContent = '(Legacy)';
		li.appendChild(legacy);
	}

	if (link.children && link.children.length > 0) {
		const ul = document.createElement('ul');
		for (const child of link.children) {
			ul.appendChild(linkAnchor(child));
		}
		li.appendChild(ul);
	}

	return li;
}

export function renderNav(container: HTMLElement, cgiUrl: string): void {
	container.innerHTML = '';

	const logo = document.createElement('div');
	logo.className = 'navbarlogo';
	logo.innerHTML = '<a href="https://www.nagios.org" target="_blank" rel="noopener"><img src="images/sblogo.png" height="39" width="140" border="0" alt="Nagios"></a>';
	container.appendChild(logo);

	for (const section of buildNavSections(cgiUrl)) {
		const sectionEl = document.createElement('div');
		sectionEl.className = 'navsection';

		const titleEl = document.createElement('div');
		titleEl.className = 'navsectiontitle';
		titleEl.textContent = section.title;
		sectionEl.appendChild(titleEl);

		const linksEl = document.createElement('div');
		linksEl.className = 'navsectionlinks';
		const ul = document.createElement('ul');
		ul.className = 'navsectionlinks';
		for (const link of section.links) {
			ul.appendChild(linkAnchor(link));
		}
		linksEl.appendChild(ul);
		sectionEl.appendChild(linksEl);

		if (section.extraLinks && section.extraLinks.length > 0) {
			const headerEl = document.createElement('div');
			headerEl.className = 'navsectionheader';
			const outerUl = document.createElement('ul');
			const problemsLi = document.createElement('li');
			problemsLi.appendChild(document.createTextNode(section.extraTitle ?? ''));
			const innerUl = document.createElement('ul');
			for (const link of section.extraLinks) {
				innerUl.appendChild(linkAnchor(link));
			}
			problemsLi.appendChild(innerUl);
			outerUl.appendChild(problemsLi);
			headerEl.appendChild(outerUl);
			sectionEl.appendChild(headerEl);
		}

		container.appendChild(sectionEl);
	}
}
