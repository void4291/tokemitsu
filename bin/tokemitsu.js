#!/usr/bin/env node
import { main } from '../src/cli.js';
main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => { console.error(`tokemitsu: ${err?.message ?? err}`); process.exit(1); },
);
