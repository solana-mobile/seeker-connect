/**
 * Modal dialog surfacing a failed wallet interaction. Implements the
 * `docs/design/Web-2..5.svg` states; `association-failed` has no design
 * frame yet and reuses the layout with the globe icon (see decisions.md).
 * The designs' "Try again" CTA ships as "Close" until retry semantics
 * exist (docs/open-questions.md #1).
 */
import type { SeekerConnectErrorCode } from '@solana-mobile/seeker-connect-core';
import { html, svg } from 'lit';

import { css } from 'lit';

import { cardStyles, CLOSE_X_PATH, DECLINED_ICON_PATHS, footerWordmark, GLOBE_ICON_PATHS } from '../brand.js';
import { SeekerConnectCard } from './card.js';

interface ErrorCopy {
	title: string;
	body: string;
	icon: 'declined' | 'globe';
}

const ERROR_COPY: Partial<Record<SeekerConnectErrorCode, ErrorCopy>> = {
	'association-failed': {
		title: 'We can’t find your Seeker',
		body: 'Make sure your Seeker Wallet is setup and try again.',
		icon: 'globe',
	},
	'authorization-declined': {
		title: 'Connection declined',
		body: 'You declined the connection in your Seeker Wallet.',
		icon: 'declined',
	},
	'request-declined': {
		title: 'Request declined',
		body: 'You declined the request in your Seeker Wallet.',
		icon: 'declined',
	},
	'session-closed': {
		title: 'Connection lost',
		body: 'The connection to your Seeker Wallet was interrupted.',
		icon: 'globe',
	},
	'wallet-error': {
		title: 'Something went wrong',
		body: 'Your Seeker Wallet ran into an unexpected error.',
		icon: 'globe',
	},
};

const FALLBACK_COPY = ERROR_COPY['wallet-error']!;

/**
 * The `<seeker-connect-error-dialog>` element: explains a failed wallet
 * interaction in Seeker Connect copy selected by {@link SeekerConnectErrorDialog.code}.
 */
export class SeekerConnectErrorDialog extends SeekerConnectCard {
	/** @internal */
	static properties = {
		code: { type: String },
	};

	/**
	 * Selects the dialog's title, body, and icon. Unknown or unset codes show
	 * the generic wallet-error copy.
	 */
	declare code: SeekerConnectErrorCode | undefined;

	/** @internal */
	static styles = [
		cardStyles,
		css`
			.icon-slot svg {
				width: 64px;
				height: 64px;
			}
		`,
	];

	/** @internal */
	render() {
		const copy = (this.code && ERROR_COPY[this.code]) || FALLBACK_COPY;
		const iconPaths = copy.icon === 'declined' ? DECLINED_ICON_PATHS : GLOBE_ICON_PATHS;
		return html`
			<div class="backdrop" @click=${this.onBackdropClick}>
				<div class="card" role="alertdialog" aria-modal="true" aria-label=${copy.title}>
					<button class="close" aria-label="Close" @click=${() => this.dismiss()}>
						<svg viewBox="337.833 268.833 16.334 16.334" xmlns="http://www.w3.org/2000/svg">
							<path d=${CLOSE_X_PATH} fill="currentColor" />
						</svg>
					</button>
					<div class="icon-slot">
						<!-- Design-file coordinate space; 64×64 icon box at (168,347). -->
						<svg viewBox="168 347 64 64" xmlns="http://www.w3.org/2000/svg">
							${iconPaths.map(
								(d) => svg`<path d=${d} fill="none" stroke="currentColor" stroke-width="5.33333" />`,
							)}
						</svg>
					</div>
					<div class="title">${copy.title}</div>
					<div class="body">${copy.body}</div>
					<button class="cta" @click=${() => this.dismiss()}>Close</button>
					<div class="footer" aria-label="Solana Mobile">
						<svg viewBox="140 671 120 10" xmlns="http://www.w3.org/2000/svg">
							<g fill="#B4B4B4">${footerWordmark}</g>
						</svg>
					</div>
				</div>
			</div>
		`;
	}
}
