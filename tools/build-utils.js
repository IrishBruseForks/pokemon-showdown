"use strict";

const fs = require("fs");
const child_process = require("child_process");
const esbuild = require('esbuild');
const path = require('path');

const copyOverDataJSON = (file = 'data') => {
	const files = fs.readdirSync(file);
	for (const f of files) {
		if (fs.statSync(`${file}/${f}`).isDirectory()) {
			copyOverDataJSON(`${file}/${f}`);
		} else if (f.endsWith('.json')) {
			let test = path.resolve('dist', `${file}/${f}`);
			fs.mkdirSync(path.dirname(test), { recursive: true });
			fs.copyFileSync(`${file}/${f}`,path.resolve('dist', `${file}/${f}`));
		}
	}
};

const shouldBeCompiled = file => {
	if (file.includes('node_modules/')) return false;
	if (file.endsWith('.tsx')) return true;
	if (file.endsWith('.ts')) return !(file.endsWith('.d.ts') || file.includes('global'));
	return false;
};

const findFilesForPath = path => {
	const out = [];
	const files = fs.readdirSync(path);
	for (const file of files) {
		const cur = `${path}/${file}`;
		// HACK: Logs and databases exclusions are a hack. Logs is too big to
		// traverse, databases adds/removes files which can lead to a filesystem
		// race between readdirSync and statSync. Please, at some point someone
		// fix this function to be more robust.
		if (cur.includes('node_modules') || cur.includes("/logs") || cur.includes("/databases")) continue;
		if (fs.statSync(cur).isDirectory()) {
			out.push(...findFilesForPath(cur));
		} else if (shouldBeCompiled(cur)) {
			out.push(cur);
		}
	}
	return out;
};

exports.transpile = (decl) => {
	esbuild.build({
		entryPoints: ["./index.ts"],
		outfile: "./dist/index.mjs",
		platform: "node",
		target: "deno1.40",
		bundle: true,
		define: {
			"global":"globalThis"
		},
		plugins: [envPlugin],
		minify: true,
		format: "esm",
		tsconfig: "./tsconfig.json",
	});
	// fs.copyFileSync('./config/config-example.js', './dist/config/config-example.js');
	copyOverDataJSON();

	// NOTE: replace is asynchronous - add additional replacements for the same path in one call instead of making multiple calls.
	if (decl) {
		exports.buildDecls();
	}
};

exports.buildDecls = () => {
	try {
		child_process.execSync(`node ./node_modules/typescript/bin/tsc -p sim`, {stdio: 'inherit'});
	} catch {}
};
let envPlugin = {
	name: "env",
	setup(build) {
		function addNodePrefix(args) {
			return {
				path: "node:" + args.path,
				external: true,
			};
		}

		// Intercept import paths called "env" so esbuild doesn't attempt
		// to map them to a file system location. Tag them with the "env-ns"
		// namespace to reserve them for this plugin.
		build.onResolve({ filter: /^child_process$/ }, (args) =>
			addNodePrefix(args)
		);
		build.onResolve({ filter: /^cluster$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^url$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^http$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^https$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^repl$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^net$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^path$/ }, (args) => addNodePrefix(args));
		build.onResolve({ filter: /^fs$/ }, (args) => addNodePrefix(args));

		build.onEnd((result) => {
			let text = fs.readFileSync("./dist/index.mjs", "utf8");

			text = text.replace(/__dirname/g, "import.meta.dirname");

			fs.writeFileSync("./dist/index.mjs", text);
		});
	},
};
