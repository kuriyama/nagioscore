import { fetchProgramStatus, fetchHostNames, fetchServices, extinfoHostUrl, extinfoServiceUrl, type ServiceEntry } from './api';
import { buildMatcher } from './search';

async function renderCoreStatus(el: HTMLElement): Promise<void> {
	const setStatus = (image: string, text: string) => {
		el.innerHTML = '';
		const img = document.createElement('img');
		img.src = `images/${image}.gif`;
		el.appendChild(img);
		el.appendChild(document.createTextNode(' ' + text));
	};

	setStatus('passiveonly', 'Checking process status...');

	const status = await fetchProgramStatus();
	if (status && status.nagios_pid) {
		const daemon = status.daemon_mode ? 'Daemon' : 'Process';
		setStatus('enabled', `${daemon} running with PID ${status.nagios_pid}`);
	} else {
		setStatus('disabled', 'Not running');
	}
}

interface SearchResultsElements {
	hostsEl: HTMLElement;
	servicesEl: HTMLElement;
	statusEl: HTMLElement;
}

function renderHostResults(el: HTMLElement, hosts: string[]): void {
	el.innerHTML = '';
	if (hosts.length === 0) {
		return;
	}
	const heading = document.createElement('h3');
	heading.textContent = `Hosts (${hosts.length})`;
	el.appendChild(heading);
	const ul = document.createElement('ul');
	for (const host of hosts) {
		const li = document.createElement('li');
		const a = document.createElement('a');
		a.href = extinfoHostUrl(host);
		a.textContent = host;
		li.appendChild(a);
		ul.appendChild(li);
	}
	el.appendChild(ul);
}

function renderServiceResults(el: HTMLElement, services: ServiceEntry[]): void {
	el.innerHTML = '';
	if (services.length === 0) {
		return;
	}
	const heading = document.createElement('h3');
	heading.textContent = `Services (${services.length})`;
	el.appendChild(heading);
	const ul = document.createElement('ul');
	for (const service of services) {
		const li = document.createElement('li');
		const a = document.createElement('a');
		a.href = extinfoServiceUrl(service.hostName, service.description);
		a.textContent = `${service.description} `;
		li.appendChild(a);
		const hostLabel = document.createElement('span');
		hostLabel.className = 'searchResultHost';
		hostLabel.textContent = `(${service.hostName})`;
		li.appendChild(hostLabel);
		ul.appendChild(li);
	}
	el.appendChild(ul);
}

function setupSearch(root: HTMLElement, results: SearchResultsElements): void {
	const form = root.querySelector<HTMLFormElement>('form')!;
	const input = root.querySelector<HTMLInputElement>('input[type=search]')!;

	let hostNames: string[] | null = null;
	let services: ServiceEntry[] | null = null;
	let loadError: string | null = null;

	async function ensureLoaded(): Promise<void> {
		if (hostNames !== null && services !== null) {
			return;
		}
		try {
			[hostNames, services] = await Promise.all([fetchHostNames(), fetchServices()]);
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	}

	async function runSearch(): Promise<void> {
		const query = input.value;
		if (query.trim() === '') {
			results.hostsEl.innerHTML = '';
			results.servicesEl.innerHTML = '';
			results.statusEl.textContent = '';
			return;
		}

		results.statusEl.textContent = 'Searching...';
		await ensureLoaded();

		if (loadError) {
			results.statusEl.textContent = `Search unavailable: ${loadError}`;
			return;
		}

		const matches = buildMatcher(query);
		const matchedHosts = (hostNames ?? []).filter(matches);
		const matchedServices = (services ?? []).filter(
			(service) => matches(service.description) || matches(service.hostName),
		);

		renderHostResults(results.hostsEl, matchedHosts);
		renderServiceResults(results.servicesEl, matchedServices);

		if (matchedHosts.length === 0 && matchedServices.length === 0) {
			results.statusEl.textContent = 'No matches.';
		} else {
			results.statusEl.textContent = '';
		}
	}

	form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		void runSearch();
	});

	let debounceHandle: number | undefined;
	input.addEventListener('input', () => {
		window.clearTimeout(debounceHandle);
		debounceHandle = window.setTimeout(() => void runSearch(), 200);
	});
}

