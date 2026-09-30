const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const contractPath = path.join(backendRoot, 'config', 'sensitive-operation-contract.json');

const HIGH_IMPACT_RISKS = new Set([
  'credential_reveal',
  'credential_revoke',
  'credential_rotate',
  'credential_use',
  'credential_reveal_or_revoke',
  'credential_reveal_revoke_or_use',
  'delegation',
  'identity_change',
  'credential_rotate_or_use',
  'recovery_material'
]);

const ALLOWED_HIGH_IMPACT_PROOFS = new Set([
  'recent_session',
  'recent_session_when_changed',
  'equivalent_current_password',
  'required_when_implemented'
]);

function certifySensitiveOperationContract(contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))) {
  if (contract.schemaVersion !== 1) throw new Error('Unsupported sensitive operation contract schema');
  if (!Number.isInteger(contract.recentReauthenticationMinutes) || contract.recentReauthenticationMinutes <= 0) {
    throw new Error('recentReauthenticationMinutes must be a positive integer');
  }
  if (!Array.isArray(contract.operations) || contract.operations.length === 0) {
    throw new Error('Sensitive operation contract must contain operations');
  }

  const ids = new Set();
  const requiredFields = [
    'id', 'method', 'path', 'availability', 'risk', 'permission', 'csrf', 'limiter',
    'sessionAuth', 'reauthentication', 'disclosure', 'audit'
  ];
  for (const operation of contract.operations) {
    for (const field of requiredFields) {
      if (!String(operation[field] || '').trim()) throw new Error(`${operation.id || 'operation'} is missing ${field}`);
    }
    if (ids.has(operation.id)) throw new Error(`Duplicate sensitive operation id: ${operation.id}`);
    ids.add(operation.id);

    if (operation.method === 'GET' && /raw_secret|recovery_material/.test(operation.disclosure)) {
      throw new Error(`${operation.id} exposes credential material through ordinary readback`);
    }
    if (HIGH_IMPACT_RISKS.has(operation.risk) && !ALLOWED_HIGH_IMPACT_PROOFS.has(operation.reauthentication)) {
      throw new Error(`${operation.id} lacks a strong reauthentication policy`);
    }
    if (operation.availability === 'available') {
      if (!operation.source || !Array.isArray(operation.sourceNeedles) || operation.sourceNeedles.length === 0) {
        throw new Error(`${operation.id} lacks maintained source evidence`);
      }
      const sourcePath = path.join(backendRoot, operation.source);
      const source = fs.readFileSync(sourcePath, 'utf8');
      for (const needle of operation.sourceNeedles) {
        if (!source.includes(needle)) throw new Error(`${operation.id} source evidence missing: ${needle}`);
      }
    }
  }

  const unavailable = contract.operations.filter((operation) => operation.availability !== 'available').length;
  const recentProtected = contract.operations.filter((operation) => operation.reauthentication.startsWith('recent_session')).length;
  return {
    operationCount: contract.operations.length,
    unavailableCount: unavailable,
    recentProtectedCount: recentProtected,
    safeReadbackCount: contract.operations.filter((operation) => operation.method === 'GET').length
  };
}

if (require.main === module) {
  try {
    const result = certifySensitiveOperationContract();
    console.log(`Sensitive operation certification passed: ${result.operationCount} operations, ${result.recentProtectedCount} recent-proof guarded, ${result.unavailableCount} explicitly unavailable`);
  } catch (error) {
    console.error(`Sensitive operation certification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { certifySensitiveOperationContract };
