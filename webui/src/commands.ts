import { cgiUrl, getCurrentUser } from './api';

/**
 * cmd.cgi client. Field names/command codes confirmed against cgi/cmd.c and
 * include/common.h. See the plan for the full protocol writeup -- in short:
 * a single POST with cmd_mod=2 commits directly (no confirmation
 * round-trip), body must be application/x-www-form-urlencoded, and success
 * vs failure is only distinguishable by substring-matching the HTML
 * response body (there's no separate HTTP status or JSON envelope here).
 */

const CMD_ACKNOWLEDGE_HOST_PROBLEM = 33;
const CMD_ACKNOWLEDGE_SVC_PROBLEM = 34;
const CMD_SCHEDULE_HOST_DOWNTIME = 55;
const CMD_SCHEDULE_SVC_DOWNTIME = 56;

export interface CommandResult {
	ok: boolean;
	message: string;
}

function getNagFormId(): string | null {
	const match = document.cookie.match(/(?:^|;\s*)NagFormId=([0-9a-fA-F]{1,10})/);
	return match ? match[1] : null;
}

async function submitCommand(fields: Record<string, string>): Promise<CommandResult> {
	const nagFormId = getNagFormId();
	const body = new URLSearchParams(fields);
	if (nagFormId) {
		body.set('nagFormId', nagFormId);
	}

	const res = await fetch(cgiUrl('cmd.cgi'), {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});

	if (!res.ok) {
		return { ok: false, message: `cmd.cgi request failed: HTTP ${res.status}` };
	}

	const text = await res.text();
	if (text.includes("CLASS='infoMessage'")) {
		return { ok: true, message: 'Command submitted successfully.' };
	}
	if (text.includes('Invalid form id')) {
		return { ok: false, message: 'Invalid form id (reload the page and try again).' };
	}
	const errorMatch = text.match(/CLASS='errorMessage'>([^<]*)/);
	if (errorMatch) {
		return { ok: false, message: errorMatch[1].trim() };
	}
	return { ok: false, message: 'Unrecognized response from cmd.cgi.' };
}

export interface AcknowledgeOptions {
	comment: string;
	sticky?: boolean;
	notify?: boolean;
	persistent?: boolean;
}

function acknowledgeFields(opts: AcknowledgeOptions): Record<string, string> {
	const fields: Record<string, string> = {
		cmd_mod: '2',
		com_author: getCurrentUser() ?? '',
		com_data: opts.comment,
	};
	if (opts.sticky) fields.sticky_ack = 'on';
	if (opts.notify) fields.send_notification = 'on';
	if (opts.persistent) fields.persistent = 'on';
	return fields;
}

export function acknowledgeHost(host: string, opts: AcknowledgeOptions): Promise<CommandResult> {
	return submitCommand({
		cmd_typ: String(CMD_ACKNOWLEDGE_HOST_PROBLEM),
		host,
		...acknowledgeFields(opts),
	});
}

export function acknowledgeService(host: string, service: string, opts: AcknowledgeOptions): Promise<CommandResult> {
	return submitCommand({
		cmd_typ: String(CMD_ACKNOWLEDGE_SVC_PROBLEM),
		host,
		service,
		...acknowledgeFields(opts),
	});
}

export interface DowntimeOptions {
	comment: string;
	/** <input type="datetime-local"> values (browser-local time, no timezone suffix). */
	startLocal: string;
	endLocal: string;
	fixed: boolean;
	flexibleHours?: number;
	flexibleMinutes?: number;
}

/**
 * cmd.cgi parses start_time/end_time with a format that depends on the
 * server's date_format cgi.cfg setting. This deployment's cgi.cfg doesn't
 * set date_format, so the server default (DATE_FORMAT_US,
 * "MM-DD-YYYY HH:MM:SS") applies -- see cgi/cmd.c's string_to_time(). If a
 * deployment ever sets date_format to something else, this will need to
 * change accordingly.
 */
function formatUsDateTime(datetimeLocal: string): string {
	const d = new Date(datetimeLocal);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Human-readable rendering of the same value, shown to the user as a final sanity check before submitting. */
export function formatDateTimeForConfirmation(datetimeLocal: string): string {
	const d = new Date(datetimeLocal);
	if (isNaN(d.getTime())) return '(invalid date)';
	return d.toLocaleString(undefined, {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function downtimeFields(opts: DowntimeOptions): Record<string, string> {
	const fields: Record<string, string> = {
		cmd_mod: '2',
		com_author: getCurrentUser() ?? '',
		com_data: opts.comment,
		trigger: '0',
		start_time: formatUsDateTime(opts.startLocal),
		end_time: formatUsDateTime(opts.endLocal),
		fixed: opts.fixed ? '1' : '0',
	};
	if (!opts.fixed) {
		fields.hours = String(opts.flexibleHours ?? 0);
		fields.minutes = String(opts.flexibleMinutes ?? 0);
	}
	return fields;
}

export function scheduleHostDowntime(host: string, opts: DowntimeOptions): Promise<CommandResult> {
	return submitCommand({
		cmd_typ: String(CMD_SCHEDULE_HOST_DOWNTIME),
		host,
		childoptions: '0',
		...downtimeFields(opts),
	});
}

export function scheduleServiceDowntime(host: string, service: string, opts: DowntimeOptions): Promise<CommandResult> {
	return submitCommand({
		cmd_typ: String(CMD_SCHEDULE_SVC_DOWNTIME),
		host,
		service,
		...downtimeFields(opts),
	});
}
