import { renderNav } from './nav';
import { renderDashboard } from './dashboard';
import { renderHosts } from './hosts';
import { renderServices } from './services';
import { installDebugHelper, logRouteSnapshot } from './debug';
import { renderTrends } from './trends';

let activeViewCleanup: (() => void) | null = null;

function renderRoute(dashboardEl: HTMLElement): void {
	if (activeViewCleanup) {
		activeViewCleanup();
		activeViewCleanup = null;
	}

	const start = performance.now();
	if (window.location.hash === '#hosts') {
		activeViewCleanup = renderHosts(dashboardEl);
	} else if (window.location.hash === '#services') {
		activeViewCleanup = renderServices(dashboardEl);
	} else if (window.location.hash === '#trends') {
		activeViewCleanup = renderTrends(dashboardEl);
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
