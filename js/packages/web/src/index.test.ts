import { describe, expect, it } from 'vitest';

import * as web from './index.js';

// Toolchain smoke test: proves this package's entry module compiles and its
// cross-package (workspace) imports resolve. Replaced by real behavioral
// tests as the web build-out lands.
describe('@skr-connect/web entry', () => {
	it('loads', () => {
		expect(web).toBeDefined();
	});
});
