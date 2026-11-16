#!/usr/bin/env node
// Loads this package through pi's real extension loader (jiti) and asserts the
// entry resolves to extensions/index.ts without errors or warnings.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const fail = (msg) => {
	console.error(`✗ ${msg}`);
	process.exit(1);
};

// Isolated agentDir so global extensions never pollute the result.
const agentDir = mkdtempSync(join(tmpdir(), "pi-btw-smoke-"));
const result = await discoverAndLoadExtensions([process.cwd()], process.cwd(), agentDir);

if (result.errors.length > 0) {
	console.error("✗ extension failed to load:");
	for (const e of result.errors) console.error(`  ${e.path}: ${e.error}`);
	process.exit(1);
}

const expected = join(process.cwd(), "extensions", "index.ts");
if (result.extensions.length !== 1 || result.extensions[0].path !== expected) {
	fail(
		`expected exactly 1 loaded extension at ${expected}, got [${result.extensions.map((e) => e.path).join(", ") || "none"}]`,
	);
}

console.log("✓ extension loads via pi loader: extensions/index.ts");
