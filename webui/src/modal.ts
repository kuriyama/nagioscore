/**
 * A minimal, dependency-free modal form. Used by hosts.ts/services.ts for
 * the Acknowledge/Schedule Downtime dialogs (webui has no UI framework).
 */

export type ModalFieldType = 'text' | 'textarea' | 'checkbox' | 'datetime-local' | 'number' | 'select';

export interface ModalField {
	name: string;
	label: string;
	type: ModalFieldType;
	defaultValue?: string;
	checked?: boolean; // checkbox only
	required?: boolean;
	options?: { value: string; label: string }[]; // select only
	min?: string; // number only
	step?: string; // number only
}

/** Resolves to the submitted field values (checkboxes present only if checked), or null if cancelled. */
export function openModal(title: string, fields: ModalField[], submitLabel = 'Submit'): Promise<Record<string, string> | null> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'modalOverlay';

		const dialog = document.createElement('div');
		dialog.className = 'modalDialog';

		const heading = document.createElement('h3');
		heading.textContent = title;
		dialog.appendChild(heading);

		const form = document.createElement('form');
		const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();

		for (const field of fields) {
			const row = document.createElement('div');
			row.className = 'modalRow';

			const label = document.createElement('label');
			label.textContent = field.label;

			let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
			if (field.type === 'textarea') {
				input = document.createElement('textarea');
				input.value = field.defaultValue ?? '';
			} else if (field.type === 'select') {
				const select = document.createElement('select');
				for (const opt of field.options ?? []) {
					const optionEl = document.createElement('option');
					optionEl.value = opt.value;
					optionEl.textContent = opt.label;
					if (opt.value === field.defaultValue) {
						optionEl.selected = true;
					}
					select.appendChild(optionEl);
				}
				input = select;
			} else {
				const el = document.createElement('input');
				el.type = field.type;
				if (field.type === 'checkbox') {
					el.checked = field.checked ?? false;
				} else {
					el.value = field.defaultValue ?? '';
				}
				if (field.min) el.min = field.min;
				if (field.step) el.step = field.step;
				input = el;
			}
			input.name = field.name;
			if (field.required && field.type !== 'checkbox') {
				input.setAttribute('required', 'required');
			}

			if (field.type === 'checkbox') {
				label.prepend(input);
			} else {
				label.appendChild(document.createElement('br'));
				label.appendChild(input);
			}
			row.appendChild(label);
			form.appendChild(row);
			inputs.set(field.name, input);
		}

		const buttonRow = document.createElement('div');
		buttonRow.className = 'modalButtons';

		const cancelButton = document.createElement('button');
		cancelButton.type = 'button';
		cancelButton.textContent = 'Cancel';

		const submitButton = document.createElement('button');
		submitButton.type = 'submit';
		submitButton.textContent = submitLabel;

		buttonRow.appendChild(cancelButton);
		buttonRow.appendChild(submitButton);
		form.appendChild(buttonRow);
		dialog.appendChild(form);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		function close(result: Record<string, string> | null): void {
			document.removeEventListener('keydown', onKeydown);
			overlay.remove();
			resolve(result);
		}

		function onKeydown(ev: KeyboardEvent): void {
			if (ev.key === 'Escape') close(null);
		}

		cancelButton.addEventListener('click', () => close(null));
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay) close(null);
		});
		document.addEventListener('keydown', onKeydown);

		form.addEventListener('submit', (ev) => {
			ev.preventDefault();
			const result: Record<string, string> = {};
			for (const field of fields) {
				const input = inputs.get(field.name)!;
				if (field.type === 'checkbox') {
					if ((input as HTMLInputElement).checked) {
						result[field.name] = 'on';
					}
				} else {
					result[field.name] = input.value;
				}
			}
			close(result);
		});

		(inputs.get(fields[0]?.name) as HTMLElement | undefined)?.focus();
	});
}
