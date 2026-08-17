// Self-hosted brand typefaces for the SDK UI — no external requests.
import '@fontsource-variable/google-sans-flex';
import '@fontsource-variable/google-sans-code';

import { defineSeekerConnectElements } from '@solana-mobile/seeker-connect-ui';
import { registerSeekerConnect } from '@solana-mobile/seeker-connect-wallet-standard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { config } from './config.js';
import './style.css';

// Eagerly define the SDK's UI elements so tests and tooling can stage any
// dialog state directly; the SDK otherwise defines them on first use.
defineSeekerConnectElements();
registerSeekerConnect(config);

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
