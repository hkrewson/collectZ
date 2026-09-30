#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PERMISSIONS } = require('../services/authorizationPolicy');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const snapshotPath = path.join(backendRoot, 'config', 'workspace-ownership-contract.json');
const initSqlPath = path.join(repoRoot, 'init.sql');

const TABLE_CATEGORIES = Object.freeze([
  'installation_owned',
  'workspace_owned',
  'library_owned',
  'user_owned',
  'shared_reference',
  'authorization_control_plane'
]);

const TABLE_OVERRIDES = Object.freeze({
  users: ['authorization_control_plane', 'id', 'Identity root; active scope is a pointer, not ownership.'],
  invites: ['authorization_control_plane', 'space_id', 'Invitation lifecycle is authorization state scoped to a workspace.'],
  spaces: ['authorization_control_plane', 'id', 'Workspace root.'],
  space_memberships: ['authorization_control_plane', 'space_id', 'Workspace authorization edge.'],
  library_memberships: ['authorization_control_plane', 'library_id', 'Library authorization edge; library must belong to the same workspace membership.'],
  activity_log: ['authorization_control_plane', 'user_id', 'Installation audit ledger; scoped entity identifiers must be independently authorized.'],
  user_sessions: ['authorization_control_plane', 'user_id', 'Authentication session and temporary support-scope state.'],
  password_reset_tokens: ['authorization_control_plane', 'user_id', 'Credential recovery state.'],
  email_verification_tokens: ['authorization_control_plane', 'user_id', 'Identity verification state.'],
  personal_access_tokens: ['authorization_control_plane', 'user_id', 'User authentication credential metadata.'],
  mobile_auth_sessions: ['authorization_control_plane', 'user_id', 'Mobile authentication credential metadata.'],
  service_account_keys: ['authorization_control_plane', 'owner_user_id', 'Service authentication credential metadata.'],
  support_requests: ['authorization_control_plane', 'requester_user_id', 'Support authorization workflow.'],
  support_request_messages: ['authorization_control_plane', 'support_request_id', 'Inherits support authorization from support_requests.'],
  app_settings: ['installation_owned', 'id', 'Installation runtime configuration.'],
  feature_flags: ['installation_owned', 'key', 'Installation capability configuration.'],
  schema_migrations: ['installation_owned', 'version', 'Database bootstrap control record.'],
  genres: ['shared_reference', 'id', 'Normalized shared metadata vocabulary.'],
  directors: ['shared_reference', 'id', 'Normalized shared metadata vocabulary.'],
  actors: ['shared_reference', 'id', 'Normalized shared metadata vocabulary.'],
  collectible_categories: ['shared_reference', 'id', 'Canonical shared collectible taxonomy.'],
  user_integrations: ['user_owned', 'user_id', 'Private integration configuration owned by one user.'],
  app_integrations: ['workspace_owned', 'space_id', 'Workspace provider configuration; a documented nullable installation compatibility row remains only for installation runtime settings.'],
  sync_jobs: ['workspace_owned', 'scope.spaceId', 'Durable jobs must persist workspace and library ownership in the structured scope payload.']
});

const ROUTE_MODULE_POLICIES = Object.freeze({
  'admin.js': ['platform', PERMISSIONS.PLATFORM_READ, PERMISSIONS.PLATFORM_MANAGE, 'installation'],
  'auth.js': ['identity', PERMISSIONS.ACCOUNT_READ, PERMISSIONS.ACCOUNT_MANAGE, 'identity'],
  'captureItems.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'collectibleTraits.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'collectibles.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'core.js': ['public', null, null, 'none'],
  'dashboard.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'events.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'integrations.js': ['platform', PERMISSIONS.PLATFORM_READ, PERMISSIONS.PLATFORM_MANAGE, 'installation_or_token_resolved_workspace'],
  'libraries.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'explicit_or_active_workspace_library'],
  'media.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library'],
  'mobileAuth.js': ['identity', PERMISSIONS.ACCOUNT_READ, PERMISSIONS.ACCOUNT_MANAGE, 'identity'],
  'objectRelationships.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'owner_record_workspace'],
  'spaceIntegrations.js': ['workspace', PERMISSIONS.WORKSPACE_INTEGRATIONS_READ, PERMISSIONS.WORKSPACE_INTEGRATIONS_MANAGE, 'explicit_workspace'],
  'spaces.js': ['workspace', PERMISSIONS.WORKSPACE_MEMBERS_READ, PERMISSIONS.WORKSPACE_MEMBERS_MANAGE, 'explicit_workspace'],
  'support.js': ['identity', PERMISSIONS.ACCOUNT_READ, PERMISSIONS.ACCOUNT_MANAGE, 'requester_or_staff'],
  'wishlist.js': ['workspace', PERMISSIONS.WORKSPACE_CONTENT_READ, PERMISSIONS.WORKSPACE_CONTENT_MANAGE, 'active_workspace_library']
});

