'use strict';

function optionalNonNegativeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function deriveCaptureBatchReviewStatus(status, enrichmentFailedItemCount = 0) {
  if (status === 'ready' && optionalNonNegativeInt(enrichmentFailedItemCount) > 0) return 'ready_with_issues';
  return status;
}

module.exports = { optionalNonNegativeInt, deriveCaptureBatchReviewStatus };
