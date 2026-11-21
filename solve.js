// SPDX-License-Identifier: MIT
// csv-reader-speed: a fast drop-in for make.fun's csv-reader 1.0.0.
//
// Same answers as csv-reader 1.0.0 for every input, but parsed without the
// reference's character-at-a-time loop. Two ideas do the work:
//
// 1. Most records are one clean line: no quotes, no stray CR. A record like
//    that is its line's text split on commas (String.split, native speed),
//    after two indexOf probes prove the line holds neither '"' nor '\r'.
// 2. Anything else (a quoted field, a stray CR, a multi-line note) goes
//    through position-based field readers that jump with indexOf to the next
//    interesting character and take whole slices, instead of appending one
//    character at a time.
//
// Every quirk of the reference policy is kept exactly: BOM dropped, empty
// lines are no records, lone CR outside quotes dropped with stray_cr, a
// quoted field's "" is one quote and its CRLF/lone CR is one LF, junk after
// a closing quote appended as-is with quote_junk, an unterminated quote is
// a literal and the rest re-read as unquoted with unterminated_quote, rows
// padded (short_row) or cut (long_row) to the first record's width, and
// every error {code, line, row} on the line its record starts on, in the
// order met.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      const ri = text.indexOf('\r', pos);
      let m = -1;
      let k = 3; // 0 comma, 1 LF, 2 CR, 3 end of text
      if (ci !== -1) {
        m = ci;
        k = 0;
      }
      if (ni !== -1 && (m === -1 || ni < m)) {
        m = ni;
        k = 1;
      }
      if (ri !== -1 && (m === -1 || ri < m)) {
        m = ri;
        k = 2;
      }
      if (m === -1) {
        if (pos < len) {
          added += len - pos;
          value += text.slice(pos);
          pos = len;
        }
        return { value, ended: END, added };
      }
      if (m > pos) {
        added += m - pos;
        value += text.slice(pos, m);
      }
      if (k === 0) {
        pos = m + 1;
        return { value, ended: COMMA, added };
      }
      if (k === 1) {
        pos = m + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (m + 1 < len && text.charCodeAt(m + 1) === 10) {
        pos = m + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A lone CR: dropped, and the field goes on.
      pos = m + 1;
      error('stray_cr');
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      // A line break inside the quotes, before the next quote: it is one LF in the value.
      const ri = text.indexOf('\r', pos);
      const ni = text.indexOf('\n', pos);
      let nl = -1;
      let isCR = false;
      if (ri !== -1 && ri < q) {
        nl = ri;
        isCR = true;
      }
      if (ni !== -1 && ni < q && (nl === -1 || ni < nl)) {
        nl = ni;
        isCR = false;
      }
      if (nl !== -1) {
        if (nl > pos) value += text.slice(pos, nl);
        value += '\n';
        line += 1;
        pos = isCR && nl + 1 < len && text.charCodeAt(nl + 1) === 10 ? nl + 2 : nl + 1;
        continue;
      }
      if (q > pos) value += text.slice(pos, q);
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote in the value.
        value += '"';
        pos = q + 2;
        continue;
      }
      // The closing quote.
      pos = q + 1;
      if (pos >= len) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  // Finishes a record: sets the width from the first record, keeps the header, or pads/cuts the row to the width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // The end of this line: a lone CR at its end is its CRLF's CR.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    const contentEnd =
      nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const content = text.slice(pos, contentEnd);
    if (content.indexOf('"') === -1 && content.indexOf('\r') === -1) {
      // A clean line: no quotes, no stray CR. Its fields are the line split on commas.
      // The probes run on the sliced line alone, so they never scan past it.
      finishRecord(content.split(','));
      line += 1;
      pos = nl === -1 ? len : nl + 1;
      continue;
    }

    const fields = [];
    let quoted;
    let field;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
