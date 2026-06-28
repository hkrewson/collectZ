import React, { useEffect, useRef, useState } from 'react';
import { Icons, cx, isInteractiveTarget, posterUrl } from './app/AppPrimitives';
import CollectzMark from './CollectzMark';
import { getAllowedDashboardTabs, isLocalProductEdition, isSupportHelpEnabled, SUPPORT_STAFF_ROLE } from './app/productEdition';

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
  spaces = [],
  activeSpaceId = null,
  libraries = [],
  activeLibraryId = null,
  onLibrarySelect,
  canManageActiveSpace = false,
  activeMembershipRole = null,
  showCollectibles = true,
  showEvents = true,
  productEdition = 'platform',
  platformBridgeEnabled = false
}) {
  const isAdmin = user?.role === 'admin';
  const isSupportAdmin = user?.role === SUPPORT_STAFF_ROLE;
  const localRuntime = isLocalProductEdition(productEdition);
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const bridgeSupportEnabled = false;
  const coreNavigationOnly = localRuntime || !platformBridgeEnabled;
  const isSupportStaff = supportHelpEnabled && (isAdmin || isSupportAdmin);
  const canUseLibraryShell = !isSupportAdmin || !bridgeSupportEnabled;
  const allowedTabs = getAllowedDashboardTabs(productEdition, {
    userRole: user?.role,
    canManageActiveSpace,
    showCollectibles,
    showEvents,
    platformBridgeEnabled
  });
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
    'library-saved-views',
    'library-wishlist',
    'library-loans',
    'library-collectibles',
    'library-events',
    'admin-merges'
  ].includes(activeTab);
  const isPlatformGroupActive = [
    'admin-settings',
    'admin-integrations'
  ].includes(activeTab);
  const isTabAllowed = (tabId) => !allowedTabs || allowedTabs.has(tabId);
  const showLibrarySwitcher = canUseLibraryShell && libraries.length > 1;
  const canOpenSpaceSurface = Boolean(activeMembershipRole) || canManageActiveSpace;
  const showWorkspaceSettingsLink = !localRuntime && canOpenSpaceSurface && isTabAllowed('space-manage');
  const showWorkspaceMergeReviewLink = canOpenSpaceSurface && isTabAllowed('admin-merges');
  const showLocalAdminSettingsLink = coreNavigationOnly && isAdmin && isTabAllowed('admin-settings');
  const showLocalAdminIntegrationsLink = coreNavigationOnly && isAdmin && isTabAllowed('admin-integrations');
  const showWorkspaceNavigation = true;
  const showWorkspaceHelp = showWorkspaceNavigation && !isSupportAdmin;
  const showPlatformHelpAdmin = isSupportStaff && isSupportAdmin;
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

  const navStateClass = (active) => (
    active
      ? 'text-ink hover:text-ink'
      : 'text-dim hover:text-ink'
  );

  const NavUnderline = ({ active, sub = false }) => {
    return (
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute bottom-0 h-0.5 rounded-full transition-colors duration-150',
          'w-24 max-w-[calc(100%-1.5rem)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          sub ? 'left-8' : 'left-3',
          active
            ? 'bg-gold opacity-100 group-hover:bg-gold group-focus-visible:bg-gold'
            : 'bg-gold/35 group-hover:bg-gold/45 group-focus-visible:bg-gold/45',
          collapsed && !sub && 'left-4 right-4 w-auto max-w-none'
        )}
      />
    );
  };

  const AccountMenuItem = ({ children, icon, onClick, href, external = false, danger = false, active = false }) => {
    const content = (
      <>
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{children}</span>
        <NavUnderline active={active} />
      </>
    );
    const className = cx(
      'group relative w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left',
      danger ? 'text-dim hover:text-err focus-visible:text-err' : navStateClass(active),
      'focus-visible:ring-0 focus-visible:ring-offset-0'
    );

    if (href) {
      return (
        <a
          role="menuitem"
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer' : undefined}
          className={className}
          onClick={onClick}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className={className}
      >
        {content}
      </button>
    );
  };

  const NavLink = ({ id, icon, label, sub = false, badge = null, activeWhen = [] }) => {
    const active = activeTab === id || activeWhen.includes(activeTab);
    return (
      <button
        aria-label={label}
        onClick={() => {
          onSelect(id);
          onMobileClose();
        }}
        className={cx(
          'group relative w-full flex items-center gap-3 rounded transition-colors duration-150 text-left',
          sub ? 'pl-8 pr-3 py-2 text-sm' : 'px-3 py-2.5 text-sm font-medium',
          navStateClass(active),
          collapsed && !sub && 'justify-center px-0'
        )}
      >
        {!sub && <span className="shrink-0">{icon}</span>}
        {(!collapsed || sub) && <span className="truncate">{label}</span>}
        {!collapsed && badge !== null && badge !== undefined && (
          <span className="ml-auto badge badge-dim text-[10px] min-w-5 text-center">{badge}</span>
        )}
        <NavUnderline active={active} sub={sub} />
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
          data-testid="navigation-menu-top"
          className={cx(
            'flex items-center gap-2 border-b border-edge shrink-0 px-3 py-1',
            collapsed ? 'justify-center px-0' : ''
          )}
        >
          <button
            type="button"
            onClick={onToggle}
            className={cx(
              'group relative hidden min-w-0 items-center gap-2 rounded-md py-1.5 text-left text-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45 lg:flex',
              collapsed ? 'h-9 w-9 justify-center px-0' : 'flex-1 px-2'
            )}
            aria-label={pinnedExpanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={!collapsed}
            title={pinnedExpanded ? 'Collapse navigation' : 'Expand navigation'}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center text-gold">
              <CollectzMark className="h-6 w-6" title={collapsed ? 'Collectz' : ''} />
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-none tracking-tight text-ink lg:text-base">collectZ</span>
              </span>
            )}
            <span
              aria-hidden="true"
              className={cx(
                'pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-gold/35 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
                collapsed ? 'left-1 right-1' : 'left-2 right-2'
              )}
            />
          </button>
          <div className={cx(
            'flex min-w-0 flex-1 items-center gap-2 lg:hidden',
            collapsed ? 'justify-center' : ''
          )}>
            <div className={cx('flex h-7 w-7 shrink-0 items-center justify-center text-gold', !collapsed && 'ml-2')}>
              <CollectzMark className="h-6 w-6" title={collapsed ? 'Collectz' : ''} />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold tracking-tight text-ink leading-none">collectZ</div>
              </div>
            )}
          </div>
          {mobileOpen && (
            <button
              type="button"
              onClick={onMobileClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-raised text-dim transition-colors hover:text-ink lg:hidden"
              aria-label="Close navigation"
              title="Close navigation"
            >
              <Icons.Menu />
            </button>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
          {showWorkspaceNavigation && canUseLibraryShell && isTabAllowed('dashboard') && (
            <NavLink id="dashboard" icon={<Icons.Gauge />} label="Dashboard" />
          )}

          {showWorkspaceNavigation && !collapsed && user && showLibrarySwitcher && (
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

          {showWorkspaceNavigation && canUseLibraryShell && (
          <div>
            <button
              onClick={() => {
                if (collapsed) onSelect('library-movies');
                else setLibraryOpen((o) => !o);
              }}
              className={cx(
                'group relative w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded transition-colors',
                navStateClass(isLibraryActive),
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
              <NavUnderline active={isLibraryActive && collapsed} />
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
                <NavLink id="library-movies" icon={null} label="Movies" sub />
                <NavLink id="library-tv" icon={null} label="TV" sub />
                <div className="my-1 border-t border-edge/70" />
                <NavLink id="library-loans" icon={null} label="Loans" sub />
                {showWorkspaceMergeReviewLink && <NavLink id="admin-merges" icon={null} label="Review" sub />}
                <NavLink id="library-saved-views" icon={null} label="Saved Views" sub />
                <NavLink id="library-wishlist" icon={null} label="Wishlist" sub />
              </div>
            )}
          </div>
          )}
          {showWorkspaceNavigation && canUseLibraryShell && isTabAllowed('library-import') && (
            <NavLink id="library-import" icon={<Icons.Upload />} label="Import" activeWhen={['library-capture']} />
          )}
          {showWorkspaceHelp && (
            <NavLink
              id="help"
              icon={<Icons.Activity />}
              label="Help"
            />
          )}
          {showWorkspaceNavigation && showWorkspaceSettingsLink && (
            <NavLink id="space-manage" icon={<Icons.Settings />} label="Settings" />
          )}
          {showWorkspaceNavigation && showLocalAdminSettingsLink && (
            <NavLink id="admin-settings" icon={<Icons.Settings />} label="Settings" />
          )}
          {showWorkspaceNavigation && showLocalAdminIntegrationsLink && (
            <NavLink id="admin-integrations" icon={<Icons.Integrations />} label="Integrations" />
          )}
          {showPlatformHelpAdmin && (
            <NavLink id="help" icon={<Icons.Activity />} label="Help" />
          )}
        </nav>

        <div className="relative p-3 border-t border-edge shrink-0" ref={accountMenuRef}>
          <button
            type="button"
            onClick={() => setAccountMenuOpen((open) => !open)}
            className={cx(
              'group relative w-full flex items-center gap-3 rounded px-3 py-2.5 text-left transition-colors',
              navStateClass(activeTab === 'profile'),
              collapsed && 'justify-center px-0',
              'focus-visible:ring-0 focus-visible:ring-offset-0'
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
            <NavUnderline active={activeTab === 'profile'} />
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
              <AccountMenuItem
                icon={<Icons.Profile />}
                active={activeTab === 'profile'}
                onClick={() => {
                  setAccountMenuOpen(false);
                  onSelect('profile');
                  onMobileClose();
                }}
              >
                My profile
              </AccountMenuItem>
              <AccountMenuItem
                icon={<DiscordIcon />}
                href="https://discord.gg/ZV8f5nGT2R"
                external
                onClick={() => setAccountMenuOpen(false)}
              >
                Discord
              </AccountMenuItem>
              <AccountMenuItem
                icon={<GitHubIcon />}
                href="https://github.com/hkrewson/collectz"
                external
                onClick={() => setAccountMenuOpen(false)}
              >
                GitHub
              </AccountMenuItem>
              <div className="my-1 border-t border-edge/70" />
              <AccountMenuItem
                icon={<Icons.LogOut />}
                danger
                onClick={() => {
                  setAccountMenuOpen(false);
                  onLogout();
                }}
              >
                Sign out
              </AccountMenuItem>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
