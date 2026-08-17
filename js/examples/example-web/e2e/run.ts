/**
 * Browser E2E for the wallet-standard Seeker Connect demo.
 *
 * Topology: the real example app runs in a real Chromium (driven through
 * the agent-browser CLI); the fake wallet runs in this process and talks
 * to the app over a real Nostr relay. The only test-only seam is the
 * association-URL capture (see vite.config.ts) plus the synthetic blur in
 * the app's `?e2e` mode — a desktop browser has no wallet app to receive
 * the launch intent.
 *
 * Run from `examples/example-web`: `pnpm e2e`. Requires network access to
 * the relay (SKR_E2E_RELAY overrides the default).
 */
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { RelayFakeWallet } from './relayFakeWallet.ts';

const EXAMPLE_DIR = fileURLToPath(new URL('..', import.meta.url));
const AGENT_BROWSER = fileURLToPath(new URL('../../../node_modules/.bin/agent-browser', import.meta.url));
const VITE = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url));
const APP_ORIGIN = 'http://localhost:3010';
const RELAY_DOMAIN = process.env.SKR_E2E_RELAY ?? 'relay.solanamobile.com';

const appUrl = (extra = '') => `${APP_ORIGIN}/?e2e&baseUri=off&relay=${RELAY_DOMAIN}${extra}`;

