/**
 * Shared behavior for Seeker Connect's modal cards: dismissal via the X
 * control, the Close button, Escape, and a tap outside the card. Dismissal
 * announces `seeker-connect-dismiss` before the element removes itself.
 */
import { LitElement } from 'lit';

export class SeekerConnectCard extends LitElement {
	#onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') this.dismiss();
	};

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener('keydown', this.#onKeyDown);
	}

	disconnectedCallback(): void {
		window.removeEventListener('keydown', this.#onKeyDown);
		super.disconnectedCallback();
	}

	firstUpdated(): void {
		// Move focus into the dialog without painting the focus ring;
		// keyboard navigation still shows it via :focus-visible.
		(this.renderRoot.querySelector('.cta') as HTMLButtonElement | null)?.focus({
			focusVisible: false,
		} as FocusOptions);
	}

	dismiss(): void {
		this.dispatchEvent(
			new Event('seeker-connect-dismiss', {
				bubbles: true,
				composed: true,
			}),
		);
		this.remove();
	}

	protected onBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) this.dismiss();
	}
}
