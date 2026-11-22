// solve.js — a fast drop-in for make.fun's csv-reader 1.0.0.
//
// run({ text, header }) returns csv-reader's reading of the input as
// { columns, rows, errors }:
//
//   - The text is read once, left to right, with commas and double quotes.
//     A U+FEFF at its very start is dropped.
//   - A record ends at LF or CRLF; a line left with no characters is no record.
//   - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//   - A field that opens with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote and each CRLF or lone CR inside it
//     is read as LF. What follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends).
//     A quote that never closes is a literal character, and the text after it
//     is read again as unquoted (unterminated_quote).
//   - A quote inside an unquoted field is a literal character.
//   - Fields stay strings, never trimmed or converted.
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with empty strings (short_row, with fields: its field count) or cut
//     (long_row, with extra: the cut fields) to the first record's width.
//   - Each error is { code, line, row }, in the order met; a record's
//     short_row or long_row when it ends. line is the 1-based line its record
//     starts on, counting every LF, CRLF and lone CR inside quotes; row is
//     its record's index in rows, null for the header.
//
// Speed: a record whose line holds no quote is dispatched with one native
// indexOf and split with String.split(','). Three lazily-refreshed cursors
// (first '"', '\r', '\n' at or after the parse position) make the
// quote/CR/LF checks O(1) per field and O(n) over the whole text, so a
// quoted field costs one indexOf scan for its close plus one slice — the
// close scan also reports whether any "" pair was seen, so the content
// needs no extra check for it. Unquoted fields are found with two native
// indexOf calls, so a lone CR inside one is just stripped from its slice.
// Quoted content is only processed with replace() when it contains "" or
// CRs. No regex exec and no per-character loop runs on the hot path.

const COMMA = 44; // ,
const QUOTE = 34; // "
const LF = 10; // \n
const CR = 13; // \r
const FEFF = 0xfeff;

