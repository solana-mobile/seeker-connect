// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';

import { SeekerConnectErrorDialog } from './elements/errorDialog.js';
import { createSeekerConnectPresenter, defineSeekerConnectElements } from './presenter.js';

async function rendered(element: Element): Promise<void> {
	await (element as SeekerConnectErrorDialog).updateComplete;
}

function shadowText(element: Element): string {
	return element.shadowRoot?.textContent ?? '';
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('defineSeekerConnectElements', () => {
	it('registers the elements and is idempotent', () => {
		defineSeekerConnectElements();
		defineSeekerConnectElements();
		expect(customElements.get('seeker-connect-progress')).toBeDefined();
		expect(customElements.get('seeker-connect-error-dialog')).toBeDefined();
	});
});

describe('progress overlay', () => {
	it('appears for the duration of the interaction', async () => {
		const presenter = createSeekerConnectPresenter();

		const settle = presenter.interactionStarted(() => undefined);
		const progress = document.querySelector('seeker-connect-progress');
		expect(progress).not.toBeNull();
		await rendered(progress!);
		expect(shadowText(progress!)).toContain('Continue in your Seeker Wallet');
		expect(shadowText(progress!)).toContain('Accept the connection request in your wallet');

		settle();
		expect(document.querySelector('seeker-connect-progress')).toBeNull();
	});

	it('cancels the interaction when the user closes it', async () => {
		const presenter = createSeekerConnectPresenter();
		const cancel = vi.fn();

		presenter.interactionStarted(cancel);
		const progress = document.querySelector('seeker-connect-progress')!;
		await rendered(progress);

		(progress.shadowRoot!.querySelector('.cta') as HTMLButtonElement).click();

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(document.querySelector('seeker-connect-progress')).toBeNull();
	});

	it('cancels on Escape', async () => {
		const presenter = createSeekerConnectPresenter();
		const cancel = vi.fn();
		presenter.interactionStarted(cancel);
		await rendered(document.querySelector('seeker-connect-progress')!);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(document.querySelector('seeker-connect-progress')).toBeNull();
	});

	it('renders the brand mark and animated arc as inline SVG', async () => {
		const presenter = createSeekerConnectPresenter();
		const settle = presenter.interactionStarted(() => undefined);
		const progress = document.querySelector('seeker-connect-progress')!;
		await rendered(progress);
		expect(progress.shadowRoot!.querySelector('.icon-slot svg .arc')).not.toBeNull();
		expect(progress.shadowRoot!.querySelector('img')).toBeNull();
		settle();
	});

	it('settle tolerates the element already being dismissed', async () => {
		const presenter = createSeekerConnectPresenter();
		const settle = presenter.interactionStarted(() => undefined);
		const progress = document.querySelector('seeker-connect-progress')!;
		await rendered(progress);
		(progress as SeekerConnectErrorDialog).remove();

		expect(() => settle()).not.toThrow();
	});
});

describe('error dialog', () => {
	function showError(code: SeekerConnectErrorCode, message = 'boom') {
		const presenter = createSeekerConnectPresenter();
		presenter.interactionFailed(new SeekerConnectError(code, message));
		return document.querySelector('seeker-connect-error-dialog') as SeekerConnectErrorDialog;
	}

	it('shows the designed copy for a declined connection', async () => {
		const dialog = showError(SeekerConnectErrorCode.authorizationDeclined);
		await rendered(dialog);

		const text = shadowText(dialog);
		expect(text).toContain('Connection declined');
		expect(text).toContain('You declined the connection in your Seeker Wallet.');
		expect(dialog.shadowRoot!.querySelector('.cta')!.textContent).toContain('Close');
	});

	it('covers every surfaced error code with distinct copy', async () => {
		const surfacedCodes = Object.values(SeekerConnectErrorCode).filter(
			// Cancellation is user-initiated and never surfaces a dialog.
			(code) => code !== SeekerConnectErrorCode.cancelled,
		);
		const titles = new Set<string>();
		for (const code of surfacedCodes) {
			const dialog = showError(code);
			await rendered(dialog);
			const title = dialog.shadowRoot!.querySelector('.title')!.textContent!;
			expect(title.length).toBeGreaterThan(0);
			titles.add(title);
			dialog.remove();
		}
		expect(titles.size).toBe(surfacedCodes.length);
	});

	it('renders the state icon and footer wordmark as inline SVG', async () => {
		const dialog = showError(SeekerConnectErrorCode.sessionClosed);
		await rendered(dialog);
		expect(dialog.shadowRoot!.querySelectorAll('.icon-slot svg path').length).toBeGreaterThan(1);
		expect(dialog.shadowRoot!.querySelectorAll('.footer svg path').length).toBeGreaterThan(10);
		expect(dialog.shadowRoot!.querySelector('img')).toBeNull();
	});

	it('dismisses from the Close button and announces it', async () => {
		const dialog = showError(SeekerConnectErrorCode.authorizationDeclined);
		await rendered(dialog);
		let dismissed = false;
		dialog.addEventListener('seeker-connect-dismiss', () => {
			dismissed = true;
		});

		(dialog.shadowRoot!.querySelector('.cta') as HTMLButtonElement).click();

		expect(dismissed).toBe(true);
		expect(document.querySelector('seeker-connect-error-dialog')).toBeNull();
	});

	it('dismisses from the X control', async () => {
		const dialog = showError(SeekerConnectErrorCode.walletError);
		await rendered(dialog);

		(dialog.shadowRoot!.querySelector('.close') as HTMLButtonElement).click();

		expect(document.querySelector('seeker-connect-error-dialog')).toBeNull();
	});

	it('dismisses on Escape', async () => {
		const dialog = showError(SeekerConnectErrorCode.sessionClosed);
		await rendered(dialog);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

		expect(document.querySelector('seeker-connect-error-dialog')).toBeNull();
	});

	it('dismisses on tap outside the card but not inside it', async () => {
		const dialog = showError(SeekerConnectErrorCode.walletError);
		await rendered(dialog);

		(dialog.shadowRoot!.querySelector('.card') as HTMLElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true }),
		);
		expect(document.querySelector('seeker-connect-error-dialog')).not.toBeNull();

		(dialog.shadowRoot!.querySelector('.backdrop') as HTMLElement).click();
		expect(document.querySelector('seeker-connect-error-dialog')).toBeNull();
	});
});

describe('theme', () => {
	it('defaults to prefers-color-scheme (no theme attribute)', async () => {
		const presenter = createSeekerConnectPresenter();
		presenter.interactionFailed(new SeekerConnectError(SeekerConnectErrorCode.walletError, 'x'));
		const dialog = document.querySelector('seeker-connect-error-dialog')!;
		expect(dialog.getAttribute('theme')).toBeNull();
	});

	it('applies a forced theme to both elements', async () => {
		const presenter = createSeekerConnectPresenter({ theme: 'dark' });
		presenter.interactionStarted(() => undefined);
		presenter.interactionFailed(new SeekerConnectError(SeekerConnectErrorCode.walletError, 'x'));
		expect(document.querySelector('seeker-connect-progress')!.getAttribute('theme')).toBe('dark');
		expect(document.querySelector('seeker-connect-error-dialog')!.getAttribute('theme')).toBe('dark');
	});
});
