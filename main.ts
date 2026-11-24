// SPDX-License-Identifier: MIT
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const { run } = await import('./solve.js');

// The harness tells the program where the input and output live: locally
// (process driver) via MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR, on the
// server (docker) via the /input and /output mounts. Prefer the env dirs.
const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const cases = JSON.parse(readFileSync(inputDir + '/cases.json', 'utf8'));
const answers = [];
for (const c of cases) answers.push(run(c.input));
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/answers.json', JSON.stringify(answers));
