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
// indexOf and split with String.split(','); a `nextQuote` cursor makes the
// quote check O(1) per record and O(n) over the whole text (it is refreshed
// only when the parse passes it). Unquoted fields are found with two native
// indexOf calls, so a lone CR inside one is just stripped from its slice.
// Quoted fields are found with indexOf scans and only processed with
// replace() when they contain "" or CRs. No regex exec and no per-character
// loop runs on the hot path.

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
  // Index of the first '"' at or after the parse position, or -1. Refreshed
  // only when the parse passes it, so the quote check is O(1) per record.
  let nextQuote = s.indexOf('"', i);

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
  // returns the field.
  function scanSegment() {
    const dC = s.indexOf(',', i);
    const dN = s.indexOf('\n', i);
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
      const seg = s.slice(i);
      i = n;
      endKind = 3;
      return seg.indexOf('\r') === -1 ? seg : cleanCRs(seg);
    }
    const seg = s.slice(i, m);
    i = m + 1;
    if (!isComma) line++;
    endKind = isComma ? 0 : 1;
    if (seg.indexOf('\r') === -1) return seg;
    const isCRLF = !isComma && seg.charCodeAt(seg.length - 1) === CR;
    if (isCRLF) endKind = 2;
    const body = isCRLF ? seg.slice(0, -1) : seg;
    return body.indexOf('\r') === -1 ? body : cleanCRs(body);
  }

  // Index of the next quote that is not doubled, at or after `from`;
  // -1 when the field never closes.
  function findClose(from) {
    let j = from;
    for (;;) {
      const q = s.indexOf('"', j);
      if (q === -1) return -1;
      if (s.charCodeAt(q + 1) === QUOTE) {
        j = q + 2;
        continue;
      }
      return q;
    }
  }

  // Turn a quoted field's raw content into its value: "" is one quote,
  // each CRLF or lone CR is LF. Counts the line breaks it holds.
  function quotedContent(raw) {
    if (raw.indexOf('"') === -1 && raw.indexOf('\r') === -1) {
      if (raw.indexOf('\n') !== -1) {
        let count = 0;
        let k = raw.indexOf('\n');
        while (k !== -1) {
          count++;
          k = raw.indexOf('\n', k + 1);
        }
        line += count;
      }
      return raw;
    }
    let breaks = 0;
    let k = raw.indexOf('\n');
    while (k !== -1) {
      breaks++;
      k = raw.indexOf('\n', k + 1);
    }
    k = raw.indexOf('\r');
    while (k !== -1) {
      if (raw.charCodeAt(k + 1) !== LF) breaks++;
      k = raw.indexOf('\r', k + 1);
    }
    line += breaks;
    let out = raw;
    if (out.indexOf('"') !== -1) out = out.replace(/""/g, '"');
    if (out.indexOf('\r') !== -1) out = out.replace(/\r\n?/g, '\n');
    return out;
  }

  // Parse one record field by field (the line holds a quote). `i` is at the
  // record's first character; returns the record's fields.
  function parseRecordSlow() {
    const fields = [];
    for (;;) {
      let field;
      if (!replay && s.charCodeAt(i) === QUOTE) {
        const close = findClose(i + 1);
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
        const content = quotedContent(s.slice(i + 1, close));
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
    const lf = s.indexOf('\n', i);
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
