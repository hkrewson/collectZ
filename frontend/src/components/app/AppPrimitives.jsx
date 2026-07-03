import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildEditionMetadata,
  buildGradingMetadata,
  buildObjectRelationshipMetadata,
  buildProvenanceMetadata,
  DRAWER_METADATA_IDS,
  editionConfigForMediaType,
  findEditionVariantTrait,
  findGradingTrait,
  findProvenanceTrait
} from './drawerMetadata';
import { isDashboardRoutePath } from './dashboardRouting';

export function routeFromPath(p) {
  if (p === '/register') return 'register';
  if (p === '/forgot-password') return 'forgot';
  if (p === '/reset-password') return 'reset';
  if (p === '/verify-email') return 'verify';
  if (p === '/now-playing') return 'now-playing';
  if (isDashboardRoutePath(p)) return 'dashboard';
  return 'login';
}

export function posterUrl(path) {
  const value = String(path || '').trim();
  if (!value) return '';
  if (value.startsWith('blob:')) return encodeURI(value);
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? encodeURI(parsed.href) : '';
    } catch (_) {
      return '';
    }
  }
  if (value.startsWith('/uploads/') || value.startsWith('/')) {
    const encodedPath = encodeURI(value);
    if (value.startsWith('/api/')) return encodedPath;
    if (value.startsWith('/t/') || value.includes('/p/')) return `https://image.tmdb.org/t/p/w500${encodedPath}`;
    if (value.startsWith('/uploads/')) return encodedPath;
    return `https://image.tmdb.org/t/p/w500${encodedPath}`;
  }
  return '';
}

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function FixedPageShell({
  header,
  children,
  className = '',
  headerClassName = '',
  headerInnerClassName = '',
  bodyClassName = '',
  bodyInnerClassName = '',
  onBodyScroll,
  testId,
  headerTestId,
  bodyTestId
}) {
  return (
    <div className={cx('flex h-full min-h-0 flex-col', className)} data-testid={testId}>
      <header className={cx('shrink-0 border-b border-edge bg-void/95 px-4 py-3 sm:px-6', headerClassName)} data-testid={headerTestId}>
        <div className={headerInnerClassName}>{header}</div>
      </header>
      <main className={cx('min-h-0 flex-1 overflow-y-auto scroll-area', bodyClassName)} data-testid={bodyTestId} onScroll={onBodyScroll}>
        <div className={bodyInnerClassName}>{children}</div>
      </main>
    </div>
  );
}

export function UtilityPageHeader({
  title,
  subtitle,
  actions,
  controls,
  compact = false,
  showTitleOnMobile = true,
  className = '',
  titleClassName = '',
  controlsClassName = ''
}) {
  return (
    <div className={cx('space-y-3 transition-[padding] duration-150', compact && 'space-y-2', className)}>
      <div
        className={cx(
          'flex min-w-0 items-end justify-between gap-3',
          compact && 'items-center',
          compact && !showTitleOnMobile && 'max-sm:hidden'
        )}
      >
        <div className={cx('min-w-0', compact && 'sm:flex sm:items-center sm:gap-3')}>
          <h1 className={cx('section-title !text-2xl sm:!text-3xl', compact && '!text-xl sm:!text-2xl', titleClassName)}>{title}</h1>
          {subtitle ? <p className={cx('mt-1 text-sm text-ghost', compact && 'hidden lg:block')}>{subtitle}</p> : null}
        </div>
        {actions ? (
          <div className={cx('flex shrink-0 flex-wrap items-center justify-end gap-2', compact && 'gap-1.5')}>{actions}</div>
        ) : null}
      </div>
      {controls ? <div className={cx('min-w-0', controlsClassName)}>{controls}</div> : null}
    </div>
  );
}

export function MobileFilterDisclosure({
  summary = 'Filters',
  children,
  className = '',
  buttonClassName = '',
  contentClassName = '',
  Icons: IconSet = Icons
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cx('sm:hidden', className)}>
      <button
        type="button"
        className={cx('btn-ghost h-9 w-full justify-between gap-3 px-3', buttonClassName)}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate text-left">{summary}</span>
        {IconSet?.ChevronDown ? (
          <span className={cx('shrink-0 transition-transform duration-150', open && 'rotate-180')} aria-hidden="true">
            <IconSet.ChevronDown />
          </span>
        ) : null}
      </button>
      {open ? <div className={cx('mt-2 space-y-2 border-t border-edge/60 pt-2', contentClassName)}>{children}</div> : null}
    </div>
  );
}

