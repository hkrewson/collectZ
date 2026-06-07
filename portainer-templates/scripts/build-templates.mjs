#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const sourcesPath = path.join(rootDir, "sources.json");
const customPath = path.join(rootDir, "custom", "templates.json");
const outputPath = path.join(distDir, "templates.json");
const reportPath = path.join(distDir, "sources-report.json");
const TRUSTED_TEMPLATE_SOURCES = new Map([
  [
    "portainer-default-v3",
    "https://raw.githubusercontent.com/portainer/templates/v3/templates.json",
  ],
  [
    "tomchantler",
    "https://raw.githubusercontent.com/tomchantler/portainer-templates/master/templates.json",
  ],
]);

function templateKey(template) {
  const explicitId = template.id || template.Id || template.uuid;
  if (explicitId) {
    return `id:${String(explicitId)}`;
  }

  const normalizedTitle = String(template.title || template.name || "")
    .trim()
    .toLowerCase();
  const normalizedRepo = String(template.repository?.url || "")
    .trim()
    .toLowerCase();

  return `title:${normalizedTitle}|repo:${normalizedRepo}`;
}

function parseTemplateDocument(json, sourceLabel) {
  if (Array.isArray(json)) {
    return { version: "3", templates: json };
  }

  if (!json || typeof json !== "object" || !Array.isArray(json.templates)) {
    throw new Error(`${sourceLabel} did not contain a templates array`);
  }

  return {
    version: String(json.version || "3"),
    templates: json.templates,
  };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function fetchJson(url) {
  const body = await requestText(assertTrustedSourceUrl(url), 0);
  return JSON.parse(body);
}

function assertTrustedSourceUrl(url) {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:") {
    throw new Error("Template sources must use HTTPS");
  }

  const normalized = parsed.toString();
  if (![...TRUSTED_TEMPLATE_SOURCES.values()].includes(normalized)) {
    throw new Error(`Untrusted template source: ${normalized}`);
  }

  return normalized;
}

function assertTrustedSourceEntry(source) {
  const id = String(source?.id || "").trim();
  const expectedUrl = TRUSTED_TEMPLATE_SOURCES.get(id);
  if (!expectedUrl) {
    throw new Error(`Untrusted template source id: ${id || "unknown"}`);
  }

  const url = assertTrustedSourceUrl(source?.url);
  if (url !== expectedUrl) {
    throw new Error(`Unexpected URL for template source: ${id}`);
  }

  return { id, url };
}

function resolveDistOutputPath(targetPath) {
  const fullPath = path.resolve(targetPath);
  const distRoot = `${path.resolve(distDir)}${path.sep}`;
  if (!fullPath.startsWith(distRoot)) {
    throw new Error(`Invalid template output path: ${targetPath}`);
  }
  return fullPath;
}

function requestText(url, redirectCount) {
  const maxRedirects = 5;
  if (redirectCount > maxRedirects) {
    return Promise.reject(new Error("Too many redirects"));
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, (res) => {
      const statusCode = res.statusCode || 0;
      const location = res.headers.location;

      if (
        [301, 302, 303, 307, 308].includes(statusCode) &&
        typeof location === "string"
      ) {
        const redirectUrl = new URL(location, url).toString();
        res.resume();
        requestText(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });

    req.on("error", reject);
    req.setTimeout(20_000, () => {
      req.destroy(new Error("Request timed out"));
    });
  });
}

async function main() {
  const sourcesConfig = await readJson(sourcesPath);
  const sourceEntries = Array.isArray(sourcesConfig.sources)
    ? sourcesConfig.sources
    : [];

  const merged = new Map();
  const report = {
    generatedAt: new Date().toISOString(),
    sourceCount: sourceEntries.length + 1,
    outputPath,
    sources: [],
    errors: [],
  };

  for (const source of sourceEntries) {
    if (!source?.url || !source?.id) {
      report.errors.push("Invalid source entry in sources.json");
      continue;
    }

    try {
      const trustedSource = assertTrustedSourceEntry(source);
      const json = await fetchJson(trustedSource.url);
      const parsed = parseTemplateDocument(json, trustedSource.id);
      let added = 0;
      let replaced = 0;

      for (const template of parsed.templates) {
        const key = templateKey(template);
        if (merged.has(key)) {
          replaced += 1;
        } else {
          added += 1;
        }
        merged.set(key, template);
      }

      report.sources.push({
        id: trustedSource.id,
        kind: "remote",
        url: trustedSource.url,
        totalTemplates: parsed.templates.length,
        added,
        replaced,
      });
    } catch (error) {
      report.errors.push(
        `${source?.id || "unknown"}: ${error?.message || "Unknown fetch error"}`,
      );
    }
  }

  try {
    const customJson = await readJson(customPath);
    const parsedCustom = parseTemplateDocument(customJson, "custom/templates.json");
    let added = 0;
    let replaced = 0;

    for (const template of parsedCustom.templates) {
      const key = templateKey(template);
      if (merged.has(key)) {
        replaced += 1;
      } else {
        added += 1;
      }
      merged.set(key, template);
    }

    report.sources.push({
      id: "custom",
      kind: "local",
      path: customPath,
      totalTemplates: parsedCustom.templates.length,
      added,
      replaced,
    });
  } catch (error) {
    report.errors.push(`custom: ${error?.message || "Unknown read error"}`);
  }

  const templates = Array.from(merged.values()).sort((a, b) => {
    const left = String(a.title || a.name || "").toLowerCase();
    const right = String(b.title || b.name || "").toLowerCase();
    return left.localeCompare(right);
  });

  const output = {
    version: String(sourcesConfig.version || "3"),
    templates,
  };

  await mkdir(distDir, { recursive: true });
  await writeFile(
    resolveDistOutputPath(outputPath),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolveDistOutputPath(reportPath),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Built ${templates.length} templates (${report.errors.length} errors) -> ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
