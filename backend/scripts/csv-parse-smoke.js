const assert = require('assert');
const { parseCsvText } = require('../services/csv');

const csvWithQuotedComma = `title,notes
"Alien","Sci-fi, horror classic"
`;
const parsedQuoted = parseCsvText(csvWithQuotedComma);
assert.strictEqual(parsedQuoted.rows.length, 1);
assert.strictEqual(parsedQuoted.rows[0].notes, 'Sci-fi, horror classic');

const csvWithEscapedQuote = `title,notes
"Heat","Contains ""Director's Cut"" edition"
`;
const parsedEscaped = parseCsvText(csvWithEscapedQuote);
assert.strictEqual(parsedEscaped.rows.length, 1);
assert.strictEqual(parsedEscaped.rows[0].notes, `Contains "Director's Cut" edition`);

const csvWithMultiline = `title,notes
"Dune","Line one
line two"
`;
const parsedMultiline = parseCsvText(csvWithMultiline);
assert.strictEqual(parsedMultiline.rows.length, 1);
assert.strictEqual(parsedMultiline.rows[0].notes, 'Line one\nline two');

console.log('csv-parse smoke checks passed');
