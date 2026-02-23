const { parse } = require('csv-parse/sync');

function parseCsvText(text = '') {
  const source = String(text || '');
  const headerRows = parse(source, {
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    to_line: 1
  });
  const headers = Array.isArray(headerRows?.[0]) ? headerRows[0] : [];
  if (headers.length === 0) return { headers: [], rows: [] };

  const rows = parse(source, {
    bom: true,
    columns: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true
  });
  return {
    headers: headers.map((h) => String(h || '').trim()),
    rows: Array.isArray(rows) ? rows : []
  };
}

module.exports = {
  parseCsvText
};
