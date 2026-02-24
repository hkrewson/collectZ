import React, { useState } from 'react';
import { Icons, cx } from './app/AppPrimitives';

export default function SidebarNav({
  user,
  activeTab,
  onSelect,
  onLogout,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
  appVersion,
  libraries = [],
  activeLibraryId = null,
  onSelectLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary
}) {
  const isAdmin = user?.role === 'admin';
  const [adminOpen, setAdminOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const isLibraryActive = ['library', 'library-movies', 'library-tv', 'library-other'].includes(activeTab);

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

  const libraryOptionLabel = (library) => {
    const ownerName = library?.created_by_name || library?.created_by_email || '';
    const count = Number.isFinite(Number(library?.item_count)) ? ` · ${library.item_count}` : '';
    if (user?.role === 'admin') {
      return `${library?.name || 'Library'}${ownerName ? ` - ${ownerName}` : ''}${count}`;
    }
    return `${library?.name || 'Library'}${count}`;
  };

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
              <div className="text-ghost text-[10px] font-mono mt-0.5">v{appVersion}</div>
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
                <div className="px-2 py-1.5 rounded bg-raised/60 border border-edge/70">
                  <label className="text-[10px] uppercase tracking-wide text-ghost block mb-1">Active Library</label>
                  <select
                    className="select w-full text-xs py-1.5"
                    value={activeLibraryId || ''}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      if (Number.isFinite(nextId) && nextId > 0 && onSelectLibrary) onSelectLibrary(nextId);
                    }}
                  >
                    {libraries.length === 0 && <option value="">No libraries</option>}
                    {libraries.map((library) => (
                      <option key={library.id} value={library.id}>
                        {libraryOptionLabel(library)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1.5 grid grid-cols-3 gap-1">
                    <button className="btn-ghost btn-sm !px-2 !py-1 text-[11px]" onClick={() => onCreateLibrary && onCreateLibrary()} title="Create library">
                      <Icons.Plus />
                    </button>
                    <button
                      className="btn-ghost btn-sm !px-2 !py-1 text-[11px]"
                      onClick={() => onRenameLibrary && onRenameLibrary()}
                      disabled={!activeLibraryId}
                      title="Rename active library"
                    >
                      <Icons.Edit />
                    </button>
                    <button
                      className="btn-ghost btn-sm !px-2 !py-1 text-[11px] text-err"
                      onClick={() => onDeleteLibrary && onDeleteLibrary()}
                      disabled={!activeLibraryId}
                      title="Delete active library"
                    >
                      <Icons.Trash />
                    </button>
                  </div>
                </div>
                <NavLink id="library-movies" icon={null} label="Movies" sub />
                <NavLink id="library-tv" icon={null} label="TV" sub />
                <NavLink id="library-other" icon={null} label="Other" sub />
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
                  <NavLink id="admin-integrations" icon={null} label="Integrations" sub />
                  <NavLink id="admin-settings" icon={null} label="Settings" sub />
                  <NavLink id="admin-flags" icon={null} label="Feature Flags" sub />
                  <NavLink id="admin-users" icon={null} label="Members" sub />
                  <NavLink id="admin-activity" icon={null} label="Activity" sub />
                </div>
              )}
            </div>
          )}

          <NavLink id="profile" icon={<Icons.Profile />} label="Profile" />
        </nav>

        <div className="p-3 border-t border-edge shrink-0 space-y-1">
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
            {collapsed ? <Icons.ChevronRight /> : <><Icons.ChevronLeft /><span>Collapse</span></>}
          </button>
        </div>
      </aside>
    </>
  );
}
