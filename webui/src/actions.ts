import { openModal } from './modal';
import { formatDateTimeForConfirmation, type AcknowledgeOptions, type DowntimeOptions } from './commands';

function toLocalInputValue(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function promptAcknowledge(subject: string): Promise<AcknowledgeOptions | null> {
	const values = await openModal(`Acknowledge: ${subject}`, [
		{ name: 'comment', label: 'Comment', type: 'textarea', required: true },
		{ name: 'sticky', label: 'Sticky (stay acknowledged until fully recovers)', type: 'checkbox', checked: true },
		{ name: 'notify', label: 'Notify contacts', type: 'checkbox', checked: true },
		{ name: 'persistent', label: 'Persistent comment', type: 'checkbox', checked: false },
	], 'Acknowledge');

	if (!values || !values.comment?.trim()) {
		return null;
	}
	return {
		comment: values.comment,
		sticky: 'sticky' in values,
		notify: 'notify' in values,
		persistent: 'persistent' in values,
	};
}

export async function promptDowntime(subject: string): Promise<DowntimeOptions | null> {
	const now = new Date();
	const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

	const values = await openModal(`Schedule Downtime: ${subject}`, [
		{ name: 'comment', label: 'Comment', type: 'textarea', required: true },
		{ name: 'start', label: 'Start', type: 'datetime-local', defaultValue: toLocalInputValue(now), required: true },
		{ name: 'end', label: 'End', type: 'datetime-local', defaultValue: toLocalInputValue(twoHoursLater), required: true },
		{
			name: 'type',
			label: 'Type',
			type: 'select',
			defaultValue: 'fixed',
			options: [
				{ value: 'fixed', label: 'Fixed (starts/ends exactly as scheduled)' },
				{ value: 'flexible', label: 'Flexible (starts when a problem occurs within the window)' },
			],
		},
		{ name: 'hours', label: 'Flexible duration: hours', type: 'number', defaultValue: '2', min: '0' },
		{ name: 'minutes', label: 'Flexible duration: minutes', type: 'number', defaultValue: '0', min: '0', step: '1' },
	], 'Schedule');

	if (!values || !values.comment?.trim()) {
		return null;
	}

	const confirmed = window.confirm(
		`Schedule downtime for ${subject}\n` +
			`From: ${formatDateTimeForConfirmation(values.start)}\n` +
			`To:   ${formatDateTimeForConfirmation(values.end)}\n\n` +
			'Times are interpreted in the server\'s configured date format ' +
			'(this deployment defaults to US-style MM-DD-YYYY). Continue?',
	);
	if (!confirmed) {
		return null;
	}

	return {
		comment: values.comment,
		startLocal: values.start,
		endLocal: values.end,
		fixed: values.type !== 'flexible',
		flexibleHours: Number(values.hours) || 0,
		flexibleMinutes: Number(values.minutes) || 0,
	};
}