export function renderDashboard(container: HTMLElement): void {
	container.innerHTML = `
		<div id="mainbrandsplash">
			<div id="mainlogo"><a href="https://www.nagios.org/" target="_blank" rel="noopener"><img src="images/logofullsize.png" border="0" alt="Nagios" title="Nagios"></a></div>
			<div><span id="core-status"></span></div>
		</div>

		<div id="currentversioninfo">
			<div class="product">Nagios<sup><span style="font-size: small;">&reg;</span></sup> Core<sup><span style="font-size: small;">&trade;</span></sup></div>
			<div class="version">Version 4.4.14</div>
			<div class="releasedate">August 01, 2023</div>
			<div class="checkforupdates"><a href="https://www.nagios.org/checkforupdates/?version=4.4.14&amp;product=nagioscore" target="_blank" rel="noopener">Check for updates</a></div>
		</div>

		<div id="searchbox" class="navbarsearch">
			<form role="search">
				<fieldset>
					<legend>Search hosts &amp; services</legend>
					<input type="search" name="q" size="30" placeholder="e.g. *db* or web1" autocomplete="off">
				</fieldset>
			</form>
			<div id="searchstatus"></div>
			<div id="searchresults">
				<div id="searchresults-hosts"></div>
				<div id="searchresults-services"></div>
			</div>
		</div>

		<div id="splashboxes">
			<div id="splashrow1">
				<div id="splashbox1" class="splashbox-clear">
					<h2>Get Started</h2>
					<ul>
						<li><a href="https://go.nagios.com/nagioscore/startmonitoring" target="_blank" rel="noopener">Start monitoring your infrastructure</a></li>
						<li><a href="https://go.nagios.com/nagioscore/changelook" target="_blank" rel="noopener">Change the look and feel of Nagios</a></li>
						<li><a href="https://go.nagios.com/nagioscore/extend" target="_blank" rel="noopener">Extend Nagios with hundreds of addons</a></li>
						<li><a href="https://go.nagios.com/nagioscore/support" target="_blank" rel="noopener">Get support</a></li>
						<li><a href="https://go.nagios.com/nagioscore/training" target="_blank" rel="noopener">Get training</a></li>
						<li><a href="https://go.nagios.com/nagioscore/certification" target="_blank" rel="noopener">Get certified</a></li>
					</ul>
				</div>

				<div id="splashbox2" class="splashbox">
					<h2>Quick Links</h2>
					<ul>
						<li><a href="https://library.nagios.com" target="_blank" rel="noopener">Nagios Library</a> (tutorials and docs)</li>
						<li><a href="https://labs.nagios.com" target="_blank" rel="noopener">Nagios Labs</a> (development blog)</li>
						<li><a href="https://exchange.nagios.org" target="_blank" rel="noopener">Nagios Exchange</a> (plugins and addons)</li>
						<li><a href="https://support.nagios.com" target="_blank" rel="noopener">Nagios Support</a> (tech support)</li>
						<li><a href="https://www.nagios.com" target="_blank" rel="noopener">Nagios.com</a> (company)</li>
						<li><a href="https://www.nagios.org" target="_blank" rel="noopener">Nagios.org</a> (project)</li>
					</ul>
				</div>
			</div>
		</div>

		<div id="mainfooter">
			<div id="maincopy">
				Copyright &copy; 2010-2023 Nagios Core Development Team and Community Contributors. Copyright &copy; 1999-2009 Ethan Galstad. See the THANKS file for more information on contributors.
			</div>
			<div class="disclaimer">
				Nagios Core is licensed under the GNU General Public License and is provided AS IS with NO WARRANTY OF ANY KIND, INCLUDING THE WARRANTY OF DESIGN, MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE. Nagios, Nagios Core and the Nagios logo are trademarks, servicemarks, registered trademarks or registered servicemarks owned by Nagios Enterprises, LLC. Use of the Nagios marks is governed by the <a href="https://www.nagios.com/legal/trademarks/">trademark use restrictions</a>.
			</div>
			<div class="logos">
				<a href="https://www.nagios.org/" target="_blank" rel="noopener"><img src="images/weblogo1.png" width="102" height="47" border="0" style="padding: 0 40px 0 40px;" title="Nagios.org"></a>
				<a href="http://sourceforge.net/projects/nagios" target="_blank" rel="noopener"><img src="images/sflogo.png" width="88" height="31" border="0" alt="SourceForge.net Logo"></a>
			</div>
		</div>
	`;

	const coreStatusEl = container.querySelector<HTMLElement>('#core-status')!;
	void renderCoreStatus(coreStatusEl);

	setupSearch(container.querySelector<HTMLElement>('#searchbox')!, {
		hostsEl: container.querySelector<HTMLElement>('#searchresults-hosts')!,
		servicesEl: container.querySelector<HTMLElement>('#searchresults-services')!,
		statusEl: container.querySelector<HTMLElement>('#searchstatus')!,
	});
}
