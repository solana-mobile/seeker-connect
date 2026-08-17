import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/**
 * E2E-only (SKR_E2E=1): records every association URL on
 * `window.__skrE2eAssociationUrls` before the real launch. A desktop test
 * browser has no wallet app to receive the launch intent, so this is the
 * only way the harness's fake wallet can learn the session parameters the
 * wallet app would normally get. The launch itself still runs (it is a
 * silent no-op for an unhandled custom scheme).
 */
function e2eAssociationCapture(): Plugin {
	return {
		name: 'skr-e2e-association-capture',
		apply: 'serve',
		transform(code, id) {
			if (!process.env.SKR_E2E) return;
			if (!id.includes('mobile-wallet-adapter-protocol')) return;
			if (!code.includes('window.location.assign(associationUrl)')) return;
			return code.replaceAll(
				'window.location.assign(associationUrl)',
				'((window.__skrE2eAssociationUrls ??= []).push(associationUrl.toString()), window.location.assign(associationUrl))',
			);
		},
	};
}

export default defineConfig({
	// Pre-bundled deps bypass plugin transforms; the E2E association capture
	// must see the protocol package's source.
	optimizeDeps: {
		exclude: ['@solana-mobile/mobile-wallet-adapter-protocol'],
	},
	plugins: [react(), e2eAssociationCapture()],
	server: {
		port: 3010,
		// `pnpm tunnel:start` (ngrok) serves the dev server to a phone over
		// https; Vite rejects unknown Host headers unless allowed.
		allowedHosts: ['.ngrok.io', '.ngrok-free.app', '.ngrok.app', '.ngrok.dev'],
	},
});
