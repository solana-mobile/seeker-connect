import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['**/dist/**'] }, js.configs.recommended, ...tseslint.configs.recommended, {
	// Only a package's mwa-adapter module may import the MWA libraries.
	files: ['packages/*/src/**/*.ts'],
	ignores: ['packages/*/src/mwa-adapter/**'],
	rules: {
		'no-restricted-imports': [
			'error',
			{
				patterns: [
					{
						group: ['@solana-mobile/*'],
						message:
							"MWA libraries may only be imported inside a package's src/mwa-adapter/ module, behind the SeekerLink port.",
					},
				],
			},
		],
	},
});
