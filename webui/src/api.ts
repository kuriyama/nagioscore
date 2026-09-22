/**
 * Thin typed client for the existing statusjson.cgi/objectjson.cgi JSON API.
 * Response envelope shape confirmed against cgi/jsonutils.c, cgi/objectjson.c,
 * cgi/statusjson.c (see include/jsonutils.h for the RESULT_* codes).
 */

const RESULT_SUCCESS = 0;

declare global {
	interface Window {
		NAGIOS_CGI_URL?: string;
	}
}

interface NagiosResult {
	type_code: number;
	type_text: string;
	message: string;
}

interface NagiosResponse<T> {
	format_version: number;
	result: NagiosResult;
	data: T;
}

function cgiUrl(cgiName: string): string {
	const base = window.NAGIOS_CGI_URL ?? '';
	return `${base}/${cgiName}`;
}

async function fetchJson<T>(cgiName: string, params: Record<string, string>): Promise<T> {
	const url = new URL(cgiUrl(cgiName), window.location.href);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	const res = await fetch(url.toString(), { credentials: 'same-origin' });
	if (!res.ok) {
		throw new Error(`${cgiName} request failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as NagiosResponse<T>;
	if (body.result.type_code !== RESULT_SUCCESS) {
		throw new Error(`${cgiName} error: ${body.result.message || body.result.type_text}`);
	}
	return body.data;
}

/** objectjson.cgi?query=hostlist (no `details` param -> plain array of host names) */
interface HostListData {
	hostlist: string[];
}

export async function fetchHostNames(): Promise<string[]> {
	const data = await fetchJson<HostListData>('objectjson.cgi', { query: 'hostlist' });
	return data.hostlist ?? [];
}

export interface ServiceEntry {
	hostName: string;
	description: string;
}

/** objectjson.cgi?query=servicelist (no `details` param -> { hostName: [description, ...] }) */
interface ServiceListData {
	servicelist: Record<string, string[]>;
}

export async function fetchServices(): Promise<ServiceEntry[]> {
	const data = await fetchJson<ServiceListData>('objectjson.cgi', { query: 'servicelist' });
	const out: ServiceEntry[] = [];
	for (const [hostName, descriptions] of Object.entries(data.servicelist ?? {})) {
		for (const description of descriptions) {
			out.push({ hostName, description });
		}
	}
	return out;
}

export interface ProgramStatus {
	nagios_pid: number;
	daemon_mode: boolean;
}

interface ProgramStatusData {
	programstatus: ProgramStatus;
}

export async function fetchProgramStatus(): Promise<ProgramStatus | null> {
	try {
		const data = await fetchJson<ProgramStatusData>('statusjson.cgi', { query: 'programstatus' });
		return data.programstatus ?? null;
	} catch {
		return null;
	}
}

export function extinfoHostUrl(hostName: string): string {
	const url = new URL(cgiUrl('extinfo.cgi'), window.location.href);
	url.searchParams.set('type', '1');
	url.searchParams.set('host', hostName);
	return url.toString();
}

export function extinfoServiceUrl(hostName: string, description: string): string {
	const url = new URL(cgiUrl('extinfo.cgi'), window.location.href);
	url.searchParams.set('type', '2');
	url.searchParams.set('host', hostName);
	url.searchParams.set('service', description);
	return url.toString();
}
