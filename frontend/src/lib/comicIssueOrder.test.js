import { describe, expect, it } from 'vitest';
import { compareComicIssueOrder, extractComicIssueRaw, getComicSeriesName, parseComicIssueOrdinal } from './comicIssueOrder';

describe('comic issue ordering helpers', () => {
  it('prefers explicit series names before deriving from the title', () => {
    expect(getComicSeriesName({ title: 'Detective Comics #27', type_details: { series: 'Batman' } })).toBe('Batman');
    expect(getComicSeriesName({ title: 'Detective Comics #27' })).toBe('Detective Comics');
    expect(getComicSeriesName({ title: '' })).toBe('Unknown Series');
  });

  it('extracts issue numbers from details or title text', () => {
    expect(extractComicIssueRaw({ title: 'X-Men #1', type_details: { issue_number: '#001' } })).toBe('001');
    expect(extractComicIssueRaw({ title: 'X-Men #1.A' })).toBe('1.A');
    expect(extractComicIssueRaw({ title: 'X-Men Annual' })).toBe('');
  });

  it('parses numeric, decimal, suffix, and text issue labels into stable ordinal shapes', () => {
    expect(parseComicIssueOrdinal('Issue 7B')).toMatchObject({ kind: 0, num: 7, suffix: 'b' });
    expect(parseComicIssueOrdinal('#0.5')).toMatchObject({ kind: 0, num: 0.5, suffix: '' });
    expect(parseComicIssueOrdinal('Alpha')).toMatchObject({ kind: 1, suffix: 'alpha' });
    expect(parseComicIssueOrdinal('')).toMatchObject({ kind: 2 });
  });

  it('sorts issues by numeric order, base issue before suffix, and title fallback', () => {
    const sorted = [
      { title: 'Series #10' },
      { title: 'Series #1B' },
      { title: 'Series #1' },
      { title: 'Series #0.5' },
      { title: 'Series Alpha' }
    ].sort(compareComicIssueOrder);

    expect(sorted.map((item) => item.title)).toEqual(['Series #0.5', 'Series #1', 'Series #1B', 'Series #10', 'Series Alpha']);
  });
});
