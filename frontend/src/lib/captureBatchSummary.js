export function captureBatchSummary(batch = {}) {
  const received = count(batch.received_item_count);
  const enriched = count(batch.enriched_item_count);
  const failed = count(batch.enrichment_failed_item_count);
  const expected = optionalCount(batch.expected_item_count);
  const reviewStatus = String(batch.review_status || batch.status || 'unknown');
  const hasIssues = reviewStatus === 'ready_with_issues' || failed > 0;
  return {
    statusLabel: titleCase(hasIssues && reviewStatus === 'ready' ? 'ready_with_issues' : reviewStatus),
    countLabel:
      enriched || failed ? `${enriched} of ${received} enriched${failed ? ` · ${failed} need retry` : ''}` : `${received} received`,
    expectedLabel: expected === null ? null : `${received} of ${expected} received`,
    hasIssues
  };
}

function optionalCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function count(value) {
  return optionalCount(value) ?? 0;
}

function titleCase(value) {
  const text = String(value || 'unknown').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
