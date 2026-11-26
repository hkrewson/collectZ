import { describe, expect, it } from 'vitest';
import { captureBatchSummary } from './captureBatchSummary';

describe('captureBatchSummary', () => {
  it('reports ready with issues when any received edition failed enrichment', () => {
    expect(
      captureBatchSummary({
        status: 'ready',
        review_status: 'ready_with_issues',
        received_item_count: 103,
        enriched_item_count: 68,
        enrichment_failed_item_count: 35,
        expected_item_count: null
      })
    ).toEqual({
      statusLabel: 'Ready with issues',
      countLabel: '68 of 103 enriched · 35 need retry',
      expectedLabel: null,
      hasIssues: true
    });
  });
});
