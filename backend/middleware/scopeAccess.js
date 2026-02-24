const pool = require('../db/pool');
const { logActivity } = require('../services/audit');
const { extractScopeHints } = require('../db/scopeContext');

const ACCESS_DENIED_MESSAGE = 'Scope access denied';

const isAllowedHintRole = (role, allowedHintRoles) => (
  Array.isArray(allowedHintRoles) && allowedHintRoles.includes(role)
);

const denyScopeRequest = async (req, res, reason, hints, details = {}) => {
  await logActivity(req, 'scope.access.denied', 'scope', null, {
    reason,
    requestedSpaceId: hints?.spaceId ?? null,
    requestedLibraryId: hints?.libraryId ?? null,
    ...details
  });
  return res.status(403).json({ error: ACCESS_DENIED_MESSAGE, reason });
};

function enforceScopeAccess(options = {}) {
  const { allowedHintRoles = [] } = options;
  return async (req, res, next) => {
    try {
      const hints = extractScopeHints(req);
      const role = req.user?.role || null;
      const userId = req.user?.id || null;
      const activeSpaceId = req.user?.activeSpaceId ?? null;
      const activeLibraryId = req.user?.activeLibraryId ?? null;

      // Active scope comes from the authenticated server-side user state.
      let resolvedSpaceId = activeSpaceId;
      let resolvedLibraryId = activeLibraryId;

      if (hints.hasHints) {
        if (!isAllowedHintRole(role, allowedHintRoles)) {
          return denyScopeRequest(req, res, 'hints_not_allowed_for_role', hints, { role });
        }
        if (hints.spaceProvided) resolvedSpaceId = hints.spaceId;
        if (hints.libraryProvided) resolvedLibraryId = hints.libraryId;
      }

      if (!resolvedLibraryId && userId) {
        const fallbackLibrary = await pool.query(
          role === 'admin'
            ? `SELECT id, space_id
               FROM libraries
               WHERE archived_at IS NULL
               ORDER BY created_at ASC, id ASC
               LIMIT 1`
            : `SELECT l.id, l.space_id
               FROM library_memberships lm
               JOIN libraries l ON l.id = lm.library_id
               WHERE lm.user_id = $1
                 AND l.archived_at IS NULL
               ORDER BY lm.created_at ASC, lm.library_id ASC
               LIMIT 1`,
          role === 'admin' ? [] : [userId]
        );
        if (fallbackLibrary.rows.length > 0) {
          resolvedLibraryId = fallbackLibrary.rows[0].id;
          if (resolvedSpaceId === null || resolvedSpaceId === undefined) {
            resolvedSpaceId = fallbackLibrary.rows[0].space_id || null;
          }
        }
      }

      if (resolvedLibraryId) {
        const libraryLookup = await pool.query(
          `SELECT id, space_id
           FROM libraries
           WHERE id = $1
             AND archived_at IS NULL
           LIMIT 1`,
          [resolvedLibraryId]
        );
        if (libraryLookup.rows.length === 0) {
          return denyScopeRequest(req, res, 'library_not_found', hints, {
            libraryId: resolvedLibraryId
          });
        }

        const libraryRow = libraryLookup.rows[0];
        if (
          resolvedSpaceId !== null &&
          resolvedSpaceId !== undefined &&
          libraryRow.space_id !== null &&
          Number(libraryRow.space_id) !== Number(resolvedSpaceId)
        ) {
          return denyScopeRequest(req, res, 'space_library_mismatch', hints, {
            librarySpaceId: libraryRow.space_id
          });
        }
        if ((resolvedSpaceId === null || resolvedSpaceId === undefined) && libraryRow.space_id !== null) {
          resolvedSpaceId = libraryRow.space_id;
        }

        if (role !== 'admin') {
          const membership = await pool.query(
            `SELECT 1
             FROM library_memberships
             WHERE user_id = $1
               AND library_id = $2
             LIMIT 1`,
            [userId, resolvedLibraryId]
          );
          if (membership.rows.length === 0) {
            return denyScopeRequest(req, res, 'library_membership_required', hints, {
              libraryId: resolvedLibraryId
            });
          }
        }
      } else if (resolvedSpaceId && role !== 'admin') {
        const membership = await pool.query(
          `SELECT 1
           FROM library_memberships lm
           JOIN libraries l ON l.id = lm.library_id
           WHERE lm.user_id = $1
             AND l.space_id = $2
             AND l.archived_at IS NULL
           LIMIT 1`,
          [userId, resolvedSpaceId]
        );
        if (membership.rows.length === 0) {
          return denyScopeRequest(req, res, 'space_membership_required', hints, {
            spaceId: resolvedSpaceId
          });
        }
      }

      req.scopeContext = {
        spaceId: resolvedSpaceId ?? null,
        libraryId: resolvedLibraryId ?? null
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  enforceScopeAccess
};
