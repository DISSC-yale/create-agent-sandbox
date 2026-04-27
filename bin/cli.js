#!/usr/bin/env node
import { parseArgs, HELP_TEXT } from '../src/flags.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const flags = parseArgs(process.argv);

if (flags.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (flags.version) {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const { runWizard } = await import('../src/index.js');
runWizard(flags).catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
