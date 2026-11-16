#!/usr/bin/env node
// Guards the package-display invariant: an installed @fookhsu/pi-btw must show
// up in pi as "@fookhsu/pi-btw", not "@fookhsu/pi-btw:<file>".
//
// pi labels a package extension "<pkg>:<path-under-pkg>" (see
// getCompactExtensionLabel in interactive-mode) unless the entry file resolves
// to "index.ts" directly under the package, in which case the label is just
// the package name. So the manifest must declare exactly one extension,
// "./extensions/index.ts" — anything else (extra entries, a renamed file)
// silently changes what users see after install.
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { resolve } from "node:path";

const NAME = "@fookhsu/pi-btw";
const ENTRY = "./extensions/index.ts";

const fail = (msg) => {
	console.error(`✗ ${msg}`);
	process.exit(1);
};

let pkg;
try {
	pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (error) {
	fail(`package.json is not valid JSON: ${error.message}`);
}

if (pkg.name !== NAME) fail(`package.name must be "${NAME}", got "${pkg.name}"`);

const exts = pkg.pi?.extensions;
if (!Array.isArray(exts) || exts.length !== 1 || exts[0] !== ENTRY) {
	fail(
		`pi.extensions must be exactly ["${ENTRY}"] — any other entry displays as "${NAME}:<file>" instead of "${NAME}". Got ${JSON.stringify(exts)}`,
	);
}

if (pkg.main !== "extensions/index.ts") {
	fail(`"main" must be "extensions/index.ts", got "${pkg.main}"`);
}

if (!existsSync(resolve(ENTRY))) fail(`entry file missing: ${ENTRY}`);

for (const dir of ["extensions", "skills"]) {
	if (!pkg.files?.includes(dir)) fail(`"files" must include "${dir}" so npm ships it`);
}

// Mirror pi's label rule as a final assertion.
const rel = ENTRY.replace(/^\.\//, "").replace(/^extensions\//, "");
const parsed = posix.parse(rel);
const label = parsed.name === "index" && (!parsed.dir || parsed.dir === ".") ? NAME : `${NAME}:${rel}`;
if (label !== NAME) fail(`entry would display as "${label}", not "${NAME}"`);

console.log(`✓ package invariant ok: installs display as ${NAME}`);