export function FilterMenu({
  summary = 'All filters',
  activeCount = 0,
  ariaLabel = 'Filter',
  children,
  clearLabel = 'Clear filters',
  onClear,
  className = '',
  menuClassName = '',
  Icons: IconSet = Icons
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const FilterIcon = IconSet?.Filter || IconSet?.List;

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className={cx('relative shrink-0', className)} ref={menuRef}>
      <button
        type="button"
        className="btn-icon relative h-9 w-9"
        aria-label={`${ariaLabel}: ${summary || 'All filters'}`}
        aria-expanded={open}
        title="Filter"
        onClick={() => setOpen((current) => !current)}
      >
        {FilterIcon ? <FilterIcon /> : null}
        {activeCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-void bg-brand px-1 text-[10px] font-semibold leading-none text-ink">
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className={cx(
            'absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-edge bg-deep p-3 shadow-deep',
            menuClassName
          )}
          role="group"
          aria-label={ariaLabel}
        >
          {children}
          {onClear ? (
            <div className="flex justify-end border-t border-edge pt-2">
              <button type="button" className="btn-ghost btn-sm" onClick={onClear}>
                {clearLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DrawerBackdrop({
  imagePath,
  className = 'h-48',
  imageClassName = 'h-full w-full object-cover',
  renderWhenEmpty = false,
  testId
}) {
  const imageSrc = posterUrl(imagePath);
  if (!imageSrc && !renderWhenEmpty) return null;

  return (
    <div className={cx('relative shrink-0 overflow-hidden', className)} data-testid={testId}>
      {imageSrc ? (
        <>
          <img src={imageSrc} alt="" className={imageClassName} />
          <div className="absolute inset-0 bg-hero-fade" />
        </>
      ) : (
        <div className="absolute inset-0 bg-abyss" aria-hidden="true" />
      )}
    </div>
  );
}

export function DetailDrawerShell({ children, onClose, panelClassName = 'max-w-xl', className = '', testId }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="absolute inset-0 bg-void/72" onClick={onClose} aria-label="Close drawer" />
      <div
        className={cx(
          'relative ml-auto h-full w-full bg-abyss border-l border-edge flex flex-col animate-slide-in',
          panelClassName,
          className
        )}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}

export function CheckboxControl({ checked, children, id, labelClassName = '', onChange }) {
  const fallbackId = useId();
  const inputId = id || fallbackId;

  return (
    <label
      htmlFor={inputId}
      className={cx(
        'relative inline-flex min-h-9 cursor-pointer select-none items-center gap-2 text-sm text-dim hover:text-ink',
        labelClassName
      )}
    >
      <input
        id={inputId}
        name={inputId}
        type="checkbox"
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        checked={checked}
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={cx(
          'grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-gold/35',
          checked ? 'border-gold bg-gold text-void' : 'border-muted bg-surface text-transparent'
        )}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={checked ? 'text-ink' : undefined}>{children}</span>
    </label>
  );
}

export function SectionTabs({
  tabs = [],
  activeId,
  onChange,
  className = '',
  listClassName = '',
  buttonClassName = '',
  stretch = false,
  showIndex = false,
  showDivider = true,
  ariaLabel = 'Sections',
  idBase,
  semantics = 'tabs'
}) {
  const generatedIdBase = useId().replace(/:/g, '');
  const tabsIdBase = idBase || `section-tabs-${generatedIdBase}`;
  const tabRefs = useRef([]);
  const useTabSemantics = semantics === 'tabs';

  const moveFocus = useCallback(
    (nextIndex) => {
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;
      onChange?.(nextTab.id);
      window.requestAnimationFrame(() => {
        tabRefs.current[nextIndex]?.focus?.();
      });
    },
    [onChange, tabs]
  );

  const onKeyDown = useCallback(
    (event, index) => {
      if (!useTabSemantics || !tabs.length) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveFocus((index + 1) % tabs.length);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveFocus((index - 1 + tabs.length) % tabs.length);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        moveFocus(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        moveFocus(tabs.length - 1);
      }
    },
    [moveFocus, tabs, useTabSemantics]
  );

  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  return (
    <div className={cx(showDivider && 'border-b border-edge/60', className)}>
      <div
        role={useTabSemantics ? 'tablist' : undefined}
        className={cx('flex gap-4 overflow-x-auto', stretch && 'w-full', listClassName)}
        style={{ scrollbarWidth: 'thin' }}
        aria-label={ariaLabel}
      >
        {tabs.map((tab, index) => {
          const active = activeId === tab.id;
          const tabId = `${tabsIdBase}-tab-${tab.id}`;
          const panelId = `${tabsIdBase}-panel-${tab.id}`;
          return (
            <button
              key={tab.id}
              type="button"
              id={useTabSemantics ? tabId : undefined}
              role={useTabSemantics ? 'tab' : undefined}
              aria-selected={useTabSemantics ? active : undefined}
              aria-controls={useTabSemantics ? panelId : undefined}
              tabIndex={useTabSemantics ? (active ? 0 : -1) : undefined}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              onClick={() => onChange?.(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                'shrink-0 border-b-2 px-1 py-2 text-sm font-medium transition-colors',
                stretch && 'flex-1 text-center',
                active ? 'border-gold text-ink' : 'border-transparent text-ghost hover:text-ink',
                buttonClassName
              )}
            >
              {showIndex ? `${index + 1}. ${tab.label}` : tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PageHeaderSearchToolbar({
  title,
  total,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filterCount = 0,
  filterLabel,
  filters,
  extraControls,
  viewMode,
  onViewModeChange,
  viewAriaLabel = 'View mode',
  sortDirection,
  onToggleSort,
  onAdd,
  addLabel = 'Add',
  addAriaLabel,
  Icons: IconSet = Icons,
  compact = false,
  mobileShellInline = false,
  showTitleOnMobile = false,
  testId,
  toolbarTestId,
  toolbarClassName = '',
  searchClassName = 'sm:w-56',
  className = ''
}) {
  const hasSearch = typeof searchValue !== 'undefined' && typeof onSearchChange === 'function';
  const hasViewToggle = viewMode && typeof onViewModeChange === 'function';
  const hasSort = typeof onToggleSort === 'function';
  const hasAdd = typeof onAdd === 'function';
  const mobileCompact = compact || mobileShellInline;
  const [mobileShellTarget, setMobileShellTarget] = useState(null);
  const [useMobileShellToolbar, setUseMobileShellToolbar] = useState(false);
  const resolvedFilterLabel = filterLabel || `${filterCount} filter${filterCount === 1 ? '' : 's'} active`;
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef(null);

  useEffect(() => {
    if (!mobileShellInline || typeof document === 'undefined') {
      // The mobile shell target is an external DOM slot, so this effect synchronizes React state with document state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobileShellTarget(null);
      return undefined;
    }
    setMobileShellTarget(document.getElementById('mobile-shell-toolbar-slot'));
    return () => setMobileShellTarget(null);
  }, [mobileShellInline]);

  useEffect(() => {
    if (!mobileShellInline || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      // This mirrors the external media query state when the shared mobile toolbar is unavailable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUseMobileShellToolbar(false);
      return undefined;
    }
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setUseMobileShellToolbar(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [mobileShellInline]);

  useEffect(() => {
    if (!viewMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target)) setViewMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [viewMenuOpen]);

  const viewOptions = [
    { id: 'cards', label: 'Grid view', Icon: IconSet.Film },
    { id: 'list', label: 'List view', Icon: IconSet.List }
  ];
  const activeViewOption = viewOptions.find((option) => option.id === viewMode) || viewOptions[0];
  const ActiveViewIcon = activeViewOption?.Icon || IconSet.Film;
  const viewMenu = hasViewToggle ? (
    <div className="relative shrink-0" ref={viewMenuRef}>
      <button
        type="button"
        className="btn h-9 w-12 gap-1 border border-edge bg-raised p-0 text-dim hover:border-muted hover:text-ink"
        aria-label={`${viewAriaLabel}: ${activeViewOption.label}`}
        aria-haspopup="menu"
        aria-expanded={viewMenuOpen}
        title={`${viewAriaLabel}: ${activeViewOption.label}`}
        onClick={() => setViewMenuOpen((current) => !current)}
      >
        <ActiveViewIcon />
        <IconSet.ChevronDown />
      </button>
      {viewMenuOpen ? (
        <div
          className="absolute right-0 z-40 mt-2 min-w-36 rounded-md border border-edge bg-deep py-1 shadow-deep"
          role="menu"
          aria-label={viewAriaLabel}
        >
          {viewOptions.map((option) => {
            const OptionIcon = option.Icon;
            const selected = option.id === viewMode;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  selected ? 'text-ink' : 'text-ghost hover:bg-raised/60 hover:text-ink'
                )}
                onClick={() => {
                  onViewModeChange(option.id);
                  setViewMenuOpen(false);
                }}
              >
                <OptionIcon />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected && IconSet.Check ? (
                  <span className="text-gold" aria-hidden="true">
                    <IconSet.Check />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  ) : null;

  const sortButton = hasSort ? (
    <button
      type="button"
      onClick={onToggleSort}
      className="btn-icon"
      title={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
    >
      {sortDirection === 'asc' ? <IconSet.ArrowUp /> : <IconSet.ArrowDown />}
    </button>
  ) : null;

  const addButton = hasAdd ? (
    <button
      type="button"
      onClick={onAdd}
      className={cx('btn-primary whitespace-nowrap', mobileCompact ? 'px-3' : 'px-3 sm:w-10 sm:px-0')}
      aria-label={addAriaLabel || addLabel}
      title={addAriaLabel || addLabel}
    >
      <IconSet.Plus />
      <span className="hidden">{addLabel}</span>
    </button>
  ) : null;
  const mobileToolbarGridClass = mobileCompact && addButton ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]';
  const toolbarControls = (
    <>
      {hasSearch ? (
        <div className={cx('relative min-w-0', searchClassName)}>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ghost">
            <IconSet.Search />
          </span>
          <input
            className="input w-full pl-9"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      ) : null}
      {filters}
      {extraControls && mobileCompact ? <div className="hidden sm:contents">{extraControls}</div> : extraControls}
      {mobileCompact && addButton ? <div className="sm:hidden">{addButton}</div> : null}
      {viewMenu || sortButton || addButton ? (
        <div className="hidden items-center justify-end gap-1.5 sm:flex">
          {viewMenu || sortButton ? (
            <div className="flex items-center gap-1.5">
              {viewMenu}
              {sortButton}
            </div>
          ) : null}
          {addButton ? <div className="ml-1.5">{addButton}</div> : null}
        </div>
      ) : null}
    </>
  );
  const mobileShellToolbar =
    useMobileShellToolbar && mobileShellTarget
      ? createPortal(
          <div
            className={cx(
              'grid min-w-0 flex-1 gap-2 sm:hidden',
              mobileToolbarGridClass,
              '[&_.btn-secondary]:h-9 [&_.btn-secondary]:w-9 [&_.btn-secondary]:overflow-hidden [&_.btn-secondary]:px-0 [&_.btn-secondary]:text-transparent [&_.btn-secondary_svg]:text-dim'
            )}
            data-testid={toolbarTestId ? `${toolbarTestId}-shell` : undefined}
          >
            {toolbarControls}
          </div>,
          mobileShellTarget
        )
      : null;

  return (
    <>
      {mobileShellToolbar}
      {!useMobileShellToolbar ? (
        <div
          className={cx(
            'border-b border-edge bg-void/95 px-3 shrink-0 transition-[padding] duration-150 sm:px-6',
            compact ? 'py-2' : 'py-2 sm:py-4',
            className
          )}
          data-testid={testId}
        >
          <div className={cx('flex flex-col gap-2 lg:flex-row lg:items-start', compact && 'lg:items-center')}>
            <div className={cx('min-w-0', compact ? 'lg:max-w-64' : '')}>
              <div className="flex items-center justify-end gap-2 sm:justify-between">
                <div className={cx('min-w-0 flex-wrap items-center gap-3', showTitleOnMobile ? 'flex' : 'hidden sm:flex')}>
                  <h1 className={cx('section-title !text-3xl', compact && '!text-2xl')}>{title}</h1>
                  {typeof total !== 'undefined' ? <span className="badge badge-dim shrink-0">{total}</span> : null}
                  {filterCount > 0 ? <span className="badge badge-dim shrink-0">{resolvedFilterLabel}</span> : null}
                </div>
                {viewMenu || sortButton || addButton ? (
                  <div className={cx('shrink-0 items-center justify-end gap-1.5 sm:hidden', mobileCompact ? 'hidden' : 'flex')}>
                    {viewMenu}
                    {sortButton}
                    {addButton}
                  </div>
                ) : null}
              </div>
              {description ? <p className={cx('mt-1 hidden text-sm text-ghost sm:block', compact && 'lg:hidden')}>{description}</p> : null}
            </div>

            <div
              className={cx(
                'grid min-w-0 flex-1 gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end',
                mobileToolbarGridClass,
                toolbarClassName
              )}
              data-testid={toolbarTestId}
            >
              {toolbarControls}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SectionTabPanel({ tabId, activeId, tabKey, idBase, className = '', children, keepMounted = false }) {
  const generatedIdBase = useId().replace(/:/g, '');
  const tabsIdBase = idBase || `section-tabs-${generatedIdBase}`;
  const active = activeId === tabKey;
  return (
    <section
      id={`${tabsIdBase}-panel-${tabKey}`}
      role="tabpanel"
      aria-labelledby={`${tabsIdBase}-tab-${tabKey}`}
      hidden={!active}
      className={cx(className, !active && 'hidden')}
      tabIndex={0}
      data-tab-panel={tabId || tabKey}
    >
      {active || keepMounted ? children : null}
    </section>
  );
}

export function CollectionPaginationFooter({
  page = 1,
  totalPages = 1,
  hasMore = false,
  loading = false,
  pageSize = 50,
  onPageSizeChange,
  onPrevious,
  onNext,
  pageSizeOptions = [25, 50, 100],
  leadingContent = null,
  showPageSize = true,
  className = '',
  alignEndWhenSingle = true
}) {
  const showPager = Number(totalPages || 1) > 1 || Number(page || 1) > 1 || Boolean(hasMore);
  const pageSizeId = useId();

  return (
    <div className={cx('shrink-0 border-t border-edge px-6 py-2.5 flex items-center gap-4 flex-wrap', className)}>
      {leadingContent ? <div className="text-sm text-ghost">{leadingContent}</div> : null}
      {showPager ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onPrevious}
            disabled={loading || page <= 1}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim transition-colors hover:bg-raised/55 hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-dim"
            aria-label="Previous page"
          >
            <Icons.ChevronLeft />
          </button>
          <span className="min-w-[88px] text-center text-xs font-mono text-dim">
            Page {page} / {totalPages || 1}
          </span>
          <button
            onClick={onNext}
            disabled={loading || !hasMore}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim transition-colors hover:bg-raised/55 hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-dim"
            aria-label="Next page"
          >
            <Icons.ChevronRight />
          </button>
        </div>
      ) : null}
      {showPageSize ? (
        <div className={cx('flex items-center gap-2.5 text-xs', (alignEndWhenSingle || showPager || leadingContent) && 'ml-auto')}>
          <label className="text-[11px] text-dim" htmlFor={pageSizeId}>
            Show
          </label>
          <select
            id={pageSizeId}
            className="select h-7 w-20 border-edge bg-transparent pr-7 text-xs text-dim hover:border-muted focus:border-gold/50 focus:ring-gold/30"
            value={pageSize}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          >
            {pageSizeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

export function ImageSourceControl({
  label = 'Image',
  selectedFile,
  selectedLabel = 'Selected file',
  chooseLabel = 'Choose from Library',
  cameraLabel = 'Take Photo',
  accept = 'image/*',
  className = '',
  onChooseFile,
  onCamera,
  onCameraFile
}) {
  const libraryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const selectedName = typeof selectedFile === 'string' ? selectedFile : selectedFile?.name;

  const pickFile = (event, handler) => {
    const file = event.target.files?.[0] || null;
    handler?.(file);
    event.target.value = '';
  };

  const startCamera = () => {
    if (onCamera) {
      onCamera();
      return;
    }
    cameraInputRef.current?.click();
  };

  return (
    <div className={cx('field', className)}>
      <span className="label">{label}</span>
      <div className="rounded-lg border border-edge/70 bg-void/30 p-2.5">
        <input ref={libraryInputRef} type="file" accept={accept} className="hidden" onChange={(event) => pickFile(event, onChooseFile)} />
        {!onCamera ? (
          <input
            ref={cameraInputRef}
            type="file"
            accept={accept}
            capture="environment"
            className="hidden"
            onChange={(event) => pickFile(event, onCameraFile || onChooseFile)}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => libraryInputRef.current?.click()}>
            <Icons.Upload />
            {chooseLabel}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={startCamera}>
            <Icons.Camera />
            {cameraLabel}
          </button>
        </div>
        {selectedName ? (
          <p className="mt-2 text-xs text-ghost">
            {selectedLabel}: {selectedName}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CoverImagePicker({
  label = 'Image',
  imagePath = '',
  selectedFile = null,
  emptyLabel = 'Add image',
  replaceLabel = 'Replace image',
  removeLabel = 'Remove image',
  className = '',
  disabled = false,
  onSelectFile,
  onRemove
}) {
  const inputRef = useRef(null);
  const previewUrl = useMemo(() => (selectedFile ? URL.createObjectURL(selectedFile) : ''), [selectedFile]);
  const selectedName = selectedFile?.name || '';
  const displayUrl = previewUrl || posterUrl(imagePath);

  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleSelection = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (file) onSelectFile?.(file);
  };

  return (
    <div className={cx('space-y-2', className)}>
      <span className="label">{label}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="poster relative w-full overflow-hidden rounded-md border border-edge bg-panel text-left transition-colors hover:border-muted disabled:cursor-not-allowed"
      >
        {displayUrl ? (
          <img src={displayUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-ghost">
            <Icons.Film />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 border-t border-edge bg-panel/95 p-3">
          <p className="text-sm font-medium text-ink">{displayUrl ? replaceLabel : emptyLabel}</p>
          {!displayUrl ? <p className="text-[11px] leading-4 text-dim">Photo library, camera, or file</p> : null}
        </div>
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleSelection} />
      {selectedName ? <p className="text-xs text-ghost">Selected: {selectedName}</p> : null}
      {imagePath && !selectedFile && onRemove ? (
        <button type="button" onClick={onRemove} disabled={disabled} className="btn-secondary btn-sm w-full text-err">
          <Icons.Trash />
          {removeLabel}
        </button>
      ) : null}
    </div>
  );
}

function DisclosureChevron({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cx('h-4 w-4 shrink-0 text-ghost transition-transform duration-150', open && 'rotate-90')}
    >
      <path d="M7 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DisclosureList({ items = [], openId, onToggle, className = '', renderSummary, renderContent }) {
  const generatedIdBase = useId().replace(/:/g, '');
  const listIdBase = `disclosure-list-${generatedIdBase}`;

  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className={cx('divide-y divide-edge/60 rounded-md border border-edge/60', className)}>
      {items.map((item, index) => {
        const isOpen = openId === item.id;
        const buttonId = `${listIdBase}-button-${item.id}`;
        const panelId = `${listIdBase}-panel-${item.id}`;
        return (
          <div key={item.id}>
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => onToggle?.(isOpen ? null : item.id)}
                className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-raised/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/35"
              >
                <div className="min-w-0 flex-1">
                  {renderSummary ? (
                    renderSummary(item, { open: isOpen, index })
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink">{item.title}</p>
                      {item.summary ? <p className="mt-1 text-sm text-ghost">{item.summary}</p> : null}
                    </>
                  )}
                </div>
                <DisclosureChevron open={isOpen} />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen} className={cx('px-4 pb-4', !isOpen && 'hidden')}>
              {isOpen && (renderContent ? renderContent(item, { open: isOpen, index }) : null)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function inferTmdbSearchType(mediaType) {
  return mediaType === 'tv_series' || mediaType === 'tv_episode' ? 'tv' : 'movie';
}

export const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV Series' },
  { value: 'book', label: 'Book' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'comic_book', label: 'Comic Book' }
];

export function mediaTypeLabel(value) {
  return MEDIA_TYPES.find((m) => m.value === value)?.label || 'Comic Book';
}

export function readCookie(name) {
  const raw = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.split('=').slice(1).join('='));
  } catch (_) {
    return raw.split('=').slice(1).join('=');
  }
}

export function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,select,textarea,label,[role="button"]'));
}

function getBarcodeDetectorClass() {
  if (typeof window === 'undefined') return null;
  return window.BarcodeDetector || null;
}

function canAttemptBrowserBarcodeDecode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return typeof Image !== 'undefined' && typeof URL?.createObjectURL === 'function';
}

export function supportsBarcodeCapture() {
  return canAttemptBrowserBarcodeDecode();
}

async function loadImageForBarcodeDetection(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load captured image'));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function normalizeBarcodeInput(rawValue = '') {
  return String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z-]/g, '')
    .trim();
}

export function inferBookBarcodeIdentifier(rawValue = '') {
  const digits = normalizeBarcodeInput(rawValue).replace(/\D+/g, '');
  if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) {
    return digits;
  }
  return '';
}

export function isLikelyRetailBookBarcode(rawValue = '') {
  const digits = normalizeBarcodeInput(rawValue).replace(/\D+/g, '');
  return digits.length === 12;
}

export function normalizeIsbnCandidate(rawValue = '') {
  const token = String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  if (!token) return '';

  const computeIsbn13CheckDigit = (core) => {
    let sum = 0;
    for (let index = 0; index < core.length; index += 1) {
      sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  };

  if (/^\d{13}$/.test(token) && (token.startsWith('978') || token.startsWith('979'))) {
    return computeIsbn13CheckDigit(token.slice(0, 12)) === Number(token[12]) ? token : '';
  }

  if (!/^\d{9}[\dX]$/.test(token)) return '';

  let isbn10Checksum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = token[index];
    const digit = char === 'X' ? 10 : Number(char);
    isbn10Checksum += digit * (10 - index);
  }
  if (isbn10Checksum % 11 !== 0) return '';

  const core = `978${token.slice(0, 9)}`;
  return `${core}${computeIsbn13CheckDigit(core)}`;
}

function expandOcrIsbnCandidates(rawValue = '') {
  const token = String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  if (!(token.length === 10 || token.length === 13)) return [];

  const substitutions = {
    O: ['0'],
    Q: ['0'],
    D: ['0'],
    I: ['1'],
    L: ['1'],
    T: ['1'],
    Z: ['2'],
    A: ['4'],
    S: ['5'],
    G: ['6'],
    B: ['8'],
    X: token.length === 10 ? ['X'] : []
  };

  const options = [];
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (/\d/.test(char)) {
      options.push([char]);
      continue;
    }
    const replacements = substitutions[char] || [];
    if (char === 'X' && token.length === 10 && index === 9) {
      options.push(['X']);
      continue;
    }
    if (!replacements.length) return [];
    options.push(replacements);
  }

  const variants = new Set();
  const walk = (index, built) => {
    if (variants.size >= 24) return;
    if (index >= options.length) {
      const normalized = normalizeIsbnCandidate(built);
      if (normalized) variants.add(normalized);
      return;
    }
    for (const candidate of options[index]) {
      walk(index + 1, `${built}${candidate}`);
      if (variants.size >= 24) return;
    }
  };

  walk(0, '');
  return Array.from(variants);
}

function normalizeDetectedBarcode(rawValue = '') {
  return normalizeBarcodeInput(rawValue);
}

async function detectFirstBarcode(detector, source) {
  const detections = await detector.detect(source);
  const first = detections?.find((item) => item?.rawValue);
  const rawValue = normalizeDetectedBarcode(first?.rawValue || '');
  return rawValue
    ? {
        rawValue,
        boundingBox: first?.boundingBox || null
      }
    : null;
}

let zxingDecoderPromise = null;
let tesseractWorkerPromise = null;

async function loadZxingDecoder() {
  if (!zxingDecoderPromise) {
    zxingDecoderPromise = Promise.all([import('@zxing/browser'), import('@zxing/library')])
      .then(([browserModule, libraryModule]) => {
        const BrowserMultiFormatReader = browserModule?.BrowserMultiFormatReader || browserModule?.default?.BrowserMultiFormatReader;
        const BarcodeFormat = browserModule?.BarcodeFormat || libraryModule?.BarcodeFormat;
        const DecodeHintType = libraryModule?.DecodeHintType;
        if (!BrowserMultiFormatReader || !BarcodeFormat || !DecodeHintType) {
          throw new Error('unsupported');
        }

        const formats = [
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODABAR
        ].filter(Boolean);

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(DecodeHintType.TRY_HARDER, true);

        return new BrowserMultiFormatReader(hints);
      })
      .catch((error) => {
        zxingDecoderPromise = null;
        throw error;
      });
  }

  return zxingDecoderPromise;
}

async function loadTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = import('tesseract.js')
      .then(async (module) => {
        const createWorker = module?.createWorker || module?.default?.createWorker;
        const PSM = module?.PSM || module?.default?.PSM || {};
        if (typeof createWorker !== 'function') {
          throw new Error('unsupported');
        }
        const worker = await createWorker('eng', 1, {
          logger: () => {},
          errorHandler: () => {}
        });
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: '1',
          tessedit_char_whitelist: '0123456789XxABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-: '
        });
        return { worker, PSM };
      })
      .catch((error) => {
        tesseractWorkerPromise = null;
        throw error;
      });
  }

  return tesseractWorkerPromise;
}

function createBarcodeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function drawBarcodeVariant(source, { rotate = 0, crop = null, grayscale = false, contrast = 1, maxDimension = 1600 } = {}) {
  const sourceWidth = source.naturalWidth || source.videoWidth || source.width;
  const sourceHeight = source.naturalHeight || source.videoHeight || source.height;
  if (!sourceWidth || !sourceHeight) return null;

  const cropRect = crop
    ? {
        x: Math.max(0, Math.round(sourceWidth * crop.x)),
        y: Math.max(0, Math.round(sourceHeight * crop.y)),
        width: Math.max(1, Math.round(sourceWidth * crop.width)),
        height: Math.max(1, Math.round(sourceHeight * crop.height))
      }
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  const aspectScale = Math.min(1, maxDimension / Math.max(cropRect.width, cropRect.height));
  const drawWidth = Math.max(1, Math.round(cropRect.width * aspectScale));
  const drawHeight = Math.max(1, Math.round(cropRect.height * aspectScale));
  const isQuarterTurn = Math.abs(rotate) % 180 === 90;
  const canvas = createBarcodeCanvas(isQuarterTurn ? drawHeight : drawWidth, isQuarterTurn ? drawWidth : drawHeight);
  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) return null;

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (grayscale || contrast !== 1) {
    const filters = [];
    if (grayscale) filters.push('grayscale(1)');
    if (contrast !== 1) filters.push(`contrast(${contrast})`);
    context.filter = filters.join(' ');
  }

  if (rotate === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotate === -90) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  } else if (rotate === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  }

  context.drawImage(source, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, drawWidth, drawHeight);
  context.restore();
  return canvas;
}

function createBarcodeDetectionVariants(source) {
  const variants = [];
  const pushVariant = (label, options) => {
    const canvas = drawBarcodeVariant(source, options);
    if (canvas) variants.push({ label, source: canvas });
  };

  pushVariant('full-resized', { maxDimension: 1800 });
  pushVariant('full-contrast', { maxDimension: 1800, grayscale: true, contrast: 1.6 });
  pushVariant('bottom-half', { crop: { x: 0, y: 0.45, width: 1, height: 0.55 }, maxDimension: 1800 });
  pushVariant('bottom-half-contrast', {
    crop: { x: 0, y: 0.45, width: 1, height: 0.55 },
    maxDimension: 1800,
    grayscale: true,
    contrast: 1.8
  });
  pushVariant('bottom-third', { crop: { x: 0.05, y: 0.58, width: 0.9, height: 0.32 }, maxDimension: 1800, grayscale: true, contrast: 1.9 });
  pushVariant('rotated-right', { rotate: 90, maxDimension: 1800 });
  pushVariant('rotated-left', { rotate: -90, maxDimension: 1800 });

  return variants;
}

function clampCropRect(rect = {}) {
  const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
  const width = Math.max(0.02, Math.min(1 - x, Number(rect.width) || 0));
  const height = Math.max(0.02, Math.min(1 - y, Number(rect.height) || 0));
  return { x, y, width, height };
}

function normalizeBoundingBoxToCrop(source, boundingBox) {
  const sourceWidth = source?.naturalWidth || source?.videoWidth || source?.width || 0;
  const sourceHeight = source?.naturalHeight || source?.videoHeight || source?.height || 0;
  if (!sourceWidth || !sourceHeight || !boundingBox) return null;
  const x = Number(boundingBox.x);
  const y = Number(boundingBox.y);
  const width = Number(boundingBox.width);
  const height = Number(boundingBox.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return clampCropRect({
    x: x / sourceWidth,
    y: y / sourceHeight,
    width: width / sourceWidth,
    height: height / sourceHeight
  });
}

function createIdentifierOcrVariants(source, focusCrop = null) {
  const variants = [];
  const pushVariant = (label, options, ocrMode = 'block') => {
    const canvas = drawBarcodeVariant(source, options);
    if (canvas) variants.push({ label, source: canvas, ocrMode });
  };

  if (focusCrop) {
    const paddedFocus = clampCropRect({
      x: focusCrop.x - 0.08,
      y: focusCrop.y - 0.08,
      width: focusCrop.width + 0.16,
      height: focusCrop.height + 0.16
    });
    const belowFocus = clampCropRect({
      x: focusCrop.x - 0.06,
      y: focusCrop.y + focusCrop.height - 0.02,
      width: focusCrop.width + 0.12,
      height: Math.max(focusCrop.height * 0.7, 0.12)
    });
    const aboveAndBelowFocus = clampCropRect({
      x: focusCrop.x - 0.08,
      y: focusCrop.y - Math.max(focusCrop.height * 0.3, 0.05),
      width: focusCrop.width + 0.16,
      height: focusCrop.height + Math.max(focusCrop.height * 0.9, 0.18)
    });

    pushVariant('barcode-focus', { crop: paddedFocus, maxDimension: 2200, grayscale: true, contrast: 2.4 });
    pushVariant('barcode-focus-below', { crop: belowFocus, maxDimension: 2200, grayscale: true, contrast: 2.6 });
    pushVariant('barcode-focus-context', { crop: aboveAndBelowFocus, maxDimension: 2200, grayscale: true, contrast: 2.3 });

    const isbnStrip = clampCropRect({
      x: focusCrop.x - 0.03,
      y: focusCrop.y - Math.max(focusCrop.height * 0.34, 0.07),
      width: focusCrop.width + 0.08,
      height: Math.max(focusCrop.height * 0.18, 0.08)
    });
    const isbnStripLeft = clampCropRect({
      x: focusCrop.x - 0.02,
      y: focusCrop.y - Math.max(focusCrop.height * 0.34, 0.07),
      width: Math.max(focusCrop.width * 0.72, 0.22),
      height: Math.max(focusCrop.height * 0.18, 0.08)
    });

    pushVariant('barcode-focus-isbn-strip', { crop: isbnStrip, maxDimension: 2600, grayscale: true, contrast: 3.0 }, 'single-line');
    pushVariant(
      'barcode-focus-isbn-strip-left',
      { crop: isbnStripLeft, maxDimension: 2600, grayscale: true, contrast: 3.1 },
      'single-line'
    );
  }

  pushVariant('bottom-third-contrast', {
    crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 },
    maxDimension: 2000,
    grayscale: true,
    contrast: 2.2
  });
  pushVariant('bottom-half-contrast', {
    crop: { x: 0, y: 0.42, width: 1, height: 0.58 },
    maxDimension: 2000,
    grayscale: true,
    contrast: 2.0
  });
  pushVariant('bottom-quarter-tight', {
    crop: { x: 0.08, y: 0.68, width: 0.84, height: 0.2 },
    maxDimension: 2200,
    grayscale: true,
    contrast: 2.5
  });
  pushVariant('bottom-right-quarter', {
    crop: { x: 0.45, y: 0.58, width: 0.5, height: 0.3 },
    maxDimension: 2200,
    grayscale: true,
    contrast: 2.4
  });
  pushVariant('full-contrast', { maxDimension: 1800, grayscale: true, contrast: 1.8 });
  pushVariant('bottom-third-rotated-right', {
    crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 },
    maxDimension: 2000,
    grayscale: true,
    contrast: 2.2,
    rotate: 90
  });
  pushVariant('bottom-third-rotated-left', {
    crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 },
    maxDimension: 2000,
    grayscale: true,
    contrast: 2.2,
    rotate: -90
  });

  return variants;
}

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractSlidingWindowIsbnCandidates(rawText = '') {
  const tokenStream = String(rawText || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (tokenStream.length < 10) return [];

  const candidates = new Set();

  for (let start = 0; start <= tokenStream.length - 10; start += 1) {
    const isbn10Slice = tokenStream.slice(start, start + 10);
    const isbn10Normalized = normalizeIsbnCandidate(isbn10Slice);
    if (isbn10Normalized) {
      candidates.add(isbn10Normalized);
    }
  }

  for (let start = 0; start <= tokenStream.length - 13; start += 1) {
    const isbn13Slice = tokenStream.slice(start, start + 13);
    const isbn13Normalized = normalizeIsbnCandidate(isbn13Slice);
    if (isbn13Normalized) {
      candidates.add(isbn13Normalized);
    }
  }

  return Array.from(candidates);
}

function extractIdentifierCandidatesFromText(rawText = '') {
  const text = String(rawText || '');
  if (!text.trim()) {
    return {
      isbnCandidates: [],
      strictIsbnCandidates: [],
      labeledIsbnCandidates: [],
      upcCandidates: [],
      asinCandidates: [],
      rawText: ''
    };
  }

  const isbnCandidates = [];
  const strictIsbnCandidates = [];
  const labeledIsbnCandidates = [];
  const upcCandidates = [];
  const asinCandidates = [];

  const normalizedText = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
  const ocrNormalizedText = normalizedText
    .replace(/(?<=\d)[Ss](?=[\dXx])/g, '5')
    .replace(/(?<=\d)[Bb](?=[\dXx])/g, '8')
    .replace(/(?<=\d)[Gg](?=[\dXx])/g, '6')
    .replace(/(?<=\d)[Zz](?=[\dXx])/g, '2')
    .replace(/(?<=\d)[Qq](?=[\dXx])/g, '0');

  const isbnLabelPattern = /ISBN(?:-1[03])?[\s:]*([0-9A-Za-z\- ]{10,20})/gi;
  let isbnMatch = isbnLabelPattern.exec(ocrNormalizedText);
  while (isbnMatch) {
    const rawCandidate = isbnMatch[1] || '';
    const normalized = normalizeIsbnCandidate(rawCandidate);
    if (normalized) {
      isbnCandidates.push(normalized);
      strictIsbnCandidates.push(normalized);
      labeledIsbnCandidates.push(normalized);
    } else {
      const expanded = expandOcrIsbnCandidates(rawCandidate);
      isbnCandidates.push(...expanded);
      labeledIsbnCandidates.push(...expanded);
    }
    isbnMatch = isbnLabelPattern.exec(ocrNormalizedText);
  }

  const asinPattern = /\bASIN[\s:]*([A-Z0-9]{10})\b/gi;
  let asinMatch = asinPattern.exec(ocrNormalizedText.toUpperCase());
  while (asinMatch) {
    const candidate = String(asinMatch[1] || '')
      .trim()
      .toUpperCase();
    if (candidate) asinCandidates.push(candidate);
    asinMatch = asinPattern.exec(ocrNormalizedText.toUpperCase());
  }

  const bareDigitRuns = ocrNormalizedText.match(/\b[0-9A-Za-z][0-9A-Za-z\- ]{8,22}\b/g) || [];
  for (const candidate of bareDigitRuns) {
    const normalizedIsbn = normalizeIsbnCandidate(candidate);
    if (normalizedIsbn) {
      isbnCandidates.push(normalizedIsbn);
      strictIsbnCandidates.push(normalizedIsbn);
    } else {
      isbnCandidates.push(...expandOcrIsbnCandidates(candidate));
    }

    const digits = normalizeBarcodeInput(candidate).replace(/\D+/g, '');
    if (digits.length === 12 || digits.length === 13) {
      upcCandidates.push(digits);
    }
  }

  for (const candidate of extractSlidingWindowIsbnCandidates(ocrNormalizedText)) {
    isbnCandidates.push(candidate);
    strictIsbnCandidates.push(candidate);
  }

  return {
    isbnCandidates: uniqueNonEmpty(isbnCandidates),
    strictIsbnCandidates: uniqueNonEmpty(strictIsbnCandidates),
    labeledIsbnCandidates: uniqueNonEmpty(labeledIsbnCandidates),
    upcCandidates: uniqueNonEmpty(upcCandidates),
    asinCandidates: uniqueNonEmpty(asinCandidates),
    rawText: ocrNormalizedText
  };
}

async function runIdentifierOcr(source, options = {}) {
  const { worker, PSM } = await loadTesseractWorker();
  const aggregate = {
    isbnCandidates: [],
    strictIsbnCandidates: [],
    labeledIsbnCandidates: [],
    upcCandidates: [],
    asinCandidates: [],
    rawText: []
  };
  const focusCrop = normalizeBoundingBoxToCrop(source, options?.boundingBox);

  for (const variant of createIdentifierOcrVariants(source, focusCrop)) {
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: variant.ocrMode === 'single-line' ? PSM.SINGLE_LINE || PSM.SINGLE_BLOCK : PSM.SINGLE_BLOCK || 6,
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: '0123456789XxABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-: '
      });
      const { data } = await worker.recognize(variant.source, { rotateAuto: true }, { text: true });
      const parsed = extractIdentifierCandidatesFromText(data?.text || '');
      aggregate.isbnCandidates.push(...parsed.isbnCandidates);
      aggregate.strictIsbnCandidates.push(...parsed.strictIsbnCandidates);
      aggregate.labeledIsbnCandidates.push(...parsed.labeledIsbnCandidates);
      aggregate.upcCandidates.push(...parsed.upcCandidates);
      aggregate.asinCandidates.push(...parsed.asinCandidates);
      if (parsed.rawText) aggregate.rawText.push(parsed.rawText);
    } catch (_) {
      // Keep trying OCR variants before giving up.
    } finally {
      if (variant?.source?.width) {
        variant.source.width = 1;
        variant.source.height = 1;
      }
    }
  }

  return {
    isbnCandidates: uniqueNonEmpty(aggregate.isbnCandidates),
    strictIsbnCandidates: uniqueNonEmpty(aggregate.strictIsbnCandidates),
    labeledIsbnCandidates: uniqueNonEmpty(aggregate.labeledIsbnCandidates),
    upcCandidates: uniqueNonEmpty(aggregate.upcCandidates),
    asinCandidates: uniqueNonEmpty(aggregate.asinCandidates),
    rawText: aggregate.rawText.join('\n').trim()
  };
}

async function detectBarcodeWithZxing(source) {
  const reader = await loadZxingDecoder();
  for (const variant of createBarcodeDetectionVariants(source)) {
    try {
      const result = reader.decodeFromCanvas(variant.source);
      const detected = normalizeDetectedBarcode(result?.getText?.() || result?.text || '');
      if (detected) {
        return detected;
      }
    } catch (_) {
      // Keep trying transformed variants before giving up.
    } finally {
      if (variant?.source?.width) {
        variant.source.width = 1;
        variant.source.height = 1;
      }
    }
  }

  throw new Error('not-found');
}

export async function detectBarcodeCapturePayloadFromFile(file) {
  const source = await loadImageForBarcodeDetection(file);

  try {
    const BarcodeDetectorClass = getBarcodeDetectorClass();
    if (BarcodeDetectorClass) {
      const preferredFormats = ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39', 'codabar'];

      let formats = preferredFormats;
      if (typeof BarcodeDetectorClass.getSupportedFormats === 'function') {
        try {
          const supported = await BarcodeDetectorClass.getSupportedFormats();
          const filtered = preferredFormats.filter((format) => supported.includes(format));
          if (filtered.length) formats = filtered;
        } catch (_) {
          // Keep preferred defaults when the browser refuses supported-format probing.
        }
      }

      const detector = new BarcodeDetectorClass({ formats });
      const rawDetected = await detectFirstBarcode(detector, source);
      if (rawDetected?.rawValue) {
        return {
          code: rawDetected.rawValue,
          boundingBox: rawDetected.boundingBox || null,
          detectedBy: 'barcode-detector'
        };
      }

      for (const variant of createBarcodeDetectionVariants(source)) {
        try {
          const detected = await detectFirstBarcode(detector, variant.source);
          if (detected?.rawValue) {
            return {
              code: detected.rawValue,
              boundingBox: null,
              detectedBy: 'barcode-detector-variant'
            };
          }
        } catch (_) {
          // Keep trying transformed variants before giving up.
        } finally {
          if (variant?.source?.width) {
            variant.source.width = 1;
            variant.source.height = 1;
          }
        }
      }
    }

    if (!canAttemptBrowserBarcodeDecode()) {
      throw new Error('unsupported');
    }

    return {
      code: await detectBarcodeWithZxing(source),
      boundingBox: null,
      detectedBy: 'zxing'
    };
  } finally {
    if (source && typeof source.close === 'function') {
      source.close();
    }
  }
}

export async function detectBarcodeFromFile(file) {
  const payload = await detectBarcodeCapturePayloadFromFile(file);
  return payload?.code || '';
}

export async function extractIdentifierCandidatesFromFile(file, options = {}) {
  if (!canAttemptBrowserBarcodeDecode()) {
    throw new Error('unsupported');
  }

  const source = await loadImageForBarcodeDetection(file);
  try {
    return await runIdentifierOcr(source, options);
  } finally {
    if (source && typeof source.close === 'function') {
      source.close();
    }
  }
}

const Icon = ({ d, size = 20, className = '', strokeWidth = 1.75 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d={d} />
  </svg>
);

export const Icons = {
  Library: () => <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
  Plus: () => <Icon d="M12 5v14M5 12h14" />,
  Search: () => <Icon d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />,
  Settings: () => (
    <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  ),
  Users: () => (
    <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  ),
  Activity: () => <Icon d="M3 12h4l2.5-7 4 14 2.5-7H21" />,
  Gauge: () => <Icon d="M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0M6.7 16.3a6 6 0 1 1 10.6 0" />,
  List: () => <Icon d="M4 7h16M4 12h16M4 17h16" />,
  Profile: () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  Integrations: () => <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6" />,
  ChevronDown: () => <Icon d="M6 9l6 6 6-6" size={16} />,
  ChevronRight: () => <Icon d="M9 18l6-6-6-6" size={16} />,
  ChevronLeft: () => <Icon d="M15 18l-6-6 6-6" size={16} />,
  Menu: () => <Icon d="M3 12h18M3 6h18M3 18h18" />,
  X: () => <Icon d="M18 6L6 18M6 6l12 12" />,
  Trash: () => <Icon d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4h6v2" />,
  Edit: () => (
    <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  ),
  Film: () => <Icon d="M2 8h20M2 16h20M7 2v20M17 2v20M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" />,
  MusicNote: () => <Icon d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM9 8l11-2" />,
  Palette: () => (
    <Icon d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 1.2-3.15 1.7 1.7 0 0 1 1.15-2.95H17a4 4 0 0 0 4-4c0-4.42-4.03-7.9-9-7.9zM7.5 10h.01M10 6.8h.01M14 6.8h.01M16.5 10h.01" />
  ),
  BookOpen: () => (
    <Icon d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5z" />
  ),
  Speech: () => <Icon d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3 1.6-4.8A7.5 7.5 0 1 1 21 11.5z" />,
  BoxOpen: () => <Icon d="M3 8l9 4 9-4M3 8l3.5-4L12 6.5 17.5 4 21 8v9l-9 4-9-4V8zM12 12v9" />,
  Calendar: () => <Icon d="M7 2v4M17 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
  Handoff: () => (
    <Icon d="M7 11V6a2 2 0 0 1 4 0v4M11 10V5a2 2 0 0 1 4 0v7M15 12V7a2 2 0 0 1 4 0v7a7 7 0 0 1-7 7H9l-5-5a2 2 0 0 1 2.8-2.8L9 15" />
  ),
  Clapper: () => <Icon d="M4 11h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9zM4 11l2-7h4l-2 7M10 11l2-7h4l-2 7M16 11l2-7h2a2 2 0 0 1 2 2v5" />,
  Tv: () => <Icon d="M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 3l4 4 4-4" />,
  InboxTray: () => <Icon d="M4 4h16l2 10v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L4 4zM2 14h6l2 3h4l2-3h6" />,
  Gamepad: () => (
    <Icon d="M7 15h.01M17 13h.01M15 17h.01M9 13h.01M8 10h8a6 6 0 0 1 5.8 4.5l.7 2.8A3 3 0 0 1 17.6 20l-2.1-2H8.5l-2.1 2a3 3 0 0 1-4.9-2.7l.7-2.8A6 6 0 0 1 8 10z" />
  ),
  Filter: () => <Icon d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />,
  Barcode: () => <Icon d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />,
  Camera: () => (
    <Icon d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
  ),
  Eye: () => <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  EyeOff: () => (
    <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
  ),
  Upload: () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  Download: () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  Mail: () => <Icon d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM22 8l-10 7L2 8" />,
  Star: () => <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  LogOut: () => <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  Copy: () => (
    <Icon d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1" />
  ),
  Check: ({ size = 20 } = {}) => <Icon d="M20 6L9 17l-5-5" size={size} />,
  Refresh: () => <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />,
  Play: () => <Icon d="M5 3l14 9-14 9V3z" />,
  Link: () => (
    <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  ),
  ArrowUp: () => <Icon d="M12 19V5M5 12l7-7 7 7" />,
  ArrowDown: () => <Icon d="M12 5v14M19 12l-7 7-7-7" />
};

export function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-gold" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="31.4"
        strokeDashoffset="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CameraCaptureModal({
  open = false,
  title = 'Capture image',
  description = 'Use your device camera to capture an image.',
  onClose,
  onCapture,
  confirmLabel = 'Use capture'
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedUrl, setCapturedUrl] = useState('');
  const capturedUrlRef = useRef('');

  useEffect(() => {
    capturedUrlRef.current = capturedUrl;
  }, [capturedUrl]);

  const releaseCapturedUrl = useCallback(() => {
    if (capturedUrlRef.current) {
      URL.revokeObjectURL(capturedUrlRef.current);
      capturedUrlRef.current = '';
    }
  }, []);

  useEffect(() => {
    const stopStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    if (!open) {
      stopStream();
      // Closing the modal synchronizes camera/UI state with the external media stream lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStarting(false);
      setError('');
      releaseCapturedUrl();
      setCapturedBlob(null);
      setCapturedUrl('');
      return stopStream;
    }

    let cancelled = false;
    setStarting(true);
    setError('');
    releaseCapturedUrl();
    setCapturedBlob(null);
    setCapturedUrl('');

    const startCamera = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError('Camera access is not supported in this browser.');
          setStarting(false);
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack?.applyConstraints) {
          try {
            await videoTrack.applyConstraints({
              advanced: [{ width: 1920, height: 1080 }, { focusMode: 'continuous' }]
            });
          } catch (_) {
            // Keep the best-effort camera stream when the browser rejects advanced constraints.
          }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Unable to access the device camera.');
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, releaseCapturedUrl]);

  if (!open) return null;

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('Camera preview is not ready yet.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Capture is not available in this browser.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Failed to capture image.');
        return;
      }
      releaseCapturedUrl();
      setCapturedBlob(blob);
      setCapturedUrl(URL.createObjectURL(blob));
      setError('');
    }, 'image/png');
  };

  const useCapture = async () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await onCapture?.(file);
    onClose?.();
  };

  const resetCapture = () => {
    releaseCapturedUrl();
    setCapturedBlob(null);
    setCapturedUrl('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button type="button" className="absolute inset-0 bg-void/78" onClick={onClose} aria-label="Close camera capture" />
      <div className="relative w-full max-w-3xl rounded-xl border border-edge bg-abyss shadow-card overflow-hidden">
        <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
          <div className="flex-1">
            <h3 className="section-title !text-lg">{title}</h3>
            <p className="mt-1 text-sm text-ghost">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon btn-sm shrink-0">
            <Icons.X />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black">
            {capturedUrl ? (
              <img src={capturedUrl} alt="Captured frame" className="h-full w-full object-cover" />
            ) : (
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            )}
          </div>
          {starting ? (
            <div className="flex items-center gap-2 text-sm text-dim">
              <Spinner size={14} />
              Starting camera…
            </div>
          ) : null}
          {error ? <p className="text-sm text-err">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            {!capturedBlob ? (
              <button type="button" onClick={captureFrame} className="btn-primary" disabled={starting}>
                <Icons.Camera />
                Capture
              </button>
            ) : (
              <>
                <button type="button" onClick={resetCapture} className="btn-secondary">
                  <Icons.Refresh />
                  Retake
                </button>
                <button type="button" onClick={useCapture} className="btn-primary">
                  <Icons.Check />
                  {confirmLabel}
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="btn-ghost ml-auto">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ObjectPosterCard({
  title,
  imagePath,
  fallbackIcon = <Icons.Library />,
  supportsHover: _supportsHover = true,
  onOpen,
  onMouseDown,
  onPointerUp,
  selected = false,
  leftBadges = [],
  rightBadge = null,
  overlayChildren = null,
  subtitle = null,
  meta = null,
  titleClassName = '',
  articleClassName = ''
}) {
  const interactive = Boolean(onOpen || onMouseDown || onPointerUp);
  const handleKeyDown = (event) => {
    if (!onOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(event);
    }
  };

  return (
    // Existing browser coverage and card semantics expect article as the card container.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={interactive ? 0 : undefined}
      onMouseDown={onMouseDown}
      onClick={onOpen}
      onPointerUp={onPointerUp}
      onKeyDown={interactive ? handleKeyDown : undefined}
      className={cx('group relative animate-fade-in text-left', onOpen && 'cursor-pointer', articleClassName)}
    >
      <div
        className={cx(
          'poster rounded-lg overflow-hidden border transition-colors',
          selected ? 'border-brand/55' : 'border-edge',
          !selected && 'hover:border-muted'
        )}
      >
        {posterUrl(imagePath) ? (
          <img src={posterUrl(imagePath)} alt={title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ghost">
            {fallbackIcon}
            <span className="px-3 text-center text-xs leading-tight">{title}</span>
          </div>
        )}
        {leftBadges.length > 0 ? (
          <div className="absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-2">
            {leftBadges.map((badge, index) => (
              <span key={`${title}-badge-${index}`} className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        {rightBadge ? <div className="absolute right-2 top-2">{rightBadge}</div> : null}
        {overlayChildren}
      </div>
      <div className="mt-2 px-0.5">
        <p className={cx('min-w-0 truncate text-sm font-medium text-ink', titleClassName)}>{title}</p>
        {subtitle ? <p className="text-xs text-ghost">{subtitle}</p> : null}
        {meta ? <div className="mt-1 flex flex-wrap gap-2">{meta}</div> : null}
      </div>
    </article>
  );
}

export function CollectibleTraitPills({ traits = [], limit = 4, className = '' }) {
  const visibleTraits = Array.isArray(traits) ? traits.filter((trait) => trait?.label || trait?.summary).slice(0, limit) : [];
  if (visibleTraits.length === 0) return null;
  return (
    <div className={cx('flex flex-wrap gap-2', className)}>
      {visibleTraits.map((trait, index) => (
        <span
          key={trait.key || `${trait.family || 'trait'}-${index}`}
          className={cx(
            'inline-flex min-w-0 items-center rounded-md border px-2 py-1 text-[11px] font-medium',
            trait.tone === 'brand' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-edge bg-surface text-dim'
          )}
          title={trait.summary || trait.label}
        >
          <span className="truncate">{trait.summary || trait.label}</span>
        </span>
      ))}
    </div>
  );
}

export function CollectibleTraitReadback({ traits = [], className = '' }) {
  const visibleTraits = Array.isArray(traits) ? traits.filter((trait) => trait?.label || trait?.summary) : [];
  if (visibleTraits.length === 0) return null;
  return (
    <section className={cx('rounded-lg border border-edge bg-surface/45 p-3', className)}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-ghost">Collectible details</p>
      <div className="mt-3 space-y-2">
        {visibleTraits.map((trait, index) => (
          <div key={trait.key || `${trait.family || 'trait'}-${index}`} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-sm">
            <p className="text-ghost">{trait.label || 'Detail'}</p>
            <div className="min-w-0">
              <p className="text-ink">{trait.summary || trait.label}</p>
              {Array.isArray(trait.details) && trait.details.length ? (
                <p className="mt-1 text-xs leading-5 text-ghost">
                  {trait.details
                    .filter((detail) => detail?.label && detail?.value)
                    .map((detail) => `${detail.label}: ${detail.value}`)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const GRADER_OPTIONS = ['CGC', 'CBCS', 'PSA', 'Beckett', 'WATA', 'VGA', 'Other'];
const PROVENANCE_TYPE_OPTIONS = ['COA', 'Receipt', 'Witnessed signature', 'Vendor record', 'Event record', 'Other'];

function cleanTraitText(value) {
  return String(value || '').trim();
}

function detailValue(details = [], label) {
  return details.find((detail) => String(detail?.label || '').toLowerCase() === label)?.value || '';
}

export function DrawerMetadataList({ items = null, children, className = '' }) {
  const orderedItems = Array.isArray(items)
    ? items
        .filter((item) => item && item.metadata?.applies !== false)
        .sort((left, right) => {
          const leftPriority = Number(left?.metadata?.displayPriority ?? left?.displayPriority ?? 0);
          const rightPriority = Number(right?.metadata?.displayPriority ?? right?.displayPriority ?? 0);
          return leftPriority - rightPriority;
        })
    : [];
  return (
    <div className={cx('space-y-0', className)}>
      {orderedItems.length > 0
        ? orderedItems.map((item, index) => (
            <React.Fragment key={item.key || item.metadata?.id || index}>
              {typeof item.render === 'function' ? item.render(item.metadata) : item.node}
            </React.Fragment>
          ))
        : children}
    </div>
  );
}

export function DrawerOverview({ text = '', label = 'Overview', collapsedLines = 4, className = '', textClassName = '' }) {
  const contentId = useId();
  const textRef = useRef(null);
  const [expandedState, setExpandedState] = useState({ content: '', expanded: false });
  const [canExpand, setCanExpand] = useState(false);
  const content = String(text || '').trim();
  const expanded = expandedState.content === content ? expandedState.expanded : false;
  const lineCount = Number.isFinite(Number(collapsedLines)) && Number(collapsedLines) > 0 ? Number(collapsedLines) : 4;

  const measureOverflow = useCallback(() => {
    const element = textRef.current;
    if (!element) return;
    setCanExpand(element.scrollHeight > element.clientHeight + 1);
  }, []);

  useEffect(() => {
    if (!content) return undefined;
    if (expanded) return undefined;
    const frame = window.requestAnimationFrame(measureOverflow);
    const element = textRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [content, expanded, lineCount, measureOverflow]);

  if (!content) return null;

  return (
    <section className={className}>
      {label ? <p className="label mb-2">{label}</p> : null}
      <p
        ref={textRef}
        id={contentId}
        className={cx('text-sm leading-relaxed text-dim', textClassName)}
        style={
          !expanded
            ? {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lineCount,
                overflow: 'hidden'
              }
            : undefined
        }
      >
        {content}
      </p>
      {canExpand ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() =>
            setExpandedState((state) => ({
              content,
              expanded: state.content === content ? !state.expanded : true
            }))
          }
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </section>
  );
}

export function buildDrawerMetadataRenderItems(records = [], nodesById = {}) {
  return (Array.isArray(records) ? records : [])
    .map((record) => ({
      ...record,
      node: record?.node || nodesById?.[record?.id]
    }))
    .filter((record) => record && (record.node || record.render));
}

export function buildObjectDrawerMetadataEditorNodes({
  apiCall,
  ownerType = '',
  ownerId,
  mediaType = '',
  traits = [],
  onSaved,
  onToast,
  includeEdition = false
} = {}) {
  const nodes = {};
  if (!ownerId) return nodes;
  if (includeEdition) {
    nodes[DRAWER_METADATA_IDS.edition] = (
      <EditionVariantEditor
        apiCall={apiCall}
        ownerType={ownerType}
        ownerId={ownerId}
        mediaType={mediaType}
        traits={traits}
        onSaved={onSaved}
        onToast={onToast}
      />
    );
  }
  nodes[DRAWER_METADATA_IDS.grading] = (
    <CollectibleGradingEditor
      apiCall={apiCall}
      ownerType={ownerType}
      ownerId={ownerId}
      mediaType={mediaType}
      traits={traits}
      onSaved={onSaved}
      onToast={onToast}
    />
  );
  nodes[DRAWER_METADATA_IDS.proof] = (
    <CollectibleProvenanceEditor
      apiCall={apiCall}
      ownerType={ownerType}
      ownerId={ownerId}
      traits={traits}
      onSaved={onSaved}
      onToast={onToast}
    />
  );
  nodes[DRAWER_METADATA_IDS.related] = (
    <ObjectRelationshipEditor apiCall={apiCall} ownerType={ownerType} ownerId={ownerId} onToast={onToast} />
  );
  return nodes;
}

export function DrawerMetadataItem({
  label,
  title,
  summary = '',
  details = '',
  actionLabel = 'Add',
  onAction,
  actionDisabled = false,
  actions,
  children,
  className = '',
  testId
}) {
  const displayLabel = label || title;
  return (
    <section className={cx('border-b border-edge/70 py-2.5', className)} data-testid={testId}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5 text-ink">{displayLabel}</p>
          {summary ? <p className="mt-0.5 truncate text-sm leading-5 text-dim">{summary}</p> : null}
          {details ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ghost">{details}</p> : null}
        </div>
        {actions ||
          (onAction ? (
            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onAction} disabled={actionDisabled}>
              {actionLabel}
            </button>
          ) : null)}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

export function DrawerMetadataEntry({ metadata, actionLabel, onAction, actionDisabled = false, actions, children, className = '' }) {
  if (!metadata?.applies) return null;
  return (
    <DrawerMetadataItem
      label={metadata.label}
      summary={metadata.summary}
      details={metadata.details}
      actionLabel={actionLabel || (metadata.hasValue ? 'Edit' : metadata.emptyLabel)}
      onAction={onAction}
      actionDisabled={actionDisabled}
      actions={actions}
      className={className}
      testId={metadata.id ? `drawer-metadata-${metadata.id}` : undefined}
    >
      {children}
    </DrawerMetadataItem>
  );
}

function useKeyedDraft(draftKey, buildValue) {
  const [state, setState] = useState(() => ({ key: draftKey, value: buildValue() }));
  const value = state.key === draftKey ? state.value : buildValue();
  const setValue = useCallback(
    (nextValue) => {
      setState((previous) => {
        const currentValue = previous.key === draftKey ? previous.value : buildValue();
        return {
          key: draftKey,
          value: typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
        };
      });
    },
    [buildValue, draftKey]
  );
  return [value, setValue];
}

function buildEditionForm(trait = null, mediaType = 'movie') {
  const config = editionConfigForMediaType(mediaType);
  const payload = trait?.payload && typeof trait.payload === 'object' ? trait.payload : {};
  const details = Array.isArray(trait?.details) ? trait.details : [];
  const fields = {};
  for (const field of config.fields || []) {
    fields[field.key] = cleanTraitText(payload[field.key] || detailValue(details, field.label.toLowerCase()));
  }
  const flags = {};
  for (const flag of config.flags || []) {
    flags[flag.key] = Boolean(payload[flag.key]);
  }
  return {
    fields,
    flags,
    number: cleanTraitText(payload.number || detailValue(details, 'number')),
    run: cleanTraitText(payload.run || detailValue(details, 'run')),
    notes: cleanTraitText(payload.notes || detailValue(details, 'notes'))
  };
}

function humanizeEditionFlag(key = '') {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildEditionTraitPayload(form = {}, mediaType = 'movie') {
  const config = editionConfigForMediaType(mediaType);
  const fieldDetails = (config.fields || [])
    .map((field) => {
      const value = cleanTraitText(form.fields?.[field.key]);
      return value ? { label: field.label, value } : null;
    })
    .filter(Boolean);
  const flagDetails = (config.flags || [])
    .map((flag) => (form.flags?.[flag.key] ? { label: flag.label, value: 'Yes' } : null))
    .filter(Boolean);
  const number = cleanTraitText(form.number);
  const run = cleanTraitText(form.run);
  const notes = cleanTraitText(form.notes);
  const numberedSummary = number && run ? `#${number}/${run}` : number ? `#${number}` : run ? `Run ${run}` : '';
  const details = [
    ...fieldDetails,
    ...flagDetails,
    number ? { label: 'Number', value: number } : null,
    run ? { label: 'Run', value: run } : null,
    notes ? { label: 'Notes', value: notes } : null
  ].filter(Boolean);
  const summaryParts = [
    ...fieldDetails.slice(0, 2).map((detail) => detail.value),
    ...flagDetails.slice(0, 2).map((detail) => detail.label),
    numberedSummary
  ].filter(Boolean);
  const payload = {
    media_type: mediaType || null,
    notes: notes || null
  };
  for (const field of config.fields || []) {
    payload[field.key] = cleanTraitText(form.fields?.[field.key]) || null;
  }
  for (const flag of config.flags || []) {
    payload[flag.key] = Boolean(form.flags?.[flag.key]);
  }
  if (config.numbered) {
    payload.number = number || null;
    payload.run = run || null;
  }
  return {
    key: 'edition_variant',
    family: 'edition_variant',
    label: 'Edition',
    summary: summaryParts.join(' · ') || 'Edition details',
    tone: 'default',
    details,
    payload,
    source: 'manual'
  };
}

function buildGradingForm(trait = null) {
  const payload = trait?.payload && typeof trait.payload === 'object' ? trait.payload : {};
  const details = Array.isArray(trait?.details) ? trait.details : [];
  return {
    company: cleanTraitText(payload.company || payload.grader || detailValue(details, 'grader') || detailValue(details, 'company')),
    grade: cleanTraitText(payload.grade || detailValue(details, 'grade')),
    certificateNumber: cleanTraitText(
      payload.certificate_number || payload.certificateNumber || detailValue(details, 'cert') || detailValue(details, 'certificate')
    ),
    slabNotes: cleanTraitText(payload.slab_notes || payload.slabNotes || detailValue(details, 'slab')),
    gradedOn: cleanTraitText(payload.graded_on || payload.gradedOn || detailValue(details, 'graded'))
  };
}

function buildGradingTraitPayload(form = {}) {
  const company = cleanTraitText(form.company);
  const grade = cleanTraitText(form.grade);
  const certificateNumber = cleanTraitText(form.certificateNumber);
  const slabNotes = cleanTraitText(form.slabNotes);
  const gradedOn = cleanTraitText(form.gradedOn);
  const details = [
    company ? { label: 'Grader', value: company } : null,
    grade ? { label: 'Grade', value: grade } : null,
    certificateNumber ? { label: 'Cert', value: certificateNumber } : null,
    slabNotes ? { label: 'Slab', value: slabNotes } : null,
    gradedOn ? { label: 'Graded', value: gradedOn } : null
  ].filter(Boolean);
  const summary = [company, grade].filter(Boolean).join(' ') || 'Graded';
  return {
    key: 'grading',
    family: 'graded',
    label: 'Grade',
    summary,
    tone: 'brand',
    details,
    payload: {
      company: company || null,
      grade: grade || null,
      certificate_number: certificateNumber || null,
      slab_notes: slabNotes || null,
      graded_on: gradedOn || null
    },
    source: 'manual'
  };
}

export function CollectibleGradingEditor({ apiCall, ownerType, ownerId, mediaType = '', traits = [], onSaved, onToast, className = '' }) {
  const currentTrait = findGradingTrait(traits);
  const metadata = buildGradingMetadata({ trait: currentTrait, mediaType, ownerType });
  const copy = metadata.copy;
  const formKey = `${ownerType}:${ownerId}:grading:${currentTrait?.key || ''}:${currentTrait?.summary || ''}`;
  const [editing, setEditing] = useKeyedDraft(formKey, () => false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useKeyedDraft(formKey, () => buildGradingForm(currentTrait));

  if (!apiCall || !ownerType || !ownerId) return null;

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const payload = buildGradingTraitPayload(form);
    if (!payload.payload.company && !payload.payload.grade && !payload.payload.certificate_number) {
      onToast?.(copy.missingError, 'error');
      return;
    }
    setSaving(true);
    try {
      await apiCall('put', `/collectible-traits/${ownerType}/${ownerId}/grading`, payload);
      await onSaved?.();
      setEditing(false);
      onToast?.(copy.savedToast);
    } catch (error) {
      onToast?.(error?.response?.data?.error || copy.saveError, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentTrait || saving) return;
    setSaving(true);
    try {
      await apiCall('delete', `/collectible-traits/${ownerType}/${ownerId}/grading`);
      await onSaved?.();
      setEditing(false);
      onToast?.(copy.removedToast);
    } catch (error) {
      onToast?.(error?.response?.data?.error || copy.removeError, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return <DrawerMetadataEntry metadata={metadata} onAction={() => setEditing(true)} className={className} />;
  }

  return (
    <DrawerMetadataEntry metadata={metadata} className={className}>
      <form className="space-y-3" onSubmit={save}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="label">{copy.companyLabel}</span>
            <select className="select" value={form.company} onChange={(event) => updateField('company', event.target.value)}>
              <option value="">{copy.companyPlaceholder}</option>
              {GRADER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{copy.gradeLabel}</span>
            <input
              className="input"
              value={form.grade}
              onChange={(event) => updateField('grade', event.target.value)}
              placeholder={copy.gradePlaceholder}
            />
          </label>
          <label className="field">
            <span className="label">Certificate #</span>
            <input
              className="input"
              value={form.certificateNumber}
              onChange={(event) => updateField('certificateNumber', event.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Graded on</span>
            <input className="input" type="date" value={form.gradedOn} onChange={(event) => updateField('gradedOn', event.target.value)} />
          </label>
          <label className="field sm:col-span-2">
            <span className="label">{copy.notesLabel}</span>
            <textarea
              className="textarea min-h-[72px]"
              value={form.slabNotes}
              onChange={(event) => updateField('slabNotes', event.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {currentTrait ? (
            <button type="button" className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={remove} disabled={saving}>
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setEditing(false);
              setForm(buildGradingForm(currentTrait));
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </DrawerMetadataEntry>
  );
}

function buildProvenanceForm(trait = null) {
  const payload = trait?.payload && typeof trait.payload === 'object' ? trait.payload : {};
  const details = Array.isArray(trait?.details) ? trait.details : [];
  return {
    proofType: cleanTraitText(payload.proof_type || payload.proofType || detailValue(details, 'type')),
    issuer: cleanTraitText(payload.issuer || payload.authenticator || detailValue(details, 'issuer')),
    certificateNumber: cleanTraitText(
      payload.certificate_number || payload.certificateNumber || detailValue(details, 'cert') || detailValue(details, 'certificate')
    ),
    source: cleanTraitText(payload.source_name || payload.sourceName || payload.vendor || detailValue(details, 'source')),
    evidenceDate: cleanTraitText(payload.evidence_date || payload.evidenceDate || detailValue(details, 'date')),
    reference: cleanTraitText(payload.reference || payload.proof_url || payload.proofUrl),
    notes: cleanTraitText(payload.notes || detailValue(details, 'notes'))
  };
}

function buildProvenanceTraitPayload(form = {}) {
  const proofType = cleanTraitText(form.proofType);
  const issuer = cleanTraitText(form.issuer);
  const certificateNumber = cleanTraitText(form.certificateNumber);
  const source = cleanTraitText(form.source);
  const evidenceDate = cleanTraitText(form.evidenceDate);
  const reference = cleanTraitText(form.reference);
  const notes = cleanTraitText(form.notes);
  const details = [
    proofType ? { label: 'Type', value: proofType } : null,
    issuer ? { label: 'Issuer', value: issuer } : null,
    certificateNumber ? { label: 'Cert', value: certificateNumber } : null,
    source ? { label: 'Source', value: source } : null,
    evidenceDate ? { label: 'Date', value: evidenceDate } : null,
    reference ? { label: 'Reference', value: 'Reference saved' } : null,
    notes ? { label: 'Notes', value: notes } : null
  ].filter(Boolean);
  const summary =
    [proofType || 'Evidence', issuer ? `from ${issuer}` : null, certificateNumber ? `#${certificateNumber}` : null]
      .filter(Boolean)
      .join(' ') || 'Proof recorded';
  return {
    key: 'provenance',
    family: 'provenance',
    label: 'Proof',
    summary,
    tone: 'success',
    details,
    payload: {
      proof_type: proofType || null,
      issuer: issuer || null,
      certificate_number: certificateNumber || null,
      source_name: source || null,
      evidence_date: evidenceDate || null,
      reference: reference || null,
      notes: notes || null
    },
    source: 'manual'
  };
}

export function CollectibleProvenanceEditor({ apiCall, ownerType, ownerId, traits = [], onSaved, onToast, className = '' }) {
  const currentTrait = findProvenanceTrait(traits);
  const metadata = buildProvenanceMetadata({ trait: currentTrait });
  const formKey = `${ownerType}:${ownerId}:provenance:${currentTrait?.key || ''}:${currentTrait?.summary || ''}`;
  const [editing, setEditing] = useKeyedDraft(formKey, () => false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useKeyedDraft(formKey, () => buildProvenanceForm(currentTrait));

  if (!apiCall || !ownerType || !ownerId) return null;

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const payload = buildProvenanceTraitPayload(form);
    if (!payload.payload.proof_type && !payload.payload.issuer && !payload.payload.certificate_number && !payload.payload.source_name) {
      onToast?.('Add a proof type, issuer, certificate number, or source first', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiCall('put', `/collectible-traits/${ownerType}/${ownerId}/provenance`, payload);
      await onSaved?.();
      setEditing(false);
      onToast?.('Proof details saved');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to save proof details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentTrait || saving) return;
    setSaving(true);
    try {
      await apiCall('delete', `/collectible-traits/${ownerType}/${ownerId}/provenance`);
      await onSaved?.();
      setEditing(false);
      onToast?.('Proof details removed');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to remove proof details', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return <DrawerMetadataEntry metadata={metadata} onAction={() => setEditing(true)} className={className} />;
  }

  return (
    <DrawerMetadataEntry metadata={metadata} className={className}>
      <form className="space-y-3" onSubmit={save}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="label">Proof type</span>
            <select className="select" value={form.proofType} onChange={(event) => updateField('proofType', event.target.value)}>
              <option value="">Select proof</option>
              {PROVENANCE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Issuer / source</span>
            <input
              className="input"
              value={form.issuer}
              onChange={(event) => updateField('issuer', event.target.value)}
              placeholder="COA issuer or authenticator"
            />
          </label>
          <label className="field">
            <span className="label">Certificate #</span>
            <input
              className="input"
              value={form.certificateNumber}
              onChange={(event) => updateField('certificateNumber', event.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Acquired from</span>
            <input
              className="input"
              value={form.source}
              onChange={(event) => updateField('source', event.target.value)}
              placeholder="Vendor, event, or seller"
            />
          </label>
          <label className="field">
            <span className="label">Evidence date</span>
            <input
              className="input"
              type="date"
              value={form.evidenceDate}
              onChange={(event) => updateField('evidenceDate', event.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Reference</span>
            <input
              className="input"
              value={form.reference}
              onChange={(event) => updateField('reference', event.target.value)}
              placeholder="URL, file note, or storage reference"
            />
          </label>
          <label className="field sm:col-span-2">
            <span className="label">Notes</span>
            <textarea className="textarea min-h-[72px]" value={form.notes} onChange={(event) => updateField('notes', event.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {currentTrait ? (
            <button type="button" className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={remove} disabled={saving}>
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setEditing(false);
              setForm(buildProvenanceForm(currentTrait));
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </DrawerMetadataEntry>
  );
}

export function EditionVariantEditor({ apiCall, ownerType, ownerId, mediaType = 'movie', traits = [], onSaved, onToast, className = '' }) {
  const config = editionConfigForMediaType(mediaType);
  const currentTrait = findEditionVariantTrait(traits);
  const metadata = buildEditionMetadata({ trait: currentTrait, mediaType });
  const formKey = `${ownerType}:${ownerId}:edition:${mediaType}:${currentTrait?.key || ''}:${currentTrait?.summary || ''}`;
  const [editing, setEditing] = useKeyedDraft(formKey, () => false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useKeyedDraft(formKey, () => buildEditionForm(currentTrait, mediaType));

  if (!apiCall || !ownerType || !ownerId) return null;

  const updateField = (key, value) => {
    setForm((prev) => ({
      ...prev,
      fields: {
        ...(prev.fields || {}),
        [key]: value
      }
    }));
  };

  const updateFlag = (key, value) => {
    setForm((prev) => ({
      ...prev,
      flags: {
        ...(prev.flags || {}),
        [key]: Boolean(value)
      }
    }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const payload = buildEditionTraitPayload(form, mediaType);
    if (!Array.isArray(payload.details) || payload.details.length === 0) {
      onToast?.('Add at least one edition detail first', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiCall('put', `/collectible-traits/${ownerType}/${ownerId}/edition_variant`, payload);
      await onSaved?.();
      setEditing(false);
      onToast?.('Edition details saved');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to save edition details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentTrait || saving) return;
    setSaving(true);
    try {
      await apiCall('delete', `/collectible-traits/${ownerType}/${ownerId}/edition_variant`);
      await onSaved?.();
      setEditing(false);
      onToast?.('Edition details removed');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to remove edition details', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return <DrawerMetadataEntry metadata={metadata} onAction={() => setEditing(true)} className={className} />;
  }

  return (
    <DrawerMetadataEntry metadata={metadata} className={className}>
      <form className="space-y-3" onSubmit={save} data-testid="edition-variant-editor">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(config.fields || []).map((field) => (
            <label className="field" key={field.key}>
              <span className="label">{field.label}</span>
              <input
                className="input"
                value={form.fields?.[field.key] || ''}
                onChange={(event) => updateField(field.key, event.target.value)}
                placeholder={field.placeholder}
              />
            </label>
          ))}
          {config.numbered ? (
            <>
              <label className="field">
                <span className="label">Number</span>
                <input
                  className="input"
                  value={form.number}
                  onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))}
                  placeholder="150"
                />
              </label>
              <label className="field">
                <span className="label">Run</span>
                <input
                  className="input"
                  value={form.run}
                  onChange={(event) => setForm((prev) => ({ ...prev, run: event.target.value }))}
                  placeholder="200"
                />
              </label>
            </>
          ) : null}
          {(config.flags || []).length ? (
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              {config.flags.map((flag) => (
                <CheckboxControl
                  key={flag.key}
                  checked={Boolean(form.flags?.[flag.key])}
                  onChange={(event) => updateFlag(flag.key, event.target.checked)}
                >
                  {flag.label || humanizeEditionFlag(flag.key)}
                </CheckboxControl>
              ))}
            </div>
          ) : null}
          <label className="field sm:col-span-2">
            <span className="label">Notes</span>
            <textarea
              className="textarea min-h-[72px]"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {currentTrait ? (
            <button type="button" className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={remove} disabled={saving}>
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setEditing(false);
              setForm(buildEditionForm(currentTrait, mediaType));
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </DrawerMetadataEntry>
  );
}

const RELATIONSHIP_TYPE_OPTIONS = [
  ['includes', 'Includes'],
  ['part_of', 'Part of'],
  ['included_with', 'Included with'],
  ['companion_to', 'Companion to'],
  ['purchased_with', 'Purchased with'],
  ['event_acquired_with', 'Event acquired with']
];

const RELATIONSHIP_TARGET_OPTIONS = [
  ['all', 'All records'],
  ['media', 'Library items'],
  ['art', 'Art'],
  ['collectible', 'Collectibles'],
  ['event', 'Events']
];

function relationshipLabel(value) {
  return RELATIONSHIP_TYPE_OPTIONS.find(([key]) => key === value)?.[1] || 'Related';
}

function relationshipTypeLabel(value) {
  return RELATIONSHIP_TARGET_OPTIONS.find(([key]) => key === value)?.[1] || 'Record';
}

export function ObjectRelationshipEditor({ apiCall, ownerType, ownerId, onToast, className = '' }) {
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [relationshipType, setRelationshipType] = useState('includes');
  const [targetType, setTargetType] = useState('all');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [notes, setNotes] = useState('');
  const metadata = buildObjectRelationshipMetadata({ relationships, loading });

  const loadRelationships = useCallback(async () => {
    if (!apiCall || !ownerType || !ownerId) return;
    setLoading(true);
    try {
      const payload = await apiCall('get', `/object-relationships/${ownerType}/${ownerId}`);
      setRelationships(Array.isArray(payload?.relationships) ? payload.relationships : []);
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to load related records', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, ownerType, ownerId, onToast]);

  useEffect(() => {
    // This editor mirrors the selected owner into transient search/draft state and reloads external relationship data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(false);
    setQuery('');
    setMatches([]);
    setSelectedTarget(null);
    setNotes('');
    loadRelationships();
  }, [ownerType, ownerId, loadRelationships]);

  useEffect(() => {
    if (!editing || !apiCall || cleanTraitText(query).length < 2) {
      // Search results are derived from the external search request state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const payload = await apiCall(
          'get',
          `/object-relationships/search?type=${encodeURIComponent(targetType)}&q=${encodeURIComponent(query)}&limit=10`
        );
        if (!cancelled) {
          const found = Array.isArray(payload?.matches) ? payload.matches : [];
          setMatches(found.filter((match) => !(match.owner_type === ownerType && Number(match.owner_id) === Number(ownerId))));
        }
      } catch (error) {
        if (!cancelled) onToast?.(error?.response?.data?.error || 'Failed to search related records', 'error');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiCall, editing, ownerId, ownerType, onToast, query, targetType]);

  if (!apiCall || !ownerType || !ownerId) return null;

  const save = async (event) => {
    event.preventDefault();
    if (!selectedTarget || saving) {
      onToast?.('Choose a related record first', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiCall('post', `/object-relationships/${ownerType}/${ownerId}`, {
        relationship_type: relationshipType,
        target_type: selectedTarget.owner_type,
        target_id: selectedTarget.owner_id,
        notes: cleanTraitText(notes) || null
      });
      await loadRelationships();
      setEditing(false);
      setQuery('');
      setMatches([]);
      setSelectedTarget(null);
      setNotes('');
      onToast?.('Related record saved');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to save related record', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (relationshipId) => {
    if (!relationshipId || saving) return;
    setSaving(true);
    try {
      await apiCall('delete', `/object-relationships/${ownerType}/${ownerId}/${relationshipId}`);
      await loadRelationships();
      onToast?.('Related record removed');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to remove related record', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <DrawerMetadataEntry metadata={metadata} onAction={() => setEditing(true)} actionDisabled={saving} className={className}>
        {!loading && relationships.length > 0 ? (
          <div className="divide-y divide-edge/60">
            {relationships.map((relationship) => (
              <div key={relationship.id} className="flex min-w-0 items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm leading-5 text-ink">
                    <span className="text-dim">{relationshipLabel(relationship.relationship_type)}: </span>
                    {relationship.counterpart?.title || 'Related record'}
                  </p>
                  <p className="truncate text-xs leading-5 text-ghost">
                    {relationshipTypeLabel(relationship.counterpart?.owner_type)}
                    {relationship.counterpart?.subtitle ? ` · ${relationship.counterpart.subtitle}` : ''}
                    {relationship.notes ? ` · ${relationship.notes}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-xs shrink-0 text-err hover:bg-err/10"
                  disabled={saving}
                  onClick={() => remove(relationship.id)}
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </DrawerMetadataEntry>
    );
  }

  return (
    <DrawerMetadataEntry metadata={metadata} className={className}>
      {loading ? <p className="text-xs text-ghost">Loading related records…</p> : null}
      {!loading && relationships.length > 0 ? (
        <div className="space-y-2">
          {relationships.map((relationship) => (
            <div
              key={relationship.id}
              className="flex items-start justify-between gap-3 border-t border-edge/60 py-2 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  <span className="text-dim">{relationshipLabel(relationship.relationship_type)}: </span>
                  {relationship.counterpart?.title || 'Related record'}
                </p>
                <p className="mt-1 text-xs text-ghost">
                  {relationshipTypeLabel(relationship.counterpart?.owner_type)}
                  {relationship.counterpart?.subtitle ? ` · ${relationship.counterpart.subtitle}` : ''}
                  {relationship.notes ? ` · ${relationship.notes}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-xs shrink-0 text-err hover:bg-err/10"
                disabled={saving}
                onClick={() => remove(relationship.id)}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form className="space-y-3" onSubmit={save}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="label">Relationship</span>
            <select className="select" value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}>
              {RELATIONSHIP_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Look in</span>
            <select
              className="select"
              value={targetType}
              onChange={(event) => {
                setTargetType(event.target.value);
                setSelectedTarget(null);
              }}
            >
              {RELATIONSHIP_TARGET_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field sm:col-span-2">
            <span className="label">Find record</span>
            <input
              className="input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedTarget(null);
              }}
              placeholder="Search title or event"
            />
          </label>
        </div>

        {matches.length > 0 ? (
          <div className="max-h-48 overflow-y-auto rounded-md border border-edge bg-void/20 p-1">
            {matches.map((match) => {
              const active = selectedTarget?.owner_type === match.owner_type && Number(selectedTarget?.owner_id) === Number(match.owner_id);
              return (
                <button
                  key={`${match.owner_type}:${match.owner_id}`}
                  type="button"
                  className={cx(
                    'flex w-full items-start justify-between gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-muted/20',
                    active && 'bg-brand/10 text-brand'
                  )}
                  onClick={() => setSelectedTarget(match)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{match.title}</span>
                    <span className="block truncate text-xs text-ghost">
                      {relationshipTypeLabel(match.owner_type)}
                      {match.subtitle ? ` · ${match.subtitle}` : ''}
                    </span>
                  </span>
                  {active ? <span className="text-xs font-medium">Selected</span> : null}
                </button>
              );
            })}
          </div>
        ) : cleanTraitText(query).length >= 2 ? (
          <p className="text-xs text-ghost">No matching records found.</p>
        ) : null}

        <label className="field">
          <span className="label">Notes</span>
          <textarea
            className="textarea min-h-[64px]"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional context"
          />
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setEditing(false);
              setSelectedTarget(null);
              setMatches([]);
              setQuery('');
              setNotes('');
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={saving || !selectedTarget}>
            {saving ? 'Saving…' : 'Save link'}
          </button>
        </div>
      </form>
    </DrawerMetadataEntry>
  );
}

export function Toast({ message, type = 'ok', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const styles = {
    ok: 'border-ok/30 bg-ok/10 text-ok',
    error: 'border-err/30 bg-err/10 text-err',
    info: 'border-gold/30 bg-gold/10 text-gold'
  };
  return (
    <div
      className={cx(
        'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-deep animate-slide-up',
        styles[type] || styles.ok
      )}
    >
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <Icons.X />
      </button>
    </div>
  );
}

export function ImportStatusDock({ jobs = [], onDismiss }) {
  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-6 left-6 z-50 w-96 max-w-[calc(100vw-3rem)] space-y-2">
      {jobs.map((job) => {
        const provider = String(job.provider || '').toLowerCase();
        const label =
          provider === 'plex'
            ? 'Plex Import'
            : provider === 'csv_delicious'
              ? 'Delicious CSV Import'
              : provider === 'csv_generic'
                ? 'CSV Import'
                : 'Import Job';
        const isDone = job.status === 'succeeded' || job.status === 'failed';
        const p = job.progress || {};
        const s = job.summary || {};
        return (
          <div key={job.id} className="card p-3 border border-edge shadow-deep">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-dim font-medium">
                  {label} #{job.id} · {job.status}
                </p>
                {isDone ? (
                  <p className="text-xs text-ghost mt-1">
                    Created {s.created || 0} · Updated {s.updated || 0} · Errors {s.errorCount || 0}
                  </p>
                ) : (
                  <p className="text-xs text-ghost mt-1">
                    Processed {p.processed || 0}/{p.total || 0} · Created {p.created || 0} · Updated {p.updated || 0} · Errors{' '}
                    {p.errorCount || 0}
                  </p>
                )}
                {job.error && <p className="text-xs text-err mt-1">{job.error}</p>}
              </div>
              {isDone && (
                <button onClick={() => onDismiss(job.id)} className="btn-icon btn-sm shrink-0">
                  <Icons.X />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
