# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xzunid/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xzunid/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's csv-reader 1.0.0 that reads broken CSV files faster. `solve.js` answers exactly as csv-reader 1.0.0 does on every case — same `{ columns, rows, errors }`, same error codes (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`) — while scanning quoteless lines with native `split(',')` and quoted fields with `indexOf`, so no per-character loop runs on the hot path.

## Run it

```sh
node main.ts
```

`main.ts` reads the drawn cases from `$MAKEFUN_INPUT_DIR` (default `/input`, `cases.json`) and writes one `{ columns, rows, errors }` answer per case, in order, to `$MAKEFUN_OUTPUT_DIR/answers.json` (default `/output`). Node 22, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
