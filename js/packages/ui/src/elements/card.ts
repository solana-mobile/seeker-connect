/**
 * Shared behavior for Seeker Connect's modal cards: dismissal via the X
 * control, the Close button, Escape, and a tap outside the card. Dismissal
 * announces `seeker-connect-dismiss` before the element removes itself.
 */
import { LitElement } from 'lit';

/** Base class of the modal cards; not registered as an element itself. */
export class SeekerConnectCard extends LitElement {
	#onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') this.dismiss();
	};

	/** @internal */
	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener('keydown', this.#onKeyDown);
	}

	/** @internal */
	disconnectedCallback(): void {
		window.removeEventListener('keydown', this.#onKeyDown);
		super.disconnectedCallback();
	}

	/** @internal */
	firstUpdated(): void {
		// Move focus into the dialog without painting the focus ring;
		// keyboard navigation still shows it via :focus-visible.
		(this.renderRoot.querySelector('.cta') as HTMLButtonElement | null)?.focus({
			focusVisible: false,
		} as FocusOptions);
	}

	/** Closes the card: dispatches `seeker-connect-dismiss`, then removes the element from the DOM. */
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
