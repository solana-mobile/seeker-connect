import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['**/dist/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		// React Native's tooling loads these as CommonJS under Node.
		files: ['examples/example-react-native/babel.config.js', 'examples/example-react-native/metro.config.js'],
		languageOptions: {
			sourceType: 'commonjs',
			globals: { __dirname: 'readonly', module: 'writable', require: 'readonly' },
		},
		rules: { '@typescript-eslint/no-require-imports': 'off' },
	},
	{
		// Only a package's mwa-adapter module may import the MWA libraries.
		files: ['packages/*/src/**/*.ts'],
		ignores: ['packages/*/src/mwa-adapter/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@solana-mobile/*', '!@solana-mobile/seeker-connect-*'],
							message:
								"MWA libraries may only be imported inside a package's src/mwa-adapter/ module, behind the SeekerLink port.",
						},
					],
				},
			],
		},
	},
);
