// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SeekerConnectButton } from './elements/connectButton.js';
import { defineSeekerConnectElements } from './presenter.js';

async function createButton(attributes: Record<string, string> = {}): Promise<SeekerConnectButton> {
	defineSeekerConnectElements();
	const button = document.createElement('seeker-connect-button') as SeekerConnectButton;
	for (const [name, value] of Object.entries(attributes)) {
		button.setAttribute(name, value);
	}
	document.body.appendChild(button);
	await button.updateComplete;
	return button;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('seeker-connect-button', () => {
	it('defaults to the connect label with the S glyph', async () => {
		const button = await createButton();
		expect(button.shadowRoot!.textContent).toContain('Connect with Seeker');
		expect(button.shadowRoot!.querySelectorAll('.glyph path').length).toBeGreaterThan(1);
		expect(button.shadowRoot!.querySelector('img')).toBeNull();
	});

	it('renders the sign-in variant', async () => {
		const button = await createButton({ variant: 'sign-in' });
		expect(button.shadowRoot!.textContent).toContain('Sign in with Seeker');
		expect(button.shadowRoot!.querySelector('button')!.getAttribute('aria-label')).toBe('Sign in with Seeker');
	});

	it('fires ordinary click events', async () => {
		const button = await createButton();
		const onClick = vi.fn();
		button.addEventListener('click', onClick);
		(button.shadowRoot!.querySelector('button') as HTMLButtonElement).click();
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('disables the inner button', async () => {
		const button = await createButton({ disabled: '' });
		expect((button.shadowRoot!.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
	});

	it('honors a theme override via attribute', async () => {
		const button = await createButton({ theme: 'dark' });
		expect(button.getAttribute('theme')).toBe('dark');
	});
});
