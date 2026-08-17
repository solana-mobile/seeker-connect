/** `SeekerConnectPresenter` backed by the Lit elements in this package. */
import type { SeekerConnectError, SeekerConnectPresenter } from '@skr-connect/core';

import { SeekerConnectButton } from './elements/connectButton.js';
import { SeekerConnectErrorDialog } from './elements/errorDialog.js';
import { SeekerConnectProgress } from './elements/progress.js';

const PROGRESS_TAG = 'seeker-connect-progress';
const ERROR_DIALOG_TAG = 'seeker-connect-error-dialog';
const BUTTON_TAG = 'seeker-connect-button';

/** Registers the custom elements; safe to call repeatedly. */
export function defineSeekerConnectElements(): void {
	if (typeof customElements === 'undefined') return;
	if (!customElements.get(PROGRESS_TAG)) {
		customElements.define(PROGRESS_TAG, SeekerConnectProgress);
	}
	if (!customElements.get(ERROR_DIALOG_TAG)) {
		customElements.define(ERROR_DIALOG_TAG, SeekerConnectErrorDialog);
	}
	if (!customElements.get(BUTTON_TAG)) {
		customElements.define(BUTTON_TAG, SeekerConnectButton);
	}
}

export interface SeekerConnectPresenterOptions {
	/** Forces a theme; defaults to following `prefers-color-scheme`. */
	theme?: 'light' | 'dark';
}

/**
 * Shows a progress overlay for the duration of each wallet interaction and
 * an error dialog when one fails. Dismissing the progress overlay cancels
 * the interaction. Inert outside a DOM environment.
 */
export function createSeekerConnectPresenter(options: SeekerConnectPresenterOptions = {}): SeekerConnectPresenter {
	const applyTheme = (element: HTMLElement) => {
		if (options.theme) element.setAttribute('theme', options.theme);
	};
	return {
		interactionStarted(cancel: () => void) {
			if (typeof document === 'undefined') return () => undefined;
			defineSeekerConnectElements();
			const progress = document.createElement(PROGRESS_TAG);
			applyTheme(progress);
			// User-initiated dismissal (X, Close, Escape, tap outside) aborts
			// the in-flight interaction.
			progress.addEventListener('seeker-connect-dismiss', () => cancel());
			document.body.appendChild(progress);
			return () => progress.remove();
		},
		interactionFailed(error: SeekerConnectError) {
			if (typeof document === 'undefined') return;
			defineSeekerConnectElements();
			const dialog = document.createElement(ERROR_DIALOG_TAG) as SeekerConnectErrorDialog;
			dialog.code = error.code;
			applyTheme(dialog);
			document.body.appendChild(dialog);
		},
	};
}
