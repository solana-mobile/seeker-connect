/**
 * "Connect with Seeker" / "Sign in with Seeker" buttons, implementing
 * `docs/design/Light mode.svg` (black buttons for light pages) and
 * `Dark mode.svg` (white for dark pages). Purely presentational: it fires
 * ordinary click events and the consumer wires the action — a functional
 * drop-in ships once the imperative consumer API exists (post-milestone-1).
 *
 * `variant="connect"` (default) or `variant="sign-in"` selects the label.
 * Theme follows `prefers-color-scheme` (a dark page gets the white button)
 * and accepts a `theme="light" | "dark"` override naming the host page's
 * scheme.
 */
import { css, html, LitElement, svg } from 'lit';

import { S_GLYPH_MONO_PATHS } from './connectButtonVectors.js';

/** Which label the button shows: `connect` or `sign-in`. */
export type SeekerConnectButtonVariant = 'connect' | 'sign-in';

const LABELS: Record<SeekerConnectButtonVariant, string> = {
	connect: 'Connect with Seeker',
	'sign-in': 'Sign in with Seeker',
};

/**
 * The `<seeker-connect-button>` element. Purely presentational: it fires
 * ordinary click events and the consumer wires the action.
 */
export class SeekerConnectButton extends LitElement {
	/** @internal */
	static properties = {
		variant: { type: String },
		disabled: { type: Boolean, reflect: true },
	};

	/** Selects the label; defaults to `connect`. */
	declare variant: SeekerConnectButtonVariant;
	/** Disables the button and reflects the `disabled` attribute. */
	declare disabled: boolean;

	constructor() {
		super();
		this.variant = 'connect';
		this.disabled = false;
	}

	/** @internal */
	static styles = css`
		:host {
			display: inline-block;
			width: 368px;
			max-width: 100%;
			font-family:
				'Google Sans Flex Variable',
				'Google Sans Flex',
				'Google Sans',
				system-ui,
				-apple-system,
				sans-serif;
			/* Light page → black button (design "Light mode"). */
			--skr-button-bg: #000000;
			--skr-button-fg: #ffffff;
		}
		@media (prefers-color-scheme: dark) {
			:host {
				--skr-button-bg: #ffffff;
				--skr-button-fg: #000000;
			}
		}
		:host([theme='light']) {
			--skr-button-bg: #000000;
			--skr-button-fg: #ffffff;
		}
		:host([theme='dark']) {
			--skr-button-bg: #ffffff;
			--skr-button-fg: #000000;
		}
		button {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 56px;
			border: none;
			border-radius: 16px;
			background: var(--skr-button-bg);
			color: var(--skr-button-fg);
			font: inherit;
			font-size: 20px;
			font-weight: 500;
			cursor: pointer;
			outline: none;
		}
		button:hover:not(:disabled) {
			opacity: 0.92;
		}
		button:active:not(:disabled) {
			opacity: 0.84;
		}
		button:disabled {
			opacity: 0.4;
			cursor: default;
		}
		button:focus-visible {
			outline: 2px solid #6939ca;
			outline-offset: 2px;
		}
		.glyph {
			width: 18.2px;
			height: 24px;
			margin-right: 19px;
			display: block;
			flex: none;
		}
	`;

	/** @internal */
	render() {
		const label = LABELS[this.variant] ?? LABELS.connect;
		return html`
			<button ?disabled=${this.disabled} aria-label=${label} part="button">
				<svg class="glyph" viewBox="88.4 449 18.2 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
					${S_GLYPH_MONO_PATHS.map((d) => svg`<path d=${d} fill="currentColor" />`)}
				</svg>
				<span>${label}</span>
			</button>
		`;
	}
}
