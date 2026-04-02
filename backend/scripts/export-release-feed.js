'use strict';

const fs = require('fs');
const path = require('path');
const { loadReleaseNotesFeed } = require('../services/releaseNotes');

const outputPath = path.resolve(__dirname, '..', 'release-feed.json');
const releases = loadReleaseNotesFeed({ limit: 10 });
fs.writeFileSync(outputPath, JSON.stringify({ releases }, null, 2) + '\n', 'utf8');
console.log(`Wrote ${releases.length} release notes to ${outputPath}`);
