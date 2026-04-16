'use strict';

const pool = require('../db/pool');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  detectLikelyComicLikeBook,
  groupRowsByNormalizationKey
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
    `SELECT id, title, media_type, import_source, library_id, type_details
       FROM media
      WHERE media_type IN ('book', 'comic_book')
      ORDER BY media_type, id ASC`
  );
  return result.rows || [];
}

function summarizeCluster(cluster = {}) {
  return {
    key: cluster.key,
    confidence: cluster.confidence,
    kind: cluster.kind,
    count: cluster.rows.length,
    sample: cluster.rows.slice(0, 6).map((row) => ({
      id: row.id,
      media_type: row.media_type,
      title: row.title,
      provider: row.type_details?.provider_name || null,
      provider_item_id: row.type_details?.provider_item_id || null,
      series: row.type_details?.series || null,
      issue_number: row.type_details?.issue_number || null,
      isbn: row.type_details?.isbn || null
    }))
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
    .filter(({ signal }) => signal.likely)
    .map(({ row, signal }) => ({
      id: row.id,
      title: row.title,
      provider: row.type_details?.provider_name || null,
      isbn: row.type_details?.isbn || null,
      reasons: signal.reasons
    }));

  const duplicateBookClusters = groupRowsByNormalizationKey(books, buildBookNormalizationIdentity)
    .filter((bucket) => bucket.confidence !== 'low')
    .sort((left, right) => right.rows.length - left.rows.length || left.key.localeCompare(right.key));
  const duplicateComicClusters = groupRowsByNormalizationKey(comics, buildComicNormalizationIdentity)
    .filter((bucket) => bucket.confidence !== 'low')
    .sort((left, right) => right.rows.length - left.rows.length || left.key.localeCompare(right.key));

  const report = {
    totals: {
      books: books.length,
      comics: comics.length
    },
    identifierCoverage: {
      booksWithIsbn: books.filter((row) => String(row.type_details?.isbn || '').trim()).length,
      comicsWithSeries: comics.filter((row) => String(row.type_details?.series || '').trim()).length,
      comicsWithIssueNumber: comics.filter((row) => String(row.type_details?.issue_number || '').trim()).length,
      booksByProvider: books.reduce((acc, row) => {
        const key = String(row.type_details?.provider_name || 'unattributed').trim() || 'unattributed';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      comicsByProvider: comics.reduce((acc, row) => {
        const key = String(row.type_details?.provider_name || 'unattributed').trim() || 'unattributed';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    },
    likelyComicLikeBooks: likelyComicLikeBooks.slice(0, options.limit),
    duplicateBookClusters: duplicateBookClusters.slice(0, options.limit).map(summarizeCluster),
    duplicateComicClusters: duplicateComicClusters.slice(0, options.limit).map(summarizeCluster)
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Book and Comic Sync Normalization Audit');
  console.log('=======================================');
  console.log(`Books: ${report.totals.books}`);
  console.log(`Comics: ${report.totals.comics}`);
  console.log(`Books with ISBN: ${report.identifierCoverage.booksWithIsbn}`);
  console.log(`Comics with series: ${report.identifierCoverage.comicsWithSeries}`);
  console.log(`Comics with issue number: ${report.identifierCoverage.comicsWithIssueNumber}`);
  console.log('');
  console.log('Book provider coverage:', report.identifierCoverage.booksByProvider);
  console.log('Comic provider coverage:', report.identifierCoverage.comicsByProvider);
  console.log('');
  console.log(`Likely comic-like books: ${likelyComicLikeBooks.length}`);
  likelyComicLikeBooks.slice(0, options.limit).forEach((row) => {
    console.log(`- [book:${row.id}] ${row.title} (${row.reasons.join(', ')})`);
  });
  console.log('');
  console.log(`Duplicate book clusters (high/medium confidence): ${duplicateBookClusters.length}`);
  duplicateBookClusters.slice(0, options.limit).forEach((cluster) => {
    console.log(`- ${cluster.key} (${cluster.rows.length} rows)`);
  });
  console.log('');
  console.log(`Duplicate comic clusters (high/medium confidence): ${duplicateComicClusters.length}`);
  duplicateComicClusters.slice(0, options.limit).forEach((cluster) => {
    console.log(`- ${cluster.key} (${cluster.rows.length} rows)`);
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
