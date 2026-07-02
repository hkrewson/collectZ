export function getComicSeriesName(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const explicit = String(details.series || '').trim();
  if (explicit) return explicit;
  const title = String(item?.title || '').trim();
  const match = title.match(/^(.+?)\s+#\s*[\w.-]+/);
  if (match?.[1]) return match[1].trim();
  return title || 'Unknown Series';
}

export function extractComicIssueRaw(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const direct = String(details.issue_number || '').trim();
  if (direct) return direct.replace(/^#\s*/, '');
  const title = String(item?.title || '').trim();
  const match = title.match(/#\s*([A-Za-z0-9.-]+)/);
  if (match?.[1]) return String(match[1]).trim();
  return '';
}

export function parseComicIssueOrdinal(rawIssue = '') {
  const raw = String(rawIssue || '')
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim();
  if (!raw) return { kind: 2, num: Number.POSITIVE_INFINITY, suffix: '', pad: 0, raw: '' };

  const decimal = raw.match(/^(\d+)\.(\d+)(.*)$/);
  if (decimal) {
    return {
      kind: 0,
      num: Number(`${decimal[1]}.${decimal[2]}`),
      suffix: String(decimal[3] || '')
        .trim()
        .toLowerCase(),
      pad: decimal[1].length,
      raw
    };
  }

  const numeric = raw.match(/^(\d+)(.*)$/);
  if (numeric) {
    return {
      kind: 0,
      num: Number(numeric[1]),
      suffix: String(numeric[2] || '')
        .trim()
        .toLowerCase(),
      pad: numeric[1].length,
      raw
    };
  }

  return { kind: 1, num: Number.POSITIVE_INFINITY, suffix: raw.toLowerCase(), pad: 0, raw };
}

export function compareComicIssueOrder(aItem, bItem) {
  const a = parseComicIssueOrdinal(extractComicIssueRaw(aItem));
  const b = parseComicIssueOrdinal(extractComicIssueRaw(bItem));
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 0) {
    if (a.num !== b.num) return a.num - b.num;
    if (a.suffix !== b.suffix) {
      if (!a.suffix && b.suffix) return -1;
      if (a.suffix && !b.suffix) return 1;
      return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
    }
    if (a.num === 0 && a.pad !== b.pad) return b.pad - a.pad;
  }
  if (a.kind === 1 && a.suffix !== b.suffix) return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
  const aTitle = String(aItem?.title || '');
  const bTitle = String(bItem?.title || '');
  return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
}
