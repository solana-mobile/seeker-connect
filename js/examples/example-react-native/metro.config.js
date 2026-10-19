const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
	// The workspace packages, and the pnpm store they link to, live above this app.
	watchFolders: [path.resolve(__dirname, '../..')],
	resolver: {
		// Code from a workspace package (e.g. Babel's runtime helpers) resolves this app's dependencies too.
		nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
	},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
