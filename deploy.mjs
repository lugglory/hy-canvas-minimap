import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// Target vault plugin folder. Resolved from, in order:
//   1. VAULT_PLUGIN_DIR environment variable
//   2. deploy.local.json -> { "target": "<absolute path>" }  (gitignored)
// Kept out of the repo so no personal path is published.
function resolveTarget() {
	if (process.env.VAULT_PLUGIN_DIR) return process.env.VAULT_PLUGIN_DIR;
	try {
		return JSON.parse(readFileSync("deploy.local.json", "utf8")).target;
	} catch {
		return null;
	}
}

const TARGET = resolveTarget();
if (!TARGET) {
	console.error(
		'No deploy target. Set VAULT_PLUGIN_DIR, or create deploy.local.json:\n  { "target": "<vault>/.obsidian/plugins/hy-canvas-minimap" }',
	);
	process.exit(1);
}

// Files Obsidian actually loads at runtime.
const FILES = ["main.js", "manifest.json", "styles.css"];

if (!existsSync("main.js")) {
	console.error("main.js not found — run `npm run build` (or `npm run dev`) first.");
	process.exit(1);
}

mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
	copyFileSync(file, join(TARGET, file));
	console.log(`copied ${file} -> ${join(TARGET, file)}`);
}

console.log("Deploy complete. Reload the plugin in Obsidian to pick up changes.");