export function run(input) {
  const s = input.text;
  const header = !!input.header;
  const n = s.length;
  let i = 0;
  if (n > 0 && s.charCodeAt(0) === FEFF) i = 1;

  const errors = [];
  const records = [];
  let width = 0;
  let line = 1;
  let replay = false; // set once a quote never closes: quotes are literal after it
  let recLine = 1; // line the record in progress starts on
  let recRow = null; // its index in rows, null for the header
  let endKind = 0; // how the last scanned segment ended: 0 comma, 1 LF, 2 CRLF, 3 EOF
  // Index of the first '"' / '\r' / '\n' at or after the parse position,
  // or -1. Each is refreshed only when the parse passes it, so the
  // quote/CR/LF checks are O(1) per field and O(n) over the whole text.
  // Before a cursor is used to answer a question about a range [a, b), it
  // must be refreshed to be at or after a: `if (c !== -1 && c < a) c =
  // s.indexOf(ch, a)`. Then "one lies in [a, b)" is `c !== -1 && c < b`.
  let nextQuote = s.indexOf('"', i);
  let nextCR = s.indexOf('\r', i);
  let nextLF = s.indexOf('\n', i);

  // Row index an error in the record in progress carries.
  function rowNow() {
    if (header) return records.length === 0 ? null : records.length - 1;
    return records.length;
  }

  // Return `seg` with every CR removed, one stray_cr error per CR removed.
  function cleanCRs(seg) {
    let count = 0;
    let k = seg.indexOf('\r');
    while (k !== -1) {
      count++;
      k = seg.indexOf('\r', k + 1);
    }
    for (let t = 0; t < count; t++) {
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
    }
    return count === 0 ? seg : seg.replace(/\r/g, '');
  }

  // Split one quoteless line segment into fields. `seg` holds no '"' (or
  // replay is on, where '"' is literal anyway); a trailing CRLF CR was
  // already cut, so any CR left in it is stray.
  function splitLine(seg) {
    if (seg.indexOf('\r') === -1) return seg.split(',');
    return cleanCRs(seg).split(',');
  }

  // Push a finished record, padding or cutting it to the first record's
  // width and recording its short_row / long_row error when it ends.
  function pushRecord(fields) {
    if (records.length === 0) {
      width = fields.length;
      records.push(fields);
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.slice(width) });
      fields.length = width;
    }
    records.push(fields);
  }

  // Scan one unquoted segment from i to the next comma, LF, CRLF or EOF.
  // The field is the slice to that terminator with lone CRs dropped
  // (stray_cr each); a CR that ends the slice just before its LF is the
  // CRLF, not a stray. Sets endKind, advances i past the terminator, and
  // returns the field. The LF bound comes from the nextLF cursor and the
  // CR check from the nextCR cursor, so no indexOf('\n') or indexOf('\r')
  // scan runs here.
  function scanSegment() {
    const start = i;
    if (nextLF !== -1 && nextLF < start) nextLF = s.indexOf('\n', start);
    if (nextCR !== -1 && nextCR < start) nextCR = s.indexOf('\r', start);
    const dC = s.indexOf(',', start);
    const dN = nextLF;
    let m;
    let isComma;
    if (dC === -1 && dN === -1) {
      m = -1;
      isComma = false;
    } else if (dN === -1 || (dC !== -1 && dC < dN)) {
      m = dC;
      isComma = true;
    } else {
      m = dN;
      isComma = false;
    }
    if (m === -1) {
      const seg = s.slice(start);
      i = n;
      endKind = 3;
      // A CR in [start, n) is stray; the cursor is the first one at or
      // after start, so one lies in range exactly when it is below n.
      if (nextCR === -1 || nextCR >= n) return seg;
      return cleanCRs(seg);
    }
    const seg = s.slice(start, m);
    i = m + 1;
    if (!isComma) line++;
    endKind = isComma ? 0 : 1;
    // A CR in [start, m): the cursor is below m exactly then.
    if (nextCR === -1 || nextCR >= m) return seg;
    const isCRLF = !isComma && m > start && s.charCodeAt(m - 1) === CR;
    if (isCRLF) endKind = 2;
    const body = isCRLF ? seg.slice(0, -1) : seg;
    // With a CRLF the only CR may be the line ending's own: one lies
    // before it exactly when the cursor is below m - 1.
    if (isCRLF && (nextCR === -1 || nextCR >= m - 1)) return body;
    return cleanCRs(body);
  }

  // Parse one record field by field (the line holds a quote). `i` is at the
  // record's first character; returns the record's fields. The quoted-field
  // close scan and its content handling are inlined here, so a quoted field
  // costs no helper call: one indexOf scan finds the close (and reports
  // whether any "" pair was seen), the CR/LF cursors say whether the
  // content holds a line break, and the content is one slice.
  function parseRecordSlow() {
    const fields = [];
    for (;;) {
      let field;
      if (!replay && s.charCodeAt(i) === QUOTE) {
        // Find the closing quote: the next quote that is not doubled.
        let close = -1;
        let hasDoubled = false;
        let j = i + 1;
        for (;;) {
          const q = s.indexOf('"', j);
          if (q === -1) break;
          if (s.charCodeAt(q + 1) === QUOTE) {
            hasDoubled = true;
            j = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is literal, the rest is unquoted.
          errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
          replay = true;
          i = i + 1;
          field = '"' + scanSegment();
          fields.push(field);
          if (endKind === 0) continue;
          return fields;
        }
        // The content is [i + 1, close). Refresh the CR/LF cursors to its
        // start, then their being below close says whether it holds a CR
        // or an LF. A '"' in the content is a doubled pair exactly when the
        // close scan saw one, so no extra check for it is needed.
        const cs = i + 1;
        if (nextCR !== -1 && nextCR < cs) nextCR = s.indexOf('\r', cs);
        if (nextLF !== -1 && nextLF < cs) nextLF = s.indexOf('\n', cs);
        const hasCR = nextCR !== -1 && nextCR < close;
        const hasNL = nextLF !== -1 && nextLF < close;
        let content;
        if (!hasCR && !hasNL) {
          content = s.slice(cs, close);
          if (hasDoubled) content = content.replace(/""/g, '"');
        } else {
          // Count the line breaks the content holds: each LF, plus each
          // CR not followed by LF. Start each count at the cursor, the
          // first break of that kind at or after the content's start.
          let breaks = 0;
          if (hasNL) {
            let k = nextLF;
            while (k !== -1 && k < close) {
              breaks++;
              k = s.indexOf('\n', k + 1);
            }
          }
          if (hasCR) {
            let k = nextCR;
            while (k !== -1 && k < close) {
              if (s.charCodeAt(k + 1) !== LF) breaks++;
              k = s.indexOf('\r', k + 1);
            }
          }
          line += breaks;
          content = s.slice(cs, close);
          if (hasDoubled) content = content.replace(/""/g, '"');
          if (hasCR) content = content.replace(/\r\n?/g, '\n');
        }
        i = close + 1;
        // What follows the closing quote, up to the next comma or line
        // break, is junk appended as it stands. Usually there is none: the
        // next character itself ends the field, so check it directly and
        // only scan for junk when a character actually follows.
        const c = s.charCodeAt(i);
        if (c === COMMA) {
          endKind = 0;
          i++;
          field = content;
        } else if (c === LF) {
          endKind = 1;
          line++;
          i++;
          field = content;
        } else if (c === CR && s.charCodeAt(i + 1) === LF) {
          endKind = 2;
          line++;
          i += 2;
          field = content;
        } else if (i >= n) {
          endKind = 3;
          field = content;
        } else {
          const junk = scanSegment();
          if (junk.length > 0) {
            errors.push({ code: 'quote_junk', line: recLine, row: recRow });
          }
          field = junk.length === 0 ? content : content + junk;
        }
        fields.push(field);
        if (endKind === 0) continue;
        return fields;
      }
      field = scanSegment();
      fields.push(field);
      if (endKind === 0) continue;
      return fields;
    }
  }

  while (i < n) {
    // Skip lines left with no characters.
    for (;;) {
      const c = s.charCodeAt(i);
      if (c === LF) {
        i++;
        line++;
      } else if (c === CR && s.charCodeAt(i + 1) === LF) {
        i += 2;
        line++;
      } else {
        break;
      }
    }
    if (i >= n) break;

    recLine = line;
    recRow = rowNow();

    // Lone CRs at the line's start are dropped (stray_cr each). If the
    // line then ends, it held no characters and is no record.
    while (i < n && s.charCodeAt(i) === CR && s.charCodeAt(i + 1) !== LF) {
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      i++;
    }
    if (i >= n) break;
    if (s.charCodeAt(i) === LF) {
      i++;
      line++;
      continue;
    }
    if (s.charCodeAt(i) === CR) {
      i += 2;
      line++;
      continue;
    }

    if (!replay && nextQuote !== -1 && nextQuote < i) {
      nextQuote = s.indexOf('"', i);
    }
    if (nextLF !== -1 && nextLF < i) nextLF = s.indexOf('\n', i);
    const lf = nextLF;
    const end = lf === -1 ? n : lf;
    if (!replay && nextQuote !== -1 && nextQuote < end) {
      pushRecord(parseRecordSlow());
    } else {
      // No quote before the line ends (or quotes are literal now): the
      // whole record is this line.
      let seg = s.slice(i, end);
      if (lf !== -1 && seg.charCodeAt(seg.length - 1) === CR) seg = seg.slice(0, -1);
      pushRecord(splitLine(seg));
      i = lf === -1 ? n : lf + 1;
      if (lf !== -1) line++;
    }
  }

  return {
    columns: header ? (records.length === 0 ? null : records[0]) : null,
    rows: header ? records.slice(1) : records,
    errors,
  };
}