const GLOBALLY_AUTHENTICATED_MODULES = new Set([
  'admin.js', 'captureItems.js', 'collectibleTraits.js', 'collectibles.js', 'dashboard.js', 'events.js',
  'libraries.js', 'media.js', 'objectRelationships.js', 'spaces.js', 'wishlist.js'
]);

const EXECUTION_PATHS = Object.freeze([
  ['sync_jobs', 'routes/media.js', /space_id|spaceId/, 'target_record_or_enqueued_scope'],
  ['plex_webhook', 'services/plexWebhookReceiver.js', /space_id|spaceId/, 'receiver_token_workspace'],
  ['plex_reconciliation', 'routes/media.js', /plex_reconciliation[\s\S]{0,5000}(spaceId|space_id)/, 'configured_workspace'],
  ['plex_readback', 'routes/media.js', /watch_state[\s\S]{0,5000}(spaceId|space_id)/, 'configured_workspace'],
  ['capture_ocr', 'routes/captureItems.js', /loadWorkspaceOcrIntegrationConfig/, 'capture_record_workspace'],
  ['valuation_refresh', 'routes/media.js', /loadWorkspaceValuationIntegrationConfig/, 'target_record_workspace'],
  ['workspace_export', 'routes/spaceIntegrations.js', /spaceId|space_id/, 'explicit_workspace'],
  ['media_search', 'routes/media.js', /scopeContext|space_id|library_id/, 'authenticated_scope_context'],
  ['activity_audit', 'services/audit.js', /entityType|entity_id|userId/, 'actor_and_target_metadata'],
  ['comic_poster_repair', 'scripts/repair-comic-posters.js', /--space-id[\s\S]*loadWorkspace/, 'required_workspace_argument'],
  ['comic_identity_repair', 'scripts/repair-comic-issue-mismatches.js', /--space-id[\s\S]*loadWorkspace/, 'required_workspace_argument']
]);

function extractTables(sql) {
  const entries = [];
  const pattern = /CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    const body = match[2];
    const columns = Array.from(body.matchAll(/^\s*([a-z][a-z0-9_]*)\s+[A-Z]/gm), (item) => item[1]);
    const foreignKeys = Array.from(
      body.matchAll(/^\s*([a-z][a-z0-9_]*)\s+[^\n]*REFERENCES\s+([a-z0-9_]+)\s*\(/gim),
      (item) => ({ column: item[1], referencesTable: item[2] })
    );
    const references = foreignKeys.map((entry) => entry.referencesTable);
    entries.push({ name, body, columns, foreignKeys, references });
  }
  return entries;
}

