import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, rmSync } from "fs";

// Cut a GitHub release for the version in manifest.json:
//   1. validates the working tree is clean and pushed
//   2. builds main.js
//   3. creates a release tagged <version> with main.js/manifest.json/styles.css
//
// Usage:
//   npm run release                 # auto-generated notes from commits
//   npm run release -- "notes..."   # custom release notes
const ASSETS = ["main.js", "manifest.json", "styles.css"];
const NOTES_TMP = ".release-notes.tmp";

const onWin = process.platform === "win32";

function run(cmd, args) {
	const r = spawnSync(cmd, args, { stdio: "inherit", shell: onWin });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

function capture(cmd, args) {
	const r = spawnSync(cmd, args, { encoding: "utf8", shell: onWin });
	return (r.stdout || "").trim();
}

function fail(msg) {
	console.error(`release: ${msg}`);
	process.exit(1);
}

const { version, id } = JSON.parse(readFileSync("manifest.json", "utf8"));
if (!version) fail("no version in manifest.json");
console.log(`Releasing ${id} ${version}`);

// 1. Working tree must be clean and in sync with the upstream branch.
if (capture("git", ["status", "--porcelain"])) {
	fail("working tree is not clean — commit or stash first.");
}
const upstream = capture("git", ["rev-parse", "--abbrev-ref", "@{u}"]);
if (!upstream) fail("no upstream branch — push the branch first.");
run("git", ["fetch", "--quiet"]);
if (capture("git", ["rev-parse", "HEAD"]) !== capture("git", ["rev-parse", "@{u}"])) {
	fail(`HEAD differs from ${upstream} — push (or pull) first.`);
}

// 2. Refuse to clobber an existing release for this version.
const existing = spawnSync("gh", ["release", "view", version], { shell: onWin });
if (existing.status === 0) fail(`release ${version} already exists.`);

// 3. Build.
run("npm", ["run", "build"]);

// 4. Create the release.
const ghArgs = ["release", "create", version, ...ASSETS, "--title", version];
const notes = process.argv[2];
if (notes) {
	writeFileSync(NOTES_TMP, notes);
	ghArgs.push("--notes-file", NOTES_TMP);
} else {
	ghArgs.push("--generate-notes");
}

try {
	run("gh", ghArgs);
} finally {
	try {
		rmSync(NOTES_TMP);
	} catch {
		/* nothing to clean up */
	}
}
