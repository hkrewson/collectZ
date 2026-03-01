import React, { useState } from 'react';
import { Icons, cx } from './app/AppPrimitives';

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
  onToggle,
  mobileOpen,
  onMobileClose,
  appVersion
}) {
  const isAdmin = user?.role === 'admin';
  const releaseNotesUrl = `https://github.com/hkrewson/collectZ/tree/main/docs/releases/v${appVersion}.md`;
  const [adminOpen, setAdminOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const isLibraryActive = [
    'library',
    'library-movies',
    'library-tv',
    'library-books',
    'library-audio',
    'library-games',
    'library-comics'
  ].includes(activeTab);

  const NavLink = ({ id, icon, label, sub = false }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => {
          onSelect(id);
          onMobileClose();
        }}
        className={cx(
          'w-full flex items-center gap-3 rounded transition-all duration-150 text-left',
          sub ? 'pl-8 pr-3 py-2 text-xs' : 'px-3 py-2.5 text-sm font-medium',
          active ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
          collapsed && !sub && 'justify-center px-0'
        )}
      >
        {!sub && <span className={cx('shrink-0', active && 'text-gold')}>{icon}</span>}
        {sub && <span className="w-1 h-1 rounded-full bg-current mr-1 opacity-50" />}
        {(!collapsed || sub) && <span className="truncate">{label}</span>}
        {!collapsed && !sub && active && <span className="ml-auto w-1 h-4 rounded-full bg-gold" />}
      </button>
    );
  };

  const ExternalFooterLink = ({ href, title, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      className={cx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded transition-all text-left',
        'text-dim hover:text-ink hover:bg-raised/50',
        collapsed && 'justify-center px-0'
      )}
    >
      {children}
      {!collapsed && <span className="text-sm">{title}</span>}
    </a>
  );

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-void/80 z-30 lg:hidden" onClick={onMobileClose} />}

      <aside
        className={cx(
          'fixed top-0 left-0 h-full bg-abyss border-r border-edge flex flex-col z-40',
          'transition-all duration-300',
          collapsed ? 'w-16' : 'w-56',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className={cx('flex items-center gap-3 px-4 py-5 border-b border-edge shrink-0', collapsed && 'justify-center px-0')}>
          <div className="w-8 h-8 rounded bg-gold flex items-center justify-center text-void font-display text-sm shrink-0">C</div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-base tracking-wider text-ink leading-none">COLLECTZ</div>
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
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
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
              <span className={cx('shrink-0', isLibraryActive && 'text-gold')}><Icons.Library /></span>
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
                <NavLink id="library-books" icon={null} label="Books" sub />
                <NavLink id="library-comics" icon={null} label="Comic Books" sub />
                <NavLink id="library-games" icon={null} label="Games" sub />
                <NavLink id="library-movies" icon={null} label="Movies" sub />
                <NavLink id="library-tv" icon={null} label="TV" sub />
              </div>
            )}
          </div>
          <NavLink id="library-import" icon={<Icons.Upload />} label="Import" />

          {isAdmin && (
            <div>
              <button
                onClick={() => setAdminOpen((o) => !o)}
                className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded text-dim hover:text-ink hover:bg-raised/50 transition-all', collapsed && 'justify-center px-0')}
              >
                <span className="shrink-0"><Icons.Settings /></span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Admin</span>
                    <span className={cx('transition-transform duration-200', adminOpen && 'rotate-180')}><Icons.ChevronDown /></span>
                  </>
                )}
              </button>
              {adminOpen && !collapsed && (
                <div className="mt-1 space-y-0.5">
                  <NavLink id="admin-activity" icon={null} label="Activity" sub />
                  <NavLink id="admin-flags" icon={null} label="Feature Flags" sub />
                  <NavLink id="admin-integrations" icon={null} label="Integrations" sub />
                  <NavLink id="admin-users" icon={null} label="Members" sub />
                  <NavLink id="admin-settings" icon={null} label="Settings" sub />
                </div>
              )}
            </div>
          )}

          <NavLink id="profile" icon={<Icons.Profile />} label="Profile" />

        </nav>

        <div className="p-3 border-t border-edge shrink-0 space-y-1">
          <ExternalFooterLink href="https://discord.gg/ZV8f5nGT2R" title="Discord">
            <DiscordIcon />
          </ExternalFooterLink>
          <ExternalFooterLink href="https://github.com/hkrewson/collectZ" title="GitHub">
            <GitHubIcon />
          </ExternalFooterLink>
          <button
            onClick={onLogout}
            className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-sm text-dim hover:text-err rounded hover:bg-err/10 transition-all', collapsed && 'justify-center px-0')}
          >
            <Icons.LogOut />
            {!collapsed && <span>Sign out</span>}
          </button>
          <button
            onClick={onToggle}
            className={cx('w-full flex items-center gap-3 px-3 py-2 text-xs text-ghost hover:text-dim rounded hover:bg-raised/50 transition-all', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <Icons.ChevronRight /> : <><Icons.ChevronLeft /><span></span></>}
          </button>
        </div>
      </aside>
    </>
  );
}