function ab(...args: string[]): string {
	return execFileSync(AGENT_BROWSER, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

/** Evaluates an expression in the page. */
function evalInPage<T>(expression: string): T {
	const envelope = JSON.parse(ab('eval', '--json', expression)) as {
		success: boolean;
		data: { result: T };
		error: string | null;
	};
	if (!envelope.success) {
		throw new Error(envelope.error ?? 'eval failed');
	}
	return envelope.data.result;
}

async function until<T>(label: string, probe: () => T | false | undefined, timeoutMs = 30_000): Promise<T> {
	const start = Date.now();
	for (;;) {
		let value: T | false | undefined;
		try {
			value = probe();
		} catch {
			value = undefined;
		}
		if (value !== undefined && value !== false) return value;
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for: ${label}`);
		}
		await sleep(400);
	}
}

function logText(): string {
	return ab('get', 'text', '[data-testid=log]');
}

/**
 * In-page click. agent-browser's coordinate-based click stops delivering
 * after the first interaction here (likely confused by the `?e2e` mode's
 * synthetic blur events); an in-page click exercises the same app code.
 */
function click(testId: string): void {
	evalInPage<boolean>(`(document.querySelector('[data-testid=${testId}]').click(), true)`);
}

function hasElement(selector: string): boolean {
	return evalInPage<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
}

function shadowText(selector: string): string {
	return evalInPage<string>(`(document.querySelector(${JSON.stringify(selector)})?.shadowRoot?.textContent ?? "")`);
}

let passed = 0;
function check(label: string, condition: boolean): void {
	if (condition) {
		passed += 1;
		console.log(`  ✓ ${label}`);
	} else {
		throw new Error(`Check failed: ${label}`);
	}
}

async function main(): Promise<void> {
	console.log(`relay: ${RELAY_DOMAIN}`);

	// 1. The app, served by Vite with the E2E capture plugin active.
	const vite = spawn(VITE, ['--port', '3010', '--strictPort'], {
		cwd: EXAMPLE_DIR,
		env: { ...process.env, SKR_E2E: '1' },
		stdio: 'ignore',
	});
	// A leftover server on the port would answer instead of our instance —
	// without SKR_E2E's capture transform, every connect would then hang.
	let viteShutdownExpected = false;
	vite.on('exit', (code) => {
		if (viteShutdownExpected) return;
		if (code !== null && code !== 0) {
			console.error(`vite exited with code ${code} — is something else on port 3010?`);
			process.exit(1);
		}
	});
	// No endpoint-specific URI: an https wallet URI would make the next
	// interaction's launch a real navigation away from the app under test.
	const wallet = new RelayFakeWallet({ walletUriBase: null });
	const served = new Set<string>();
	let pumpStopped = false;

	// 2. Feed every captured association URL to the fake wallet.
	const pump = (async () => {
		while (!pumpStopped) {
			try {
				const urls = evalInPage<string[]>('(window.__skrE2eAssociationUrls ?? [])');
				for (const url of urls) {
					if (!served.has(url)) {
						served.add(url);
						wallet.serveAssociation(url);
					}
				}
			} catch {
				// No page yet; keep pumping.
			}
			await sleep(300);
		}
	})();

	try {
		await until(
			'vite dev server',
			() => {
				try {
					execFileSync('curl', ['-sf', '-o', '/dev/null', APP_ORIGIN]);
					return true;
				} catch {
					return false;
				}
			},
			20_000,
		);

		console.log('scenario: discovery');
		ab('open', '--args', '--no-sandbox', appUrl());
		await until('wallet discovery', () =>
			ab('get', 'text', '[data-testid=wallet-status]').includes('Seeker Connect'),
		);
		check('Seeker Connect appears in the Wallet Standard registry', true);

		console.log('scenario: connect');
		click('connect');
		await until('progress overlay', () => hasElement('seeker-connect-progress'));
		check('progress overlay shows during connection', true);
		await until('connected account', () => hasElement('[data-testid=account-address]'));
		check(
			"connect resolves the fake wallet's account",
			ab('get', 'text', '[data-testid=account-address]').length > 0,
		);
		await until('progress overlay dismissed', () => !hasElement('seeker-connect-progress'));
		check('progress overlay dismissed after connection', true);

		console.log('scenario: signing');
		click('sign-message');
		await until('signMessage result', () => logText().includes('signMessage ✓'));
		check('signMessage round trip', true);

		click('sign-transaction');
		await until('signTransaction result', () => logText().includes('signTransaction ✓'));
		check('signTransaction round trip', true);

		click('sign-and-send');
		await until('signAndSendTransaction result', () => logText().includes('signAndSendTransaction ✓'));
		check('signAndSendTransaction round trip', true);

		click('sign-in');
		await until('signIn result', () => logText().includes('signIn ✓'));
		check('sign-in (SIWS) round trip', true);

		console.log('scenario: reload → silent restore → reauthorize');
		const authorizesBefore = wallet.responder.authorizeRequests.length;
		ab('reload');
		await until('restored session', () => logText().includes('restored session from cache'));
		check(
			'reload restores the session from cache without a wallet round trip',
			wallet.responder.authorizeRequests.length === authorizesBefore,
		);
		click('sign-message');
		await until('signMessage after reload', () => logText().includes('signMessage ✓'));
		const reauthorize = wallet.responder.authorizeRequests.at(-1);
		check(
			'signing after reload reauthorizes with the stored auth token',
			reauthorize?.authToken === wallet.script.authToken,
		);

		console.log('scenario: disconnect');
		click('disconnect');
		await until('disconnected', () => hasElement('[data-testid=connect]'));
		check('disconnect returns to the connect state', true);

		console.log('scenario: declined authorization → error dialog');
		wallet.script.authorizeError = {
			code: -1,
			message: 'authorization declined',
		};
		click('connect');
		await until('error dialog', () => hasElement('seeker-connect-error-dialog'));
		check(
			'declined authorization surfaces the error dialog',
			shadowText('seeker-connect-error-dialog').includes('Connection declined'),
		);
		evalInPage<boolean>(
			`(document.querySelector("seeker-connect-error-dialog").shadowRoot.querySelector(".cta").click(), true)`,
		);
		await until('error dialog dismissed', () => !hasElement('seeker-connect-error-dialog'));
		check('error dialog dismisses', true);
		delete wallet.script.authorizeError;

		console.log('scenario: unreachable wallet → association-failed dialog');
		wallet.script.unresponsive = true;
		ab('open', '--args', '--no-sandbox', appUrl('&timeout=4000'));
		await until('app after reload', () =>
			ab('get', 'text', '[data-testid=wallet-status]').includes('Seeker Connect'),
		);
		click('connect');
		await until('association-failed dialog', () => hasElement('seeker-connect-error-dialog'), 20_000);
		check(
			'unreachable wallet surfaces the association-failed dialog',
			shadowText('seeker-connect-error-dialog').includes('We can’t find your Seeker'),
		);

		if (wallet.errors.length) {
			throw new Error(`fake wallet errors: ${wallet.errors.join('; ')}`);
		}
		console.log(`\nPASS — ${passed} checks`);
	} finally {
		pumpStopped = true;
		await pump.catch(() => undefined);
		wallet.close();
		try {
			ab('close');
		} catch {
			// Browser may already be gone.
		}
		viteShutdownExpected = true;
		vite.kill();
	}
}

main().catch((error: unknown) => {
	console.error(`\nFAIL — ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
});
