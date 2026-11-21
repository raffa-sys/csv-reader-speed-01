# csv-reader-speed-01

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/raffa-sys/csv-reader-speed-01/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/raffa-sys/csv-reader-speed-01/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

**csv-reader-speed-01** is a faster drop-in for make.fun's own csv-reader
1.0.0: `solve.js` returns exactly csv-reader's answer for every input
`{text, header}` — `{columns, rows, errors}` under its written broken-row
policy — but parses without the reference's character-at-a-time loop.

How it is fast:

- **Clean-line fast path.** Most records are one clean line: no quotes, no
  stray CR. Such a record is its line's text split on commas (native
  `String.split`), after two `indexOf` probes prove the line holds neither
  `"` nor `\r`.
- **Slice-based field readers.** Anything else (a quoted field, a stray CR,
  a multi-line note) goes through readers that jump with `indexOf` to the
  next interesting character and take whole slices instead of appending one
  character at a time.

What is kept exactly: the BOM dropped, empty lines are no records, a lone
CR outside quotes dropped with `stray_cr`, a quoted field's `""` is one
quote and its CRLF/lone CR is one LF, junk after a closing quote appended
as-is with `quote_junk`, an unterminated quote is a literal and the rest
re-read as unquoted with `unterminated_quote`, rows padded (`short_row`)
or cut (`long_row`) to the first record's width, and every error
`{code, line, row}` on the line its record starts on, in the order met.

Run it with Node 22: `node main.ts` reads `/input/cases.json` and writes
`/output/answers.json` (or `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR`
outside a container). No dependencies, no build step.

## License

MIT — see [LICENSE](LICENSE).
