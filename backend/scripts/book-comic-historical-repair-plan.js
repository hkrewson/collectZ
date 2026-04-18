'use strict';

const pool = require('../db/pool');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  detectLikelyComicLikeBook,
  groupRowsByNormalizationKey,
  buildHistoricalRepairPlan
} = require('../services/bookComicNormalization');

function parseArgs(argv = []) {
  const args = {
    json: false,
    limit: 25
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const value = Number(token.split('=')[1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 100);
      continue;
    }
    if (token === '--limit') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 100);
      i += 1;
    }
  }
  return args;
}

async function loadRows() {
  const result = await pool.query(
    `SELECT id, title, media_type, import_source, library_id, space_id, type_details
       FROM media
      WHERE media_type IN ('book', 'comic_book')
      ORDER BY media_type, id ASC`
  );
  return result.rows || [];
}

function limitPlan(plan = {}, limit = 25) {
  return {
    ...plan,
    safeAutoAttachDuplicateClusters: (plan.safeAutoAttachDuplicateClusters || []).slice(0, limit),
    reviewDuplicateClusters: (plan.reviewDuplicateClusters || []).slice(0, limit),
    likelyTypeRepairs: (plan.likelyTypeRepairs || []).slice(0, limit)
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await loadRows();
  const books = rows.filter((row) => row.media_type === 'book');
  const comics = rows.filter((row) => row.media_type === 'comic_book');

  const likelyComicLikeBooks = books
    .map((row) => ({
      row,
      signal: detectLikelyComicLikeBook(row)
    }))
    .filter(({ signal }) => signal.likely);

  const duplicateBookClusters = groupRowsByNormalizationKey(books, buildBookNormalizationIdentity)
    .filter((bucket) => bucket.confidence !== 'low')
    .sort((left, right) => right.rows.length - left.rows.length || left.key.localeCompare(right.key));

  const duplicateComicClusters = groupRowsByNormalizationKey(comics, buildComicNormalizationIdentity)
    .filter((bucket) => bucket.confidence !== 'low')
    .sort((left, right) => right.rows.length - left.rows.length || left.key.localeCompare(right.key));

  const plan = limitPlan(buildHistoricalRepairPlan({
    duplicateBookClusters,
    duplicateComicClusters,
    likelyComicLikeBooks
  }), options.limit);

  const report = {
    totals: {
      books: books.length,
      comics: comics.length
    },
    ...plan
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Book and Comic Historical Repair Plan (Dry Run)');
  console.log('===============================================');
  console.log(`Books: ${report.totals.books}`);
  console.log(`Comics: ${report.totals.comics}`);
  console.log(`Safe auto-attach duplicate clusters: ${report.summary.safeAutoAttachDuplicateClusters}`);
  console.log(`Review duplicate clusters: ${report.summary.reviewDuplicateClusters}`);
  console.log(`Likely type repairs: ${report.summary.likelyTypeRepairs}`);
  console.log('');

  console.log('Safe auto-attach duplicate clusters:');
  report.safeAutoAttachDuplicateClusters.forEach((cluster) => {
    console.log(`- ${cluster.key} => keep [${cluster.canonical.media_type}:${cluster.canonical.id}] ${cluster.canonical.title} and attach ${cluster.duplicates.length} duplicate(s)`);
  });
  console.log('');

  console.log('Review duplicate clusters:');
  report.reviewDuplicateClusters.forEach((cluster) => {
    console.log(`- ${cluster.key} => review [${cluster.canonical.media_type}:${cluster.canonical.id}] ${cluster.canonical.title} with ${cluster.duplicates.length} related duplicate(s)`);
  });
  console.log('');

  console.log('Likely type repairs:');
  report.likelyTypeRepairs.forEach((repair) => {
    console.log(`- [book:${repair.source.id}] ${repair.source.title} (${repair.reasons.join(', ')})`);
  });
}

run()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