function classifyTables(tables) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const resolved = new Map();
  const resolve = (table, stack = []) => {
    if (resolved.has(table.name)) return resolved.get(table.name);
    assert(!stack.includes(table.name), `Circular ownership inference for ${table.name}`);
    const override = TABLE_OVERRIDES[table.name];
    if (override) {
      const result = { category: override[0], ownershipKey: override[1], rationale: override[2] };
      resolved.set(table.name, result);
      return result;
    }
    let result = null;
    if (table.columns.includes('library_id')) {
      result = { category: 'library_owned', ownershipKey: 'library_id', rationale: 'Direct library ownership; the library supplies the workspace boundary.' };
    } else if (table.columns.includes('space_id')) {
      result = { category: 'workspace_owned', ownershipKey: 'space_id', rationale: 'Direct workspace ownership.' };
    } else if (table.columns.includes('user_id')) {
      result = { category: 'user_owned', ownershipKey: 'user_id', rationale: 'Direct user ownership.' };
    } else if (table.columns.includes('owner_user_id')) {
      result = { category: 'user_owned', ownershipKey: 'owner_user_id', rationale: 'Direct user ownership.' };
    } else {
      for (const reference of table.references) {
        const parent = byName.get(reference);
        if (!parent || stack.includes(reference)) continue;
        const parentPolicy = resolve(parent, [...stack, table.name]);
        if (['workspace_owned', 'library_owned', 'user_owned'].includes(parentPolicy.category)) {
          result = {
            category: parentPolicy.category,
            ownershipKey: `${reference}.${parentPolicy.ownershipKey}`,
            rationale: `Ownership inherited through the ${reference} foreign key.`
          };
          break;
        }
      }
    }
    assert(result, `Table ${table.name} has no ownership classification`);
    resolved.set(table.name, result);
    return result;
  };
  return tables.map((table) => {
    const policy = resolve(table);
    const sameWorkspaceForeignKeys = table.foreignKeys
      .filter(({ referencesTable }) => {
        const parent = byName.get(referencesTable);
        if (!parent) return false;
        const parentPolicy = resolve(parent);
        return referencesTable === 'spaces' || ['workspace_owned', 'library_owned'].includes(parentPolicy.category);
      })
      .map(({ column, referencesTable }) => ({
        column,
        referencesTable,
        expectation: 'same_workspace'
      }));
    return {
      name: table.name,
      ...policy,
      sameWorkspaceForeignKeys
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function extractRoutes() {
  const routeDir = path.join(backendRoot, 'routes');
  const entries = [];
  for (const file of fs.readdirSync(routeDir).filter((name) => name.endsWith('.js')).sort()) {
    const policy = ROUTE_MODULE_POLICIES[file];
    const source = fs.readFileSync(path.join(routeDir, file), 'utf8');
    const pattern = /\b(router|commonRouter|sharedRouter|platformRouter)\.(get|post|put|patch|delete)\s*\(\s*([^,\n]+)/g;
    let ordinal = 0;
    for (const match of source.matchAll(pattern)) {
      assert(policy, `Route module ${file} has declarations but no route ownership policy`);
      ordinal += 1;
      const method = match[2].toUpperCase();
      const routeExpression = match[3].trim().replace(/\s+/g, ' ');
      const declaration = source.slice(match.index, match.index + 700).split('\n\n')[0];
      const explicitlyAuthenticated = /authenticateToken|requireSessionAuth|requireRole\(/.test(declaration);
      const authenticated = GLOBALLY_AUTHENTICATED_MODULES.has(file) || explicitlyAuthenticated;
      const mutation = !['GET', 'HEAD'].includes(method);
      entries.push({
        id: `${file}:${match[1]}:${method}:${routeExpression}:${ordinal}`,
        module: file,
        router: match[1],
        method,
        routeExpression,
        ownership: policy[0],
        permission: authenticated ? (mutation ? policy[2] : policy[1]) : null,
        scopeSource: policy[3],
        authentication: authenticated ? 'required' : 'public_or_token_authenticated',
        csrf: mutation ? 'global_cookie_policy' : 'not_applicable',
        reauthentication: /requireSessionAuth/.test(declaration) ? 'session_credential_required' : 'not_required',
        locality: policy[0] === 'platform' ? 'control_plane' : 'core_local'
      });
    }
  }
  return entries;
}

function certifyExecutionPaths({ deferPrerequisites = false } = {}) {
  return EXECUTION_PATHS.map(([id, relativePath, evidencePattern, scopeSource]) => {
    const absolutePath = path.join(backendRoot, relativePath);
    assert(fs.existsSync(absolutePath), `Maintained execution path is missing: ${relativePath}`);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const certified = evidencePattern.test(source);
    if (!certified && !deferPrerequisites) {
      throw new Error(`Execution path ${id} lacks explicit workspace evidence in ${relativePath}`);
    }
    return { id, path: relativePath, scopeSource, status: certified ? 'certified' : 'pending_prerequisite' };
  });
}

function buildContract({ deferPrerequisites = false } = {}) {
  const tables = classifyTables(extractTables(fs.readFileSync(initSqlPath, 'utf8')));
  for (const table of tables) assert(TABLE_CATEGORIES.includes(table.category), `Invalid category for ${table.name}`);
  const routes = extractRoutes();
  assert(routes.length >= 300, `Expected the maintained route inventory to contain at least 300 declarations; found ${routes.length}`);
  const executionPaths = certifyExecutionPaths({ deferPrerequisites });
  return {
    schemaVersion: 1,
    permissionKeys: Object.values(PERMISSIONS).sort(),
    tables,
    routes,
    executionPaths
  };
}

function stable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const deferPrerequisites = process.argv.includes('--defer-prerequisites');
  const actual = buildContract({ deferPrerequisites });
  if (process.argv.includes('--write')) {
    fs.writeFileSync(snapshotPath, stable(actual), 'utf8');
    console.log(`Workspace ownership contract written: ${snapshotPath}`);
    return;
  }
  assert(fs.existsSync(snapshotPath), 'Workspace ownership contract snapshot is missing; review and generate it with --write');
  const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  assert.deepStrictEqual(actual, expected, 'Workspace ownership contract drifted; classify and review every changed table, route, permission, and execution path');
  console.log(`Workspace ownership certification passed: ${actual.tables.length} tables, ${actual.routes.length} routes, ${actual.executionPaths.length} execution paths`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Workspace ownership certification failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildContract, classifyTables, extractTables, extractRoutes };
