import { renderNav } from './nav';
import { renderDashboard } from './dashboard';

function main(): void {
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
		renderDashboard(dashboardEl);
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', main);
} else {
	main();
}
