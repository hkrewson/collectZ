'use strict';

const PERMISSIONS = Object.freeze({
  ACCOUNT_READ: 'account.read',
  ACCOUNT_MANAGE: 'account.manage',
  PLATFORM_READ: 'platform.read',
  PLATFORM_MANAGE: 'platform.manage',
  WORKSPACE_READ: 'workspace.read',
  WORKSPACE_CONTENT_READ: 'workspace.content.read',
  WORKSPACE_CONTENT_MANAGE: 'workspace.content.manage',
  WORKSPACE_MEMBERS_READ: 'workspace.members.read',
  WORKSPACE_MEMBERS_MANAGE: 'workspace.members.manage',
  WORKSPACE_INTEGRATIONS_READ: 'workspace.integrations.read',
  WORKSPACE_INTEGRATIONS_MANAGE: 'workspace.integrations.manage'
});

const MEMBERSHIP_ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(Object.values(PERMISSIONS).filter((permission) => !permission.startsWith('platform.'))),
  admin: Object.freeze(Object.values(PERMISSIONS).filter((permission) => !permission.startsWith('platform.'))),
  member: Object.freeze([
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_MANAGE,
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_CONTENT_READ,
    PERMISSIONS.WORKSPACE_CONTENT_MANAGE,
    PERMISSIONS.WORKSPACE_MEMBERS_READ,
    PERMISSIONS.WORKSPACE_INTEGRATIONS_READ
  ]),
  viewer: Object.freeze([
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_CONTENT_READ,
    PERMISSIONS.WORKSPACE_MEMBERS_READ,
    PERMISSIONS.WORKSPACE_INTEGRATIONS_READ
  ])
});

const GLOBAL_ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([PERMISSIONS.ACCOUNT_READ, PERMISSIONS.ACCOUNT_MANAGE, PERMISSIONS.PLATFORM_READ, PERMISSIONS.PLATFORM_MANAGE]),
  support_admin: Object.freeze([PERMISSIONS.ACCOUNT_READ, PERMISSIONS.PLATFORM_READ]),
  user: Object.freeze([PERMISSIONS.ACCOUNT_READ, PERMISSIONS.ACCOUNT_MANAGE]),
  viewer: Object.freeze([PERMISSIONS.ACCOUNT_READ])
});

function hasPermission({ userRole = null, membershipRole = null, permission }) {
  if (!Object.values(PERMISSIONS).includes(permission)) return false;
  const globalPermissions = GLOBAL_ROLE_PERMISSIONS[userRole] || [];
  const membershipPermissions = MEMBERSHIP_ROLE_PERMISSIONS[membershipRole] || [];
  return globalPermissions.includes(permission) || membershipPermissions.includes(permission);
}

module.exports = {
  GLOBAL_ROLE_PERMISSIONS,
  MEMBERSHIP_ROLE_PERMISSIONS,
  PERMISSIONS,
  hasPermission
};
