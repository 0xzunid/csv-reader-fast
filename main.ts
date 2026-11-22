// main.ts — the program the harness runs for csv-reader-speed-01-run-20261121.
//
// Node 22 runs `node /bot/main.ts` with the drawn set read-only at
// $MAKEFUN_INPUT_DIR (default /input) and an empty writable $MAKEFUN_OUTPUT_DIR
// (default /output). It answers every case with solve.js's run() and writes
// /output/answers.json: one { columns, rows, errors } answer per case, in
// the cases' order. Cases are read from cases.json when present, else from
// any other JSON file in the input dir that holds them (an array of
// { text, header }, an object with a `cases` array, or a single case).
// As a fallback, per-file inputs (<id>.in, one JSON case each) are answered
// to /output/<id>.out instead. Standard library only, no network, no clock,
// no randomness: two runs on the same input write the same bytes.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './solve.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function asCases(value) {
  if (Array.isArray(value)) {
    return value.every((c) => c && typeof c.text === 'string') ? value : null;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.cases)) return value.cases;
    if (typeof value.text === 'string') return [value];
  }
  return null;
}

function readCasesFile(path) {
  try {
    return asCases(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function readCasesJsonl(path) {
  try {
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    return asCases(lines);
  } catch {
    return null;
  }
}

function loadCases(dir) {
  const names = readdirSync(dir);
  if (names.includes('cases.json')) {
    const cases = readCasesFile(join(dir, 'cases.json'));
    if (cases) return { mode: 'set', cases };
  }
  if (names.includes('cases.jsonl')) {
    const cases = readCasesJsonl(join(dir, 'cases.jsonl'));
    if (cases) return { mode: 'set', cases };
  }
  for (const name of [...names].sort()) {
    if (!name.endsWith('.json') || name === 'seed.json') continue;
    const cases = readCasesFile(join(dir, name));
    if (cases) return { mode: 'set', cases };
  }
  for (const name of [...names].sort()) {
    if (!name.endsWith('.jsonl')) continue;
    const cases = readCasesJsonl(join(dir, name));
    if (cases) return { mode: 'set', cases };
  }
  const ins = [...names].sort().filter((n) => n.endsWith('.in'));
  if (ins.length > 0) {
    return {
      mode: 'per-file',
      cases: ins.map((name) => {
        const text = readFileSync(join(dir, name), 'utf8');
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const c = parsed && typeof parsed.text === 'string' ? parsed : { text, header: true };
        return { id: name.slice(0, -3), input: c };
      }),
    };
  }
  throw new Error(`no cases found in ${dir}`);
}

mkdirSync(outputDir, { recursive: true });
const loaded = loadCases(inputDir);
if (loaded.mode === 'set') {
  const answers = loaded.cases.map((c) => run(c));
  writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
} else {
  for (const c of loaded.cases) {
    writeFileSync(join(outputDir, `${c.id}.out`), JSON.stringify(run(c.input)));
  }
}
