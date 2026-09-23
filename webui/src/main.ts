import { renderNav } from './nav';
import { renderDashboard } from './dashboard';
import { renderHosts } from './hosts';
import { renderServices } from './services';
import { renderComments } from './comments';
import { renderDowntime } from './downtime';
import { renderProcessInfo } from './processinfo';
import { renderNotifications } from './notifications';
import { installDebugHelper, logRouteSnapshot } from './debug';
import { renderTrends } from './trends';
import { type ProblemFilterMode } from './api';

let activeViewCleanup: (() => void) | null = null;

/**
 * Routes are "#name" optionally followed by "?query" (e.g.
 * "#services?filter=unhandled") -- used by nav.ts's "Hosts (Unhandled)"/
 * "Services (Unhandled)" links to pick an initial filter without a whole
 * separate route per filter combination.
 */
function parseHash(): { route: string; params: URLSearchParams } {
	const hash = window.location.hash.replace(/^#/, '');
	const qIndex = hash.indexOf('?');
	if (qIndex === -1) {
		return { route: hash, params: new URLSearchParams() };
	}
	return { route: hash.slice(0, qIndex), params: new URLSearchParams(hash.slice(qIndex + 1)) };
}

function parseFilterParam(params: URLSearchParams): ProblemFilterMode {
	const value = params.get('filter');
	return value === 'problems' || value === 'unhandled' ? value : 'all';
}

function renderRoute(dashboardEl: HTMLElement): void {
	if (activeViewCleanup) {
		activeViewCleanup();
		activeViewCleanup = null;
	}

	const start = performance.now();
	const { route, params } = parseHash();
	if (route === 'hosts') {
		activeViewCleanup = renderHosts(dashboardEl, parseFilterParam(params));
	} else if (route === 'services') {
		activeViewCleanup = renderServices(dashboardEl, parseFilterParam(params));
	} else if (route === 'trends') {
		activeViewCleanup = renderTrends(dashboardEl);
	} else if (route === 'comments') {
		activeViewCleanup = renderComments(dashboardEl);
	} else if (route === 'downtime') {
		activeViewCleanup = renderDowntime(dashboardEl);
	} else if (route === 'processinfo') {
		activeViewCleanup = renderProcessInfo(dashboardEl);
	} else if (route === 'notifications') {
		activeViewCleanup = renderNotifications(dashboardEl);
	} else {
		renderDashboard(dashboardEl);
	}
	logRouteSnapshot(performance.now() - start);
}

function main(): void {
	installDebugHelper();

	// The server name isn't known until request time, so it can't be baked
	// in at build time the way cgiUrl below is.
	document.title = `Nagios: ${window.location.hostname}`;

	const cgiUrl = window.NAGIOS_CGI_URL ?? '';

	const navEl = document.getElementById('nav');
	if (navEl) {
		renderNav(navEl, cgiUrl);
	}

	const dashboardEl = document.getElementById('dashboard');
	if (dashboardEl) {
		renderRoute(dashboardEl);
		window.addEventListener('hashchange', () => renderRoute(dashboardEl));
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', main);
} else {
	main();
}
