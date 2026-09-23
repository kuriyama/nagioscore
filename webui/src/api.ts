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
	query_time: number;
	user: string;
	type_code: number;
	type_text: string;
	message: string;
}

interface NagiosResponse<T> {
	format_version: number;
	result: NagiosResult;
	data: T;
}

export function cgiUrl(cgiName: string): string {
	const base = window.NAGIOS_CGI_URL ?? '';
	return `${base}/${cgiName}`;
}

interface FetchResult<T> {
	data: T;
	queryTime: number;
}

// Every successful JSON response carries the authenticated username in
// result.user; cache the most recent one instead of making a dedicated
// request just to find out who's logged in (used by commands.ts to
// pre-fill the acknowledge/downtime comment author field).
let lastKnownUser: string | null = null;

export function getCurrentUser(): string | null {
	return lastKnownUser;
}

async function fetchJsonWithResult<T>(cgiName: string, params: Record<string, string>): Promise<FetchResult<T>> {
	const url = new URL(cgiUrl(cgiName), window.location.href);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	const res = await fetch(url.toString(), { credentials: 'same-origin' });
	if (!res.ok) {
		throw new Error(`${cgiName} request failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as NagiosResponse<T>;
	if (body.result.user) {
		lastKnownUser = body.result.user;
	}
	if (body.result.type_code !== RESULT_SUCCESS) {
		throw new Error(`${cgiName} error: ${body.result.message || body.result.type_text}`);
	}
	return { data: body.data, queryTime: body.result.query_time };
}

async function fetchJson<T>(cgiName: string, params: Record<string, string>): Promise<T> {
	return (await fetchJsonWithResult<T>(cgiName, params)).data;
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

/**
 * statusjson.cgi?query=programstatus (json_status_program in
 * cgi/statusjson.c). Most of json_status_program's fields are emitted
 * unconditionally; the rest of that function's stats (per-check-type
 * min/max/avg latency etc., under a separate `#if 0` block in the C source
 * -- genuinely disabled, not a gap in this port) aren't modeled here.
 */
export interface ProgramStatus {
	nagios_pid: number;
	daemon_mode: boolean;
	version?: string;
	program_start?: number;
	last_log_rotation?: number;
	enable_notifications?: boolean;
	execute_service_checks?: boolean;
	accept_passive_service_checks?: boolean;
	execute_host_checks?: boolean;
	accept_passive_host_checks?: boolean;
	enable_event_handlers?: boolean;
	obsess_over_services?: boolean;
	obsess_over_hosts?: boolean;
	check_service_freshness?: boolean;
	check_host_freshness?: boolean;
	enable_flap_detection?: boolean;
	process_performance_data?: boolean;
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

/** statusjson.cgi's host state enum (not "current_state" -- confirmed via cgi/statusjson.c). */
export type HostStatusValue = 'up' | 'down' | 'unreachable' | 'pending';

export interface HostStatusDetails {
	status: HostStatusValue;
	plugin_output: string;
	last_check: number;
	last_state_change: number;
	notifications_enabled: boolean;
	checks_enabled: boolean;
	accept_passive_checks: boolean;
	is_flapping: boolean;
	scheduled_downtime_depth: number;
	problem_has_been_acknowledged: boolean;
}

interface HostStatusListData {
	hostlist: Record<string, HostStatusDetails>;
}

export interface HostStatusResult {
	queryTime: number;
	hosts: Record<string, HostStatusDetails>;
}

/**
 * formatoptions=enumerate is required here, not optional: cgi/jsonutils.c's
 * json_enumeration() (which "status" goes through) returns the raw integer
 * value, not the "up"/"down"/etc string HostStatusValue assumes, unless
 * this flag is set -- the server's own format_options default is 0 (see
 * cgi/statusjson.c's cgi_data->format_options = 0). Confirmed by
 * reproducing this exact gap against a mock server that mirrors the real
 * default-vs-enumerate behavior: without this parameter, "status" comes
 * back numeric, STATUS_LABEL/STATUS_CLASS lookups in hosts.ts silently miss
 * (blank status column, no color coding), and the "Unhandled Problems"
 * filter (which compares status.status to string literals) never matches
 * anything. This was missing here (though correctly present on every fetch
 * function added later, e.g. fetchComments/fetchStateChangeList) until
 * this fix.
 */
export async function fetchHostStatusDetails(): Promise<HostStatusResult> {
	const { data, queryTime } = await fetchJsonWithResult<HostStatusListData>('statusjson.cgi', {
		query: 'hostlist',
		details: 'true',
		formatoptions: 'enumerate',
	});
	return { queryTime, hosts: data.hostlist ?? {} };
}

export interface HostObjectDetails {
	address?: string;
	notes_url?: string;
	action_url?: string;
	icon_image?: string;
}

interface HostObjectListData {
	hostlist: Record<string, HostObjectDetails>;
}

export async function fetchHostObjectDetails(): Promise<Record<string, HostObjectDetails>> {
	const data = await fetchJson<HostObjectListData>('objectjson.cgi', {
		query: 'hostlist',
		details: 'true',
	});
	return data.hostlist ?? {};
}

/** statusjson.cgi's service state enum (ok/warning/critical/unknown/pending). */
export type ServiceStatusValue = 'ok' | 'warning' | 'unknown' | 'critical' | 'pending';

export interface ServiceStatusDetails {
	status: ServiceStatusValue;
	plugin_output: string;
	last_check: number;
	last_state_change: number;
	notifications_enabled: boolean;
	checks_enabled: boolean;
	accept_passive_checks: boolean;
	is_flapping: boolean;
	scheduled_downtime_depth: number;
	problem_has_been_acknowledged: boolean;
	current_attempt: number;
	max_attempts: number;
}

/** { hostName: { serviceDescription: details } } */
interface ServiceStatusListData {
	servicelist: Record<string, Record<string, ServiceStatusDetails>>;
}

export interface ServiceStatusEntry {
	hostName: string;
	description: string;
	status: ServiceStatusDetails;
}

export interface ServiceStatusResult {
	queryTime: number;
	services: ServiceStatusEntry[];
}

/** See fetchHostStatusDetails's comment -- same bug, same fix, for "status". */
export async function fetchServiceStatusDetails(): Promise<ServiceStatusResult> {
	const { data, queryTime } = await fetchJsonWithResult<ServiceStatusListData>('statusjson.cgi', {
		query: 'servicelist',
		details: 'true',
		formatoptions: 'enumerate',
	});
	const services: ServiceStatusEntry[] = [];
	for (const [hostName, byDescription] of Object.entries(data.servicelist ?? {})) {
		for (const [description, status] of Object.entries(byDescription)) {
			services.push({ hostName, description, status });
		}
	}
	return { queryTime, services };
}

export interface ServiceObjectDetails {
	notes_url?: string;
	action_url?: string;
	icon_image?: string;
}

/** { hostName: { serviceDescription: details } } */
interface ServiceObjectListData {
	servicelist: Record<string, Record<string, ServiceObjectDetails>>;
}

/** Keyed by "hostName\u0000description" for O(1) lookup per row. */
export async function fetchServiceObjectDetails(): Promise<Map<string, ServiceObjectDetails>> {
	const data = await fetchJson<ServiceObjectListData>('objectjson.cgi', {
		query: 'servicelist',
		details: 'true',
	});
	const out = new Map<string, ServiceObjectDetails>();
	for (const [hostName, byDescription] of Object.entries(data.servicelist ?? {})) {
		for (const [description, details] of Object.entries(byDescription)) {
			out.set(`${hostName}\u0000${description}`, details);
		}
	}
	return out;
}

export interface ServiceGroupMember {
	host_name: string;
	service_description: string;
}

export interface ServiceGroupDetails {
	group_name: string;
	alias: string;
	members: ServiceGroupMember[];
}

interface ServiceGroupListData {
	servicegrouplist: Record<string, ServiceGroupDetails>;
}

export async function fetchServiceGroups(): Promise<ServiceGroupDetails[]> {
	const data = await fetchJson<ServiceGroupListData>('objectjson.cgi', {
		query: 'servicegrouplist',
		details: 'true',
	});
	return Object.values(data.servicegrouplist ?? {});
}

export interface HostGroupDetails {
	group_name: string;
	alias: string;
	members: string[];
}

interface HostGroupListData {
	hostgrouplist: Record<string, HostGroupDetails>;
}

export async function fetchHostGroups(): Promise<HostGroupDetails[]> {
	const data = await fetchJson<HostGroupListData>('objectjson.cgi', {
		query: 'hostgrouplist',
		details: 'true',
	});
	return Object.values(data.hostgrouplist ?? {});
}

/** statusjson.cgi's comment_type/entry_type enums -- see cgi/jsonutils.c's
    svm_comment_types/svm_comment_entry_types for the string values
    (formatoptions=enumerate always passed, matching every other enum in
    this file). */
export type CommentType = 'host' | 'service';
export type CommentEntryType = 'user' | 'downtime' | 'flapping' | 'acknowledgement';

export interface CommentEntry {
	comment_id: number;
	comment_type: CommentType;
	entry_type: CommentEntryType;
	persistent: boolean;
	entry_time: number;
	expires: boolean;
	expire_time: number;
	host_name: string;
	/** present when comment_type === 'service' */
	service_description?: string;
	author: string;
	comment_data: string;
}

/** statusjson.cgi?query=commentlist&details=true -- data.commentlist is an
    object keyed by comment_id (as a string), matching hostlist/servicelist's
    details=true shape. */
interface CommentListData {
	commentlist: Record<string, CommentEntry>;
}

export async function fetchComments(): Promise<CommentEntry[]> {
	const data = await fetchJson<CommentListData>('statusjson.cgi', {
		query: 'commentlist',
		details: 'true',
		formatoptions: 'enumerate',
	});
	return Object.values(data.commentlist ?? {});
}

/** cgi/jsonutils.c's svm_downtime_types (the "any" value is a query filter
    option, never actually present on a real downtime object). */
export type DowntimeType = 'host' | 'service';

export interface DowntimeEntry {
	downtime_id: number;
	type: DowntimeType;
	host_name: string;
	/** present when type === 'service' */
	service_description?: string;
	entry_time: number;
	start_time: number;
	flex_downtime_start: number;
	end_time: number;
	fixed: boolean;
	triggered_by: number;
	duration: number;
	is_in_effect: boolean;
	start_notification_sent: boolean;
	author: string;
	comment: string;
}

interface DowntimeListData {
	downtimelist: Record<string, DowntimeEntry>;
}

export async function fetchDowntimes(): Promise<DowntimeEntry[]> {
	const data = await fetchJson<DowntimeListData>('statusjson.cgi', {
		query: 'downtimelist',
		details: 'true',
		formatoptions: 'enumerate',
	});
	return Object.values(data.downtimelist ?? {});
}

/**
 * Shared by hosts.ts/services.ts: mirrors cgi/status.c's
 * hoststatustypes/servicestatustypes/hostprops/serviceprops query-string
 * filters used by side.html.in's "Hosts"/"Services" nav links and their
 * "(Unhandled)" counterparts, applied client-side against already-fetched
 * data instead of new query params -- see each file's matchesProblemFilter
 * for the exact bitmask-equivalent logic.
 */
export type ProblemFilterMode = 'all' | 'problems' | 'unhandled';

export function statusCgiHostUrl(hostName: string): string {
	const url = new URL(cgiUrl('status.cgi'), window.location.href);
	url.searchParams.set('host', hostName);
	return url.toString();
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

/**
 * archivejson.cgi's statechangelist/availability queries, used by trends.ts.
 * Response shapes confirmed against cgi/archivejson.c
 * (json_archive_statechangelist/json_archive_availability et al) -- see
 * archiveutils.c's svm_au_states/svm_au_object_types/svm_au_state_types for
 * the enumerated string values ("formatoptions=enumerate" is always passed
 * here, matching the legacy AngularJS trends-form.js this replaces).
 */

export type ArchiveObjectType = 'host' | 'service';
export type TrendsReportType = 'hosts' | 'services';

/** svm_au_states: host states + service states + a few pseudo-states used
    for "Initial .. Pseudo-State"/"Final .. Pseudo-State" bookend entries. */
export type ArchiveState =
	| 'nodata'
	| 'up'
	| 'down'
	| 'unreachable'
	| 'ok'
	| 'warning'
	| 'critical'
	| 'unknown'
	| 'programstart'
	| 'programend'
	| 'downtimestart'
	| 'downtimeend'
	| 'currentstate';

export interface StateChangeEntry {
	timestamp: number;
	object_type: ArchiveObjectType;
	/** present when object_type === 'host' */
	name?: string;
	/** present when object_type === 'service' */
	host_name?: string;
	description?: string;
	state_type: 'hard' | 'soft' | 'nodata';
	state: ArchiveState;
	plugin_output: string;
}

interface StateChangeListData {
	selectors: { starttime?: number; endtime?: number };
	statechangelist: StateChangeEntry[];
}

export interface StateChangeListParams {
	reportType: TrendsReportType;
	host: string;
	service?: string;
	startTime: number;
	endTime: number;
	includeSoftStates: boolean;
	backtrackedArchives: number;
}

export async function fetchStateChangeList(p: StateChangeListParams): Promise<StateChangeListData> {
	const params: Record<string, string> = {
		query: 'statechangelist',
		formatoptions: 'enumerate bitmask',
		objecttype: p.reportType === 'hosts' ? 'host' : 'service',
		hostname: p.host,
		starttime: String(p.startTime),
		endtime: String(p.endTime),
		statetypes: p.includeSoftStates ? 'hard soft' : 'hard',
		backtrackedarchives: String(p.backtrackedArchives),
	};
	if (p.reportType === 'services' && p.service) {
		params.servicedescription = p.service;
	}
	return fetchJson<StateChangeListData>('archivejson.cgi', params);
}

/** json_archive_host_availability -- duration fields are raw seconds
    (numbers) since "formatoptions=duration" is deliberately not passed. */
export interface HostAvailability {
	name?: string;
	time_up: number;
	time_down: number;
	time_unreachable: number;
	scheduled_time_up: number;
	scheduled_time_down: number;
	scheduled_time_unreachable: number;
	time_indeterminate_nodata: number;
	time_indeterminate_notrunning: number;
}

/** json_archive_service_availability */
export interface ServiceAvailability {
	host_name?: string;
	description?: string;
	time_ok: number;
	time_warning: number;
	time_critical: number;
	time_unknown: number;
	scheduled_time_ok: number;
	scheduled_time_warning: number;
	scheduled_time_critical: number;
	scheduled_time_unknown: number;
	time_indeterminate_nodata: number;
	time_indeterminate_notrunning: number;
}

interface AvailabilityData {
	host?: HostAvailability;
	service?: ServiceAvailability;
}

export interface AvailabilityParams {
	reportType: TrendsReportType;
	host: string;
	service?: string;
	startTime: number;
	endTime: number;
	includeSoftStates: boolean;
}

export async function fetchAvailability(p: AvailabilityParams): Promise<AvailabilityData> {
	const params: Record<string, string> = {
		query: 'availability',
		formatoptions: 'enumerate bitmask',
		availabilityobjecttype: p.reportType,
		hostname: p.host,
		statetypes: p.includeSoftStates ? 'hard soft' : 'hard',
		starttime: String(p.startTime),
		endtime: String(p.endTime),
	};
	if (p.reportType === 'services' && p.service) {
		params.servicedescription = p.service;
	}
	return fetchJson<AvailabilityData>('archivejson.cgi', params);
}

/** trends.cgi's PNG-image export (unchanged C/gd rendering) -- kept as an
    export/print link from the new SPA view rather than ported. */
export function trendsPngUrl(p: StateChangeListParams): string {
	const url = new URL(cgiUrl('trends.cgi'), window.location.href);
	url.searchParams.set('host', p.host);
	if (p.reportType === 'services' && p.service) {
		url.searchParams.set('service', p.service);
	}
	url.searchParams.set('t1', String(p.startTime));
	url.searchParams.set('t2', String(p.endTime));
	if (p.includeSoftStates) {
		url.searchParams.set('includesoftstates', 'yes');
	}
	return url.toString();
}

/**
 * archivejson.cgi?query=notificationlist (json_archive_notificationlist in
 * cgi/archivejson.c). Unlike statechangelist/availability, this isn't
 * scoped to one host/service -- notifications.cgi?contact=all shows
 * everything, so no host/service/contact filter is passed here either.
 */
export type NotificationObjectType = 'host' | 'service';

export interface NotificationEntry {
	timestamp: number;
	object_type: NotificationObjectType;
	/** present when object_type === 'host' */
	name?: string;
	/** present when object_type === 'service' */
	host_name?: string;
	description?: string;
	contact: string;
	/** cgi/archiveutils.c's svm_au_notification_types short keys (e.g.
	    "down", "critical", "recovery" -- the same short key is shared by
	    the host- and service-recovery enum values, disambiguated by
	    object_type, not by this string alone). */
	notification_type: string;
	method: string;
	message: string;
}

interface NotificationListData {
	notificationlist: NotificationEntry[];
}

export interface NotificationListParams {
	startTime: number;
	endTime: number;
}

export async function fetchNotifications(p: NotificationListParams): Promise<NotificationEntry[]> {
	const data = await fetchJson<NotificationListData>('archivejson.cgi', {
		query: 'notificationlist',
		formatoptions: 'enumerate',
		starttime: String(p.startTime),
		endtime: String(p.endTime),
	});
	return data.notificationlist ?? [];
}
