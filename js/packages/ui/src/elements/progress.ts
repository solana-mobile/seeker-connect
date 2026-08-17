/**
 * Overlay shown while a wallet interaction is in flight. Implements the
 * `docs/design/Web.svg` (dark) / `Web-1.svg` (light) "Continue in your
 * Seeker Wallet" state; the design's open circle arc is animated as a
 * spinner. Dismissing (X, Close, Escape, tap outside) cancels the
 * interaction via the presenter.
 */
import { css, html } from 'lit';

import { cardStyles, CLOSE_X_PATH, footerWordmark, S_MARK_ARC_PATH, S_MARK_PATH } from '../brand.js';
import { SeekerConnectCard } from './card.js';

export class SeekerConnectProgress extends SeekerConnectCard {
	static styles = [
		cardStyles,
		css`
			.icon-slot svg {
				width: 124px;
				height: 124px;
			}
			.arc {
				transform-origin: 200px 379px;
				animation: skr-spin 1.4s linear infinite;
			}
			@keyframes skr-spin {
				to {
					transform: rotate(360deg);
				}
			}
			@media (prefers-reduced-motion: reduce) {
				.arc {
					animation: none;
				}
			}
		`,
	];

	render() {
		return html`
			<div class="backdrop" @click=${this.onBackdropClick}>
				<div class="card" role="dialog" aria-modal="true" aria-label="Continue in your Seeker Wallet">
					<button class="close" aria-label="Close" @click=${() => this.dismiss()}>
						<svg viewBox="337.833 268.833 16.334 16.334" xmlns="http://www.w3.org/2000/svg">
							<path d=${CLOSE_X_PATH} fill="currentColor" />
						</svg>
					</button>
					<div class="icon-slot">
						<!-- Design-file coordinate space; mark centered at (200,379). -->
						<svg viewBox="138 317 124 124" xmlns="http://www.w3.org/2000/svg">
							<path d=${S_MARK_PATH} fill="currentColor" />
							<path
								class="arc"
								d=${S_MARK_ARC_PATH}
								fill="none"
								stroke="currentColor"
								stroke-width="3.99911"
							/>
						</svg>
					</div>
					<div class="title">Continue in your Seeker Wallet</div>
					<div class="body">Accept the connection request in your wallet</div>
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
