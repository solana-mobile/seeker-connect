// Writes the Android Seeker Connect SDK version the React Native package builds against, at publish time
// only; the repository keeps the local main-SNAPSHOT build.
//   release: the package's own version, which must already be on Maven Central.
//   canary:  the latest released version. With none released yet, the package is left out of the canary.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const KEY = 'SeekerConnect_seekerConnectAndroidVersion';
const packageJsonUrl = new URL('../packages/react-native/package.json', import.meta.url);
const gradlePropertiesUrl = new URL('../packages/react-native/android/gradle.properties', import.meta.url);
const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

/** The latest released version, or null when npm has never had the package; any other npm failure throws. */
function latestRelease() {
	try {
		return execFileSync('npm', ['view', `${packageJson.name}@latest`, 'version'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (error) {
		if (String(error.stderr).includes('E404')) return null;
		throw error;
	}
}

/** Fails unless the Android SDK artifacts the package depends on are on Maven Central at [version]. */
async function requireOnMavenCentral(version) {
	for (const artifact of ['seeker-connect', 'seeker-connect-compose']) {
		const pom = `https://repo1.maven.org/maven2/com/solanamobile/${artifact}/${version}/${artifact}-${version}.pom`;
		const response = await globalThis.fetch(pom, { method: 'HEAD' });
		if (!response.ok)
			fail(`${pom}: HTTP ${response.status}; the Android SDK ${version} must be on Maven Central first`);
	}
}

const mode = process.argv[2];
if (mode !== 'release' && mode !== 'canary') fail('usage: android-sdk-version.mjs release|canary');
const version = mode === 'release' ? packageJson.version : latestRelease();
if (mode === 'release') await requireOnMavenCentral(version);

if (version === null) {
	writeFileSync(packageJsonUrl, `${JSON.stringify({ ...packageJson, private: true }, null, '\t')}\n`);
	process.stdout.write(`No ${packageJson.name} release yet; left out of the canary.\n`);
} else {
	const pattern = new RegExp(`^${KEY}=.*$`, 'm');
	const properties = readFileSync(gradlePropertiesUrl, 'utf8');
	if (!pattern.test(properties)) fail(`${gradlePropertiesUrl.pathname}: no ${KEY} line`);
	if (version.includes('SNAPSHOT')) fail(`${version} is not a released Android SDK version`);
	writeFileSync(gradlePropertiesUrl, properties.replace(pattern, `${KEY}=${version}`));
	process.stdout.write(`${KEY}=${version}\n`);
}
