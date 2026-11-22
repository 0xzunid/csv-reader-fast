// main.ts — the program the harness runs for csv-reader-speed-01-run-20261121.
//
// Node 22 runs `node /bot/main.ts` with the drawn set read-only at
// $MAKEFUN_INPUT_DIR (default /input) and an empty writable $MAKEFUN_OUTPUT_DIR
// (default /output). It answers every case with solve.js's run() and writes
// /output/answers.json: one { columns, rows, errors } answer per case, in
// the cases' order.
//
// The drawn set's files are the generator's, so this program does not assume
// their names or shape: it reads every file under the input dir (recursively)
// and takes the cases from whichever file holds them — a whole set as JSON
// (an array of { text, header }, or an object wrapping one under `cases`,
// `inputs`, `instances`, `set`, `items`, `data` or `entries`, or a single
// case, optionally nested under `input`/`case`), as JSON Lines, as one case
// per file, or as raw text files. Files ending in .in are one case each and
// are answered per-file to /output/<id>.out instead. A case that fails to
// parse still gets an (empty) answer, so one bad case cannot fail the run.
// Standard library only, no network, no clock, no randomness: two runs on
// the same input write the same bytes.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { run } from './solve.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const WRAPPER_KEYS = ['cases', 'inputs', 'instances', 'set', 'items', 'data', 'entries'];

// Pull cases out of a parsed JSON value: { kind: 'set', cases } for an array
// of cases, { kind: 'single', case } for one case, else null.
function extractCases(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'set', cases: [] };
    if (value.every((c) => c && typeof c.text === 'string')) {
      return { kind: 'set', cases: value };
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of WRAPPER_KEYS) {
      if (Array.isArray(value[key])) {
        const inner = extractCases(value[key]);
        if (inner) return inner;
      }
    }
    if (typeof value.text === 'string') return { kind: 'single', case: value };
    for (const key of ['input', 'case']) {
      if (value[key] && typeof value[key] === 'object') {
        const inner = extractCases(value[key]);
        if (inner) return inner;
      }
    }
  }
  return null;
}

// Read cases out of one file's text: whole-file JSON first, then JSON Lines.
// The JSON Lines attempt only makes sense when lines are JSON objects, so it
// is skipped unless the first non-whitespace character is '{'. A raw CSV/text
// file never starts with '{'; without this guard, splitting a large raw file
// just to throw on its first line wastes a large share of the 10 s budget
// (a 5.6 MB raw file cost ~240 ms of loader time before this guard).
function casesFromText(text) {
  try {
    const found = extractCases(JSON.parse(text));
    if (found) return found;
  } catch {
    // Not one JSON value: fall through to JSON Lines.
  }
  let k = 0;
  while (
    k < text.length &&
    (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r' || text[k] === '\uFEFF')
  )
    k++;
  if (k >= text.length || text[k] !== '{') return null;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return extractCases(parsed);
}

// Every file under dir, recursively, sorted by path.
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of [...names].sort()) {
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function loadCases(dir) {
  const files = listFiles(dir);

  // Per-file mode: a file ending in .in is one case, answered to <id>.out.
  const ins = files.filter((f) => f.endsWith('.in'));
  if (ins.length > 0) {
    return {
      mode: 'per-file',
      cases: ins.map((file) => {
        let text = '';
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          text = '';
        }
        const found = casesFromText(text);
        const c =
          found && found.kind === 'single'
            ? found.case
            : found && found.kind === 'set' && found.cases.length === 1
              ? found.cases[0]
              : { text, header: true };
        return { id: basename(file).slice(0, -3), input: c };
      }),
    };
  }

  // Set mode: prefer one file holding the whole set of cases.
  let bestSet = null;
  const singles = [];
  const raw = [];
  for (const file of files) {
    const base = basename(file);
    if (base === 'seed.json') continue;
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.length === 0) continue;
    const found = casesFromText(text);
    if (found && found.kind === 'set') {
      const score = /cases/i.test(base) ? 3 : /input|instance|set/i.test(base) ? 2 : 1;
      if (!bestSet || score > bestSet.score || (score === bestSet.score && file < bestSet.file)) {
        bestSet = { cases: found.cases, score, file };
      }
    } else if (found && found.kind === 'single') {
      singles.push({ file, case: found.case });
    } else if (!found && !/\.md$/i.test(base)) {
      // Not JSON at all: a raw-text case file (kept only as a last resort).
      if (/\.txt$|\.csv$|\.tsv$|\.in$|case|input|instance/i.test(base) || !/\./.test(base)) {
        raw.push({ file, text });
      }
    }
  }
  if (bestSet) return { mode: 'set', cases: bestSet.cases };
  if (singles.length > 0) {
    singles.sort((a, b) => (a.file < b.file ? -1 : 1));
    return { mode: 'set', cases: singles.map((s) => s.case) };
  }
  // The instance seed itself may hold the cases when nothing else does.
  const seed = files.find((f) => basename(f) === 'seed.json');
  if (seed) {
    try {
      const found = extractCases(JSON.parse(readFileSync(seed, 'utf8')));
      if (found && found.kind === 'set') return { mode: 'set', cases: found.cases };
      if (found && found.kind === 'single') return { mode: 'set', cases: [found.case] };
    } catch {
      // Fall through to the raw-text and empty fallbacks.
    }
  }
  if (raw.length > 0) {
    raw.sort((a, b) => (a.file < b.file ? -1 : 1));
    return { mode: 'set', cases: raw.map((r) => ({ text: r.text, header: true })) };
  }
  // Nothing recognisable: answer nothing rather than crash, so the run
  // completes and the grader reports the gate instead of a failed run.
  return { mode: 'set', cases: [] };
}

function answer(c) {
  try {
    return run(c);
  } catch {
    return { columns: null, rows: [], errors: [] };
  }
}

mkdirSync(outputDir, { recursive: true });
const loaded = loadCases(inputDir);
if (loaded.mode === 'set') {
  const answers = loaded.cases.map((c) => answer(c));
  writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
} else {
  for (const c of loaded.cases) {
    writeFileSync(join(outputDir, `${c.id}.out`), JSON.stringify(answer(c.input)));
  }
}
