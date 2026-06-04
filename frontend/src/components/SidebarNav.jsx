import React, { useEffect, useRef, useState } from 'react';
import { Icons, cx, isInteractiveTarget, posterUrl } from './app/AppPrimitives';
import CollectzMark from './CollectzMark';
import { getAllowedDashboardTabs, getHelpNavLabel, isSupportHelpEnabled } from './app/productEdition';

const DiscordIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5" aria-hidden="true">
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
  </svg>
);

export default function SidebarNav({
  user,
  activeTab,
  onSelect,
  onLogout,
  collapsed,
  pinnedExpanded,
  onToggle,
  mobileOpen,
  onMobileClose,
  appVersion,
  spaces = [],
  activeSpaceId = null,
  libraries = [],
  activeLibraryId = null,
  onLibrarySelect,
  canManageActiveSpace = false,
  activeMembershipRole = null,
  supportSessionActive = false,
  showCollectibles = true,
  showEvents = true,
  supportBadgeCount = null,
  productEdition = 'platform'
}) {
  const isAdmin = user?.role === 'admin';
  const isSupportAdmin = user?.role === 'support_admin';
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const isSupportStaff = supportHelpEnabled && (isAdmin || isSupportAdmin);
  const canUseLibraryShell = !isSupportAdmin || !supportHelpEnabled;
  const allowedTabs = getAllowedDashboardTabs(productEdition, {
    userRole: user?.role,
    supportSessionActive,
    canManageActiveSpace,
    showCollectibles,
    showEvents
  });
  const releaseNotesUrl = `https://github.com/hkrewson/collectZ/tree/main/docs/releases/v${appVersion}.md`;
  const [platformOpen, setPlatformOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const isLibraryActive = [
    'library',
    'library-movies',
    'library-tv',
    'library-books',
    'library-audio',
    'library-art',
    'library-games',
    'library-comics',
    'library-wishlist',
    'library-capture',
    'library-loans',
    'library-collectibles',
    'library-events',
    'library-import'
  ].includes(activeTab);
  const isPlatformGroupActive = [
    'admin-merges',
    'admin-settings',
    'admin-integrations',
    'admin-activity',
    'admin-spaces',
    'admin-users'
  ].includes(activeTab);
  const isTabAllowed = (tabId) => !allowedTabs || allowedTabs.has(tabId);
  const showLibrarySwitcher = canUseLibraryShell && !isAdmin && libraries.length > 1;
  const showDesktopHamburger = !collapsed;
  const canOpenSpaceSurface = Boolean(activeMembershipRole) || canManageActiveSpace;
  const showAdminGroup = isAdmin && [
    isTabAllowed('admin-settings'),
    isTabAllowed('admin-merges'),
    isTabAllowed('admin-integrations'),
    isTabAllowed('admin-activity'),
    isTabAllowed('admin-spaces'),
    isTabAllowed('admin-users')
  ].some(Boolean);
  const profileImage = posterUrl(user?.image_path || '');

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  const handleCollapsedRailClick = (event) => {
    if (!collapsed) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    if (isInteractiveTarget(event.target)) return;
    onToggle?.();
  };

  const NavLink = ({ id, icon, label, sub = false, badge = null }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => {
          onSelect(id);
          onMobileClose();
        }}
        className={cx(
          'w-full flex items-center gap-3 rounded transition-all duration-150 text-left',
          sub ? 'pl-8 pr-3 py-2 text-sm' : 'px-3 py-2.5 text-sm font-medium',
          active ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
          collapsed && !sub && 'justify-center px-0'
        )}
      >
        {!sub && <span className="shrink-0">{icon}</span>}
        {(!collapsed || sub) && <span className="truncate">{label}</span>}
        {!collapsed && badge !== null && badge !== undefined && (
          <span className="ml-auto badge badge-dim text-[10px] min-w-5 text-center">{badge}</span>
        )}
      </button>
    );
  };

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-void/80 z-30 lg:hidden" onClick={onMobileClose} />}

      <aside
        onClick={handleCollapsedRailClick}
        className={cx(
          'fixed top-0 left-0 h-full bg-abyss border-r border-edge flex flex-col z-40',
          'transition-all duration-300',
          collapsed ? 'w-20' : 'w-56',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div
          className={cx(
            'flex items-center gap-3 px-4 py-5 border-b border-edge shrink-0',
            collapsed ? 'justify-between px-2' : ''
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center text-gold">
            <CollectzMark className="h-8 w-8" title={collapsed ? 'Collectz' : ''} />
          </div>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold tracking-tight text-ink leading-none">collectZ</div>
              <a
                href={releaseNotesUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ghost text-[10px] font-mono mt-0.5 inline-block hover:text-ink"
                title="Open release notes"
              >
                v{appVersion}
              </a>
            </div>
          )}
          {showDesktopHamburger && (
            <button
              onClick={onToggle}
              className="btn-icon hidden lg:inline-flex"
              aria-label={pinnedExpanded ? 'Collapse navigation' : 'Expand navigation'}
              title={pinnedExpanded ? 'Collapse navigation' : 'Expand navigation'}
            >
              <Icons.Menu />
            </button>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
          {canUseLibraryShell && isTabAllowed('dashboard') && (
            <NavLink id="dashboard" icon={<Icons.Gauge />} label="Dashboard" />
          )}
          {canUseLibraryShell && isTabAllowed('review-queue') && (
            <NavLink id="review-queue" icon={<Icons.List />} label="Review" />
          )}

          {!collapsed && user && showLibrarySwitcher && (
            <div className="mb-3 space-y-1">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-ghost">Library</span>
                {activeMembershipRole ? <span className="text-xs text-ghost capitalize">{activeMembershipRole}</span> : null}
              </div>
              <select
                className="select w-full"
                value={activeLibraryId || ''}
                onChange={(e) => onLibrarySelect?.(e.target.value)}
              >
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canUseLibraryShell && (
          <div>
            <button
              onClick={() => {
                if (collapsed) onSelect('library-movies');
                else setLibraryOpen((o) => !o);
              }}
              className={cx(
                'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded transition-all',
                isLibraryActive ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
                collapsed && 'justify-center px-0'
              )}
            >
              <span className="shrink-0"><Icons.Library /></span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Library</span>
                  <span className={cx('transition-transform duration-200', libraryOpen && 'rotate-180')}><Icons.ChevronDown /></span>
                </>
              )}
            </button>
            {libraryOpen && !collapsed && (
              <div className="mt-1 space-y-1">
                <NavLink id="library-audio" icon={null} label="Audio" sub />
                {showCollectibles && <NavLink id="library-art" icon={null} label="Art" sub />}
                <NavLink id="library-books" icon={null} label="Books" sub />
                <NavLink id="library-comics" icon={null} label="Comics" sub />
                {showCollectibles && <NavLink id="library-collectibles" icon={null} label="Collectibles" sub />}
                {showEvents && <NavLink id="library-events" icon={null} label="Events" sub />}
                <NavLink id="library-games" icon={null} label="Games" sub />
                <NavLink id="library-loans" icon={null} label="Loans" sub />
                <NavLink id="library-movies" icon={null} label="Movies" sub />
                <NavLink id="library-tv" icon={null} label="TV" sub />
                <NavLink id="library-wishlist" icon={null} label="Wishlist" sub />
                <NavLink id="library-capture" icon={null} label="Capture Inbox" sub />
              </div>
            )}
          </div>
          )}
          {canUseLibraryShell && isTabAllowed('library-import') && <NavLink id="library-import" icon={<Icons.Upload />} label="Import" />}
          <NavLink
            id="help"
            icon={<Icons.Activity />}
            label={getHelpNavLabel(productEdition, isSupportStaff)}
            badge={isSupportStaff ? supportBadgeCount : null}
          />
          {canOpenSpaceSurface && isTabAllowed('space-manage') && (
            <NavLink id="space-manage" icon={<Icons.Users />} label="Workspace" />
          )}
          {showAdminGroup && (
            <div>
              <button
                onClick={() => setPlatformOpen((o) => !o)}
                className={cx(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded transition-all',
                  isPlatformGroupActive ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
                  collapsed && 'justify-center px-0'
                )}
              >
                <span className="shrink-0"><Icons.Settings /></span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Admin</span>
                    <span className={cx('transition-transform duration-200', platformOpen && 'rotate-180')}><Icons.ChevronDown /></span>
                  </>
                )}
              </button>
              {platformOpen && !collapsed && (
                <div className="mt-1 space-y-0.5">
                  {isTabAllowed('admin-merges') && <NavLink id="admin-merges" icon={null} label="Merge Review" sub />}
                  {isTabAllowed('admin-settings') && <NavLink id="admin-settings" icon={null} label="Settings" sub />}
                  {isTabAllowed('admin-integrations') && <NavLink id="admin-integrations" icon={null} label="Integrations" sub />}
                  {isTabAllowed('admin-activity') && <NavLink id="admin-activity" icon={null} label="Activity" sub />}
                  {isTabAllowed('admin-spaces') && <NavLink id="admin-spaces" icon={null} label="All Workspaces" sub />}
                  {isTabAllowed('admin-users') && <NavLink id="admin-users" icon={null} label="All Members" sub />}
                </div>
              )}
            </div>
          )}

        </nav>

        <div className="relative p-3 border-t border-edge shrink-0" ref={accountMenuRef}>
          <button
            type="button"
            onClick={() => setAccountMenuOpen((open) => !open)}
            className={cx(
              'w-full flex items-center gap-3 rounded px-3 py-2.5 text-left transition-all',
              activeTab === 'profile' || accountMenuOpen ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
              collapsed && 'justify-center px-0'
            )}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label="Account menu"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge/80 bg-surface/60 text-sm font-medium text-ink">
              {profileImage
                ? <img src={profileImage} alt={user?.name || 'Account'} className="h-full w-full rounded-md object-cover" />
                : (user?.name?.[0]?.toUpperCase() || '?')}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{user?.name || 'My account'}</span>
                  <span className="block truncate text-xs text-ghost">{user?.email || 'Profile'}</span>
                </span>
                <span className={cx('text-dim transition-transform duration-150', accountMenuOpen && 'rotate-180')}>
                  <Icons.ChevronDown />
                </span>
              </>
            )}
          </button>

          {accountMenuOpen && (
            <div
              role="menu"
              aria-label="Account"
              className={cx(
                'absolute z-50 rounded-lg border border-edge bg-deep/95 p-1.5 shadow-card backdrop-blur-sm',
                collapsed ? 'bottom-3 left-full ml-2 w-52' : 'bottom-full left-3 right-3 mb-2'
              )}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSelect('profile');
                  onMobileClose();
                }}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-dim hover:bg-raised/60 hover:text-ink"
              >
                <Icons.Profile />
                <span>My profile</span>
              </button>
              <a
                role="menuitem"
                href="https://discord.gg/ZV8f5nGT2R"
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-dim hover:bg-raised/60 hover:text-ink"
                onClick={() => setAccountMenuOpen(false)}
              >
                <DiscordIcon />
                <span>Discord</span>
              </a>
              <a
                role="menuitem"
                href="https://github.com/hkrewson/collectZ"
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-dim hover:bg-raised/60 hover:text-ink"
                onClick={() => setAccountMenuOpen(false)}
              >
                <GitHubIcon />
                <span>GitHub</span>
              </a>
              <div className="my-1 border-t border-edge/70" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-dim hover:bg-err/10 hover:text-err"
              >
                <Icons.LogOut />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
