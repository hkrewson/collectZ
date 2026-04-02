const fs = require('fs');
const path = require('path');

const RELEASES_DIR = path.resolve(__dirname, '..', '..', 'docs', 'releases');
const RELEASE_FEED_SNAPSHOT_PATH = path.resolve(__dirname, '..', 'release-feed.json');

function compareReleaseVersions(a, b) {
  const left = String(a || '').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const right = String(b || '').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function extractSection(markdown, heading) {
  const lines = String(markdown || '').split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex < 0) return '';

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function parseWhatChanged(markdown) {
  const section = extractSection(markdown, 'What Changed');
  if (!section) return [];

  const lines = section.split('\n');
  const details = [];
  let current = null;

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      current = { heading: line.replace(/^###\s+/, '').trim(), bullets: [] };
      details.push(current);
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (!current) {
        current = { heading: 'Highlights', bullets: [] };
        details.push(current);
      }
      current.bullets.push(line.replace(/^-\s+/, '').trim());
    }
  }

  return details.filter((entry) => entry.bullets.length > 0 || entry.heading);
}

function parseReleaseMarkdown(markdown, fallbackVersion = '') {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  const versionMatch = markdown.match(/^- Version:\s+`([^`]+)`/m);
  const dateMatch = markdown.match(/^- Date:\s+`([^`]+)`/m);
  const statusMatch = markdown.match(/^- Status:\s+`([^`]+)`/m);
  const summary = extractSection(markdown, 'Summary')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  return {
    title: headingMatch ? headingMatch[1].trim() : fallbackVersion,
    version: versionMatch ? versionMatch[1].trim() : fallbackVersion,
    date: dateMatch ? dateMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    summary,
    details: parseWhatChanged(markdown)
  };
}

function loadReleaseNotesFeed({ limit = 6 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(20, Number(limit) || 6));
  if (fs.existsSync(RELEASES_DIR)) {
    const files = fs.readdirSync(RELEASES_DIR)
      .filter((name) => /^v\d+\.\d+\.\d+\.md$/i.test(name))
      .sort(compareReleaseVersions);

    if (files.length > 0) {
      return files.slice(0, normalizedLimit).map((fileName) => {
        const raw = fs.readFileSync(path.join(RELEASES_DIR, fileName), 'utf8');
        const version = fileName.replace(/\.md$/i, '');
        return parseReleaseMarkdown(raw, version);
      });
    }
  }

  if (!fs.existsSync(RELEASE_FEED_SNAPSHOT_PATH)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(RELEASE_FEED_SNAPSHOT_PATH, 'utf8'));
    const releases = Array.isArray(payload?.releases) ? payload.releases : [];
    return releases.slice(0, normalizedLimit);
  } catch (_) {
    return [];
  }
}

module.exports = {
  compareReleaseVersions,
  parseReleaseMarkdown,
  loadReleaseNotesFeed
};
