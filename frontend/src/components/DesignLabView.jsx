import React, { useEffect, useMemo, useState } from 'react';
import SidebarNav from './SidebarNav';
import { CheckboxControl, Icons, cx, posterUrl } from './app/AppPrimitives';

const LAB_PATH = '/design-lab';
const SAMPLE_USER = { id: 1, role: 'admin', email: 'designer@collectz.local' };
const SAMPLE_SPACES = [
  { id: 1, name: 'Main Space', description: 'Primary collection space for experimenting with the shell.', membership_role: 'owner' },
  { id: 2, name: 'Convention Shelf', description: 'Alt space for event-heavy layouts.', membership_role: 'admin' }
];
const SAMPLE_LIBRARIES = [
  { id: 1, name: 'Film Archive', description: 'Movies, TV, and premium box sets.' },
  { id: 2, name: 'Signed Media', description: 'Higher-emphasis presentation for memorabilia-rich entries.' }
];
const EMPHASIS_MODES = {
  metadata: {
    label: 'Metadata First',
    layout: 'split',
    cardMinWidth: 170,
    gridGap: 16,
    titleScale: 15,
    cardPadding: 14,
    chrome: 'dense',
    density: 'compact'
  },
  art: {
    label: 'Art Forward',
    layout: 'grid',
    cardMinWidth: 220,
    gridGap: 24,
    titleScale: 18,
    cardPadding: 18,
    chrome: 'cinematic',
    density: 'comfortable'
  }
};
const PRESETS = {
  airy: {
    previewMode: 'desktop',
    layout: 'split',
    sidebarWidth: 288,
    contentWidth: 1380,
    cardMinWidth: 208,
    gridGap: 24,
    posterRadius: 22,
    titleScale: 18,
    cardPadding: 18,
    chrome: 'cinematic'
  },
  balanced: {
    previewMode: 'desktop',
    layout: 'grid',
    sidebarWidth: 256,
    contentWidth: 1260,
    cardMinWidth: 192,
    gridGap: 20,
    posterRadius: 18,
    titleScale: 16,
    cardPadding: 16,
    chrome: 'balanced'
  },
  compact: {
    previewMode: 'desktop',
    layout: 'stack',
    sidebarWidth: 236,
    contentWidth: 1120,
    cardMinWidth: 170,
    gridGap: 14,
    posterRadius: 14,
    titleScale: 15,
    cardPadding: 12,
    chrome: 'dense'
  }
};
const COLLECTION_MOODS = {
  archive: {
    eyebrow: 'Library / Archive',
    title: 'Collector Archive',
    description: 'Quiet, documentarian framing that makes catalog confidence and preservation cues feel primary.',
    badge: 'Archive mode',
    chips: ['Preservation', 'Box sets', 'Cataloged', 'Shelf map'],
    panelTitle: 'Archive Filters',
    panelBody: 'A side panel can hold status, preservation, and shelf-location filters without crowding the main browse surface.',
    footerTone: 'Showing 24 archival highlights from the active library'
  },
  boutique: {
    eyebrow: 'Library / Boutique',
    title: 'Showcase Shelf',
    description: 'Premium presentation that leans into display-worthiness, striking covers, and collector theater.',
    badge: 'Boutique mode',
    chips: ['Display shelf', 'Signed', 'Steelbooks', 'Spotlight'],
    panelTitle: 'Showcase Filters',
    panelBody: 'A dedicated side panel keeps the toolbar light while preserving premium browsing and display-focused filters.',
    footerTone: 'Showing 24 display-forward highlights from the active library'
  },
  convention: {
    eyebrow: 'Library / Convention Run',
    title: 'Convention Pull List',
    description: 'Energetic, event-heavy framing that feels like planning a show floor sweep or signing queue.',
    badge: 'Convention mode',
    chips: ['Guest signed', 'Booth pickups', 'Wishlist', 'Event-ready'],
    panelTitle: 'Convention Filters',
    panelBody: 'A side panel makes room for vendor, guest, and event-status filters without flattening the browse rhythm.',
    footerTone: 'Showing 24 convention-ready items from the active library'
  },
  utility: {
    eyebrow: 'Library / Operations',
    title: 'Collection Manager',
    description: 'A more administrative treatment that favors scanning speed, actions, and clear operational status.',
    badge: 'Utility mode',
    chips: ['Needs review', 'Missing art', 'Backlog', 'Recent edits'],
    panelTitle: 'Operator Filters',
    panelBody: 'A side panel keeps operational filters and maintenance states available without taking over the primary grid.',
    footerTone: 'Showing 24 managed items from the active library'
  }
};
const DEFAULT_STATE = {
  preset: 'balanced',
  previewMode: PRESETS.balanced.previewMode,
  layout: PRESETS.balanced.layout,
  sidebarWidth: PRESETS.balanced.sidebarWidth,
  contentWidth: PRESETS.balanced.contentWidth,
  cardMinWidth: PRESETS.balanced.cardMinWidth,
  gridGap: PRESETS.balanced.gridGap,
  posterRadius: PRESETS.balanced.posterRadius,
  titleScale: PRESETS.balanced.titleScale,
  cardPadding: PRESETS.balanced.cardPadding,
  chrome: PRESETS.balanced.chrome,
  shellPinned: true,
  theme: 'dark',
  density: 'comfortable',
  emphasis: 'art',
  metadataVisibility: 'medium',
  posterTreatment: 'shadowed',
  actionVisibility: 'hover',
  cardInfoPlacement: 'below',
  selectionUi: 'off',
  filterPresentation: 'toolbar',
  sortVisibility: 'compact',
  titleTreatment: 'clamp',
  posterCrop: 'centered',
  paginationStyle: 'load-more',
  collectionMood: 'boutique',
  navWeight: 'standard',
  headerStyle: 'hero',
  backgroundMood: 'texture'
};
const CURRENT_APP_STATE = {
  ...DEFAULT_STATE,
  preset: 'current-app',
  previewMode: 'desktop',
  layout: 'grid',
  sidebarWidth: 256,
  contentWidth: 1260,
  cardMinWidth: 192,
  gridGap: 20,
  posterRadius: 18,
  titleScale: 16,
  cardPadding: 16,
  chrome: 'balanced',
  shellPinned: true,
  theme: 'dark',
  density: 'comfortable',
  emphasis: 'art',
  metadataVisibility: 'medium',
  posterTreatment: 'shadowed',
  actionVisibility: 'hover',
  cardInfoPlacement: 'below',
  selectionUi: 'off',
  filterPresentation: 'toolbar',
  sortVisibility: 'compact',
  titleTreatment: 'single',
  posterCrop: 'centered',
  paginationStyle: 'paged',
  collectionMood: 'utility',
  navWeight: 'standard',
  headerStyle: 'quiet',
  backgroundMood: 'flat'
};
const SAMPLE_CARDS = [
  { id: 1, title: 'Die Hard', year: '1988', meta: '4K UHD · steelbook comparison candidate', format: '4K UHD', type: 'Movie', accent: 'from-sky-400 via-blue-600 to-indigo-900', poster_path: '/hSFdyWptoDHuXlFZGzIrfVell4Q.jpg' },
  { id: 2, title: 'The Neighbors', year: '2012', meta: 'TV season layout with a busier ensemble poster', format: 'Blu-ray', type: 'TV Series', accent: 'from-emerald-400 via-teal-600 to-slate-900', poster_path: '/r19CTCgpyMat9uhkspnMBptnBbF.jpg' },
  { id: 3, title: 'Groo the Wanderer #80', year: '2023', meta: 'Comic cover with dense line art for framed and glass testing', format: 'Paperback', type: 'Comic Book', accent: 'from-rose-400 via-red-600 to-zinc-950', poster_path: 'https://static.metron.cloud/media/issue/2023/02/14/facbe133bb6c4122b67d03b821fcc323.jpg' },
  { id: 4, title: 'OU812', year: '1988', meta: 'Album art with strong contrast for flat versus glass treatment', format: 'Vinyl', type: 'Audio', accent: 'from-amber-300 via-orange-500 to-neutral-950', poster_path: 'https://i.discogs.com/92Sx-eJpBS6Va4JPmuK8fIfLTUfP2mbRplc3_wAze7E/rs:fit/g:sm/q:90/h:590/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTUyMjE4/OS0xMzcxMjMzMDc0/LTQzMzAuanBlZw.jpeg' },
  { id: 5, title: 'Carnosaur 2', year: '1995', meta: 'Poster with darker midtones to show overlay and metadata balance', format: 'Blu-ray', type: 'Movie', accent: 'from-fuchsia-400 via-pink-600 to-zinc-900', poster_path: '/8dzRgDdbmEEolKPLpuScsMofHD3.jpg' },
  { id: 6, title: 'Tunnel Vision', year: '2013', meta: 'Tall poster useful for stack mode and subtle border experiments', format: 'Digital', type: 'Movie', accent: 'from-cyan-300 via-sky-500 to-slate-950', poster_path: '/hD83vq9BuQ0dmsLnLpUmOClNlPE.jpg' }
];

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseLabState() {
  const params = new URLSearchParams(window.location.search);
  const preset = params.get('preset');
  const nextPreset = PRESETS[preset] ? preset : DEFAULT_STATE.preset;
  return {
    preset: nextPreset,
    previewMode: params.get('mode') === 'mobile' ? 'mobile' : PRESETS[nextPreset].previewMode,
    layout: ['grid', 'split', 'stack'].includes(params.get('layout')) ? params.get('layout') : PRESETS[nextPreset].layout,
    sidebarWidth: clamp(params.get('sidebar'), 220, 320, PRESETS[nextPreset].sidebarWidth),
    contentWidth: clamp(params.get('content'), 980, 1500, PRESETS[nextPreset].contentWidth),
    cardMinWidth: clamp(params.get('card'), 150, 260, PRESETS[nextPreset].cardMinWidth),
    gridGap: clamp(params.get('gap'), 10, 32, PRESETS[nextPreset].gridGap),
    posterRadius: clamp(params.get('radius'), 10, 30, PRESETS[nextPreset].posterRadius),
    titleScale: clamp(params.get('title'), 14, 22, PRESETS[nextPreset].titleScale),
    cardPadding: clamp(params.get('padding'), 10, 24, PRESETS[nextPreset].cardPadding),
    chrome: ['balanced', 'cinematic', 'dense'].includes(params.get('chrome')) ? params.get('chrome') : PRESETS[nextPreset].chrome,
    shellPinned: params.get('pinned') !== '0',
    theme: ['dark', 'light'].includes(params.get('theme')) ? params.get('theme') : DEFAULT_STATE.theme,
    density: params.get('density') === 'compact' ? 'compact' : DEFAULT_STATE.density,
    emphasis: ['metadata', 'art'].includes(params.get('emphasis')) ? params.get('emphasis') : DEFAULT_STATE.emphasis,
    metadataVisibility: ['minimal', 'medium', 'full'].includes(params.get('meta')) ? params.get('meta') : DEFAULT_STATE.metadataVisibility,
    posterTreatment: ['flat', 'shadowed', 'framed', 'glass'].includes(params.get('poster')) ? params.get('poster') : DEFAULT_STATE.posterTreatment,
    actionVisibility: ['always', 'hover', 'minimal'].includes(params.get('actions')) ? params.get('actions') : DEFAULT_STATE.actionVisibility,
    cardInfoPlacement: ['below', 'overlay', 'side'].includes(params.get('info')) ? params.get('info') : DEFAULT_STATE.cardInfoPlacement,
    selectionUi: ['off', 'checkbox', 'curation'].includes(params.get('selection')) ? params.get('selection') : DEFAULT_STATE.selectionUi,
    filterPresentation: ['toolbar', 'chips', 'sidebar'].includes(params.get('filters')) ? params.get('filters') : DEFAULT_STATE.filterPresentation,
    sortVisibility: ['hidden', 'compact', 'explicit'].includes(params.get('sort')) ? params.get('sort') : DEFAULT_STATE.sortVisibility,
    titleTreatment: ['single', 'clamp', 'editorial'].includes(params.get('titles')) ? params.get('titles') : DEFAULT_STATE.titleTreatment,
    posterCrop: ['full', 'centered', 'top'].includes(params.get('crop')) ? params.get('crop') : DEFAULT_STATE.posterCrop,
    paginationStyle: ['paged', 'load-more', 'infinite'].includes(params.get('page')) ? params.get('page') : DEFAULT_STATE.paginationStyle,
    collectionMood: ['archive', 'boutique', 'convention', 'utility'].includes(params.get('mood')) ? params.get('mood') : DEFAULT_STATE.collectionMood,
    navWeight: ['minimal', 'standard', 'heavy'].includes(params.get('nav')) ? params.get('nav') : DEFAULT_STATE.navWeight,
    headerStyle: ['quiet', 'hero', 'sticky'].includes(params.get('header')) ? params.get('header') : DEFAULT_STATE.headerStyle,
    backgroundMood: ['flat', 'texture', 'dramatic'].includes(params.get('bg')) ? params.get('bg') : DEFAULT_STATE.backgroundMood
  };
}

function buildLabQuery(state) {
  const params = new URLSearchParams();
  params.set('preset', state.preset);
  params.set('mode', state.previewMode);
  params.set('layout', state.layout);
  params.set('sidebar', String(state.sidebarWidth));
  params.set('content', String(state.contentWidth));
  params.set('card', String(state.cardMinWidth));
  params.set('gap', String(state.gridGap));
  params.set('radius', String(state.posterRadius));
  params.set('title', String(state.titleScale));
  params.set('padding', String(state.cardPadding));
  params.set('chrome', state.chrome);
  params.set('theme', state.theme);
  params.set('density', state.density);
  params.set('emphasis', state.emphasis);
  params.set('meta', state.metadataVisibility);
  params.set('poster', state.posterTreatment);
  params.set('actions', state.actionVisibility);
  params.set('info', state.cardInfoPlacement);
  params.set('selection', state.selectionUi);
  params.set('filters', state.filterPresentation);
  params.set('sort', state.sortVisibility);
  params.set('titles', state.titleTreatment);
  params.set('crop', state.posterCrop);
  params.set('page', state.paginationStyle);
  params.set('mood', state.collectionMood);
  params.set('nav', state.navWeight);
  params.set('header', state.headerStyle);
  params.set('bg', state.backgroundMood);
  if (!state.shellPinned) params.set('pinned', '0');
  return params.toString();
}

function LabSlider({ label, value, min, max, step = 1, suffix = 'px', onChange }) {
  const controlId = `design-lab-${String(label || 'slider').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label className="field" htmlFor={controlId}>
      <div className="flex items-center justify-between gap-3">
        <span className="label mb-0">{label}</span>
        <span className="text-xs font-mono text-ghost">{value}{suffix}</span>
      </div>
      <input
        id={controlId}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-gold"
      />
    </label>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="field">
      <div className="label mb-0">{label}</div>
      <div className="tab-strip">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cx('tab flex-1', value === option.value && 'active')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span className="label mb-0">{label}</span>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function getPosterImageClass(state) {
  if (state.posterCrop === 'full') {
    return 'absolute inset-0 h-full w-full object-contain scale-[0.92] bg-black/70';
  }
  if (state.posterCrop === 'top') {
    return 'absolute inset-0 h-full w-full object-cover object-top';
  }
  return 'absolute inset-0 h-full w-full object-cover object-center';
}

function getTitleClasses(state) {
  if (state.titleTreatment === 'single') {
    return 'block truncate font-medium text-ink leading-tight';
  }
  if (state.titleTreatment === 'editorial') {
    return 'block text-ink leading-[0.95] uppercase tracking-[0.08em] font-semibold';
  }
  return 'block overflow-hidden text-ink leading-tight';
}

function getTitleStyle(state, fontSize) {
  if (state.titleTreatment === 'clamp') {
    return {
      fontSize: `${fontSize}px`,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical'
    };
  }
  if (state.titleTreatment === 'editorial') {
    return { fontSize: `${fontSize - 1}px` };
  }
  return { fontSize: `${fontSize}px` };
}

function MockCard({ card, state }) {
  const mood = COLLECTION_MOODS[state.collectionMood];
  const metadataFirst = state.emphasis === 'metadata';
  const metadataVisibility = state.metadataVisibility;
  const infoPlacement = state.cardInfoPlacement;
  const showOverlayInfo = infoPlacement === 'overlay';
  const showSideInfo = infoPlacement === 'side';
  const showBelowInfo = infoPlacement === 'below';
  const actionVisibility = state.actionVisibility;
  const selectionUi = state.selectionUi;
  const overlayClass = state.chrome === 'cinematic'
    ? 'from-void/95 via-void/20 to-transparent'
    : state.chrome === 'dense'
      ? 'from-void/90 via-void/55 to-void/5'
      : 'from-void/88 via-void/35 to-transparent';
  const posterClass = state.posterTreatment === 'flat'
    ? 'border border-edge'
    : state.posterTreatment === 'framed'
      ? 'border-2 border-muted shadow-raise bg-raised p-1'
      : state.posterTreatment === 'glass'
        ? 'border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm'
        : 'border border-edge shadow-card';
  const hoverClass = state.posterTreatment === 'flat' ? '' : 'transition-transform duration-200 group-hover:-translate-y-1';
  const posterImage = posterUrl(card.poster_path);
  const posterImageClass = getPosterImageClass(state);
  const framePadding = state.posterTreatment === 'framed' ? 4 : 0;
  const glassOverlay = state.posterTreatment === 'glass';
  const flatOverlay = state.posterTreatment === 'flat';
  const actionContainerClass = actionVisibility === 'always'
    ? 'translate-y-0 opacity-100'
    : actionVisibility === 'minimal'
      ? 'translate-y-1 opacity-70'
      : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100';
  const selectionClass = selectionUi === 'off'
    ? null
    : selectionUi === 'checkbox'
      ? 'border-brand/45 bg-void/80 text-brand'
      : 'border-gold/55 bg-gold/90 text-void shadow-[0_0_0_3px_rgba(59,130,246,0.18)]';

  return (
    <article className="group animate-fade-in">
      <div
        className={cx('poster', posterClass, hoverClass)}
        style={{ borderRadius: `${state.posterRadius}px` }}
      >
        {posterImage ? (
          <img
            src={posterImage}
            alt={card.title}
            className={posterImageClass}
            style={{ inset: `${framePadding}px` }}
            loading="lazy"
          />
        ) : (
          <>
            <div className={cx('absolute inset-0 bg-gradient-to-br', card.accent)} />
            <div className="absolute inset-0 bg-grain opacity-30" />
          </>
        )}
        <div className={cx('absolute inset-0 bg-gradient-to-t', overlayClass, flatOverlay && 'opacity-40')} />
        {glassOverlay && <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.22),transparent_34%,transparent_66%,rgba(255,255,255,0.14))] mix-blend-screen" />}
        {glassOverlay && <div className="absolute inset-[1px] rounded-[inherit] border border-white/20" />}
        <div className="absolute left-3 top-3"><span className="badge badge-dim text-[10px] bg-void/65 backdrop-blur-sm">{card.format}</span></div>
        <div className="absolute right-3 top-3"><span className="badge badge-dim text-[10px] bg-void/65 backdrop-blur-sm">{card.type}</span></div>
        {selectionClass && (
          <button
            type="button"
            className={cx('absolute left-3 top-11 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-sm transition-colors', selectionClass)}
            aria-label={`Select ${card.title}`}
          >
            {selectionUi === 'checkbox' ? <span className="block h-3 w-3 rounded-sm border border-current" /> : <Icons.Star />}
          </button>
        )}
        {showOverlayInfo && (
          <div className="absolute inset-x-0 bottom-0" style={{ padding: `${state.cardPadding}px` }}>
            <div className="rounded-lg bg-void/72 p-3 backdrop-blur-sm">
              <p className={getTitleClasses(state)} style={getTitleStyle(state, state.titleScale)}>{card.title}</p>
              {metadataVisibility !== 'minimal' && <p className="mt-1 text-xs text-dim">{card.year} · {card.meta}</p>}
            </div>
          </div>
        )}
        <div className={cx('absolute bottom-0 left-0 right-0 transition-all duration-200', actionContainerClass)} style={{ padding: `${state.cardPadding}px` }}>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary btn-sm flex-1 bg-void/65 border-ghost/30 backdrop-blur-sm"><Icons.Edit />Edit</button>
            {actionVisibility !== 'minimal' && <button type="button" className="btn-icon btn-sm bg-void/65 border-ghost/30 backdrop-blur-sm"><Icons.Star /></button>}
          </div>
        </div>
      </div>
      {showBelowInfo && (
        <div className="space-y-1" style={{ paddingTop: `${Math.max(8, state.cardPadding - 4)}px` }}>
          <p className={getTitleClasses(state)} style={getTitleStyle(state, state.titleScale)}>{card.title}</p>
          {metadataVisibility !== 'minimal' && (
            <p className={cx('leading-relaxed', metadataFirst || metadataVisibility === 'full' ? 'text-sm text-dim' : 'text-xs text-ghost')}>
              {card.year} · {card.meta}
            </p>
          )}
          {(metadataFirst || metadataVisibility === 'full') && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="badge badge-dim">{state.collectionMood === 'utility' ? 'Needs audit' : 'Shelf A3'}</span>
              <span className="badge badge-dim">Owned</span>
              <span className="badge badge-dim">{mood.chips[0]}</span>
            </div>
          )}
        </div>
      )}
      {showSideInfo && (
        <div className="mt-3 rounded-lg border border-edge bg-raised p-3 space-y-2">
          <p className={getTitleClasses(state)} style={getTitleStyle(state, state.titleScale - 1)}>{card.title}</p>
          <p className="text-xs text-dim">{card.year} · {card.type}</p>
          {metadataVisibility !== 'minimal' && <p className="text-xs text-ghost">{card.meta}</p>}
        </div>
      )}
    </article>
  );
}

function MockLibraryToolbar({ state }) {
  const mood = COLLECTION_MOODS[state.collectionMood];
  const chromeClass = state.chrome === 'cinematic'
    ? 'bg-gradient-to-br from-surface via-deep to-abyss'
    : state.chrome === 'dense'
      ? 'bg-surface'
      : 'bg-gradient-to-r from-surface to-raised';
  const isQuiet = state.headerStyle === 'quiet';
  const isSticky = state.headerStyle === 'sticky';
  const isHero = state.headerStyle === 'hero';
  const filtersMode = state.filterPresentation;
  const sortMode = state.sortVisibility;
  const titleSize = isHero ? state.titleScale + 10 : isQuiet ? state.titleScale + 1 : state.titleScale + 4;
  const barPadding = isHero ? state.cardPadding + 8 : state.cardPadding;

  return (
    <section className={cx('card overflow-hidden border-edge', chromeClass, isSticky && 'sticky top-0 z-20 shadow-raise backdrop-blur')}>
      <div className="grid gap-4" style={{ padding: `${barPadding}px` }}>
        <div className={cx('flex items-start justify-between gap-4', isHero ? 'flex-col lg:flex-row lg:items-end' : 'items-center')}>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-ghost">{mood.eyebrow}</div>
            <h1 className={cx('font-display tracking-wider text-ink', isHero ? 'mt-2' : 'mt-1')} style={{ fontSize: `${titleSize}px`, lineHeight: 0.95 }}>
              {mood.title}
            </h1>
            {isHero && (
              <p className="mt-2 max-w-2xl text-sm text-dim">
                {mood.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-dim">{mood.badge}</span>
            {isSticky && <span className="badge badge-dim">Sticky Toolbar</span>}
            <button type="button" className="btn-secondary btn-sm"><Icons.Upload />Import</button>
            <button type="button" className="btn-primary btn-sm"><Icons.Plus />Add Item</button>
          </div>
        </div>
        <div className={cx('grid gap-3', isHero ? 'lg:grid-cols-[minmax(0,1.2fr)_auto_auto_auto]' : 'md:grid-cols-[minmax(0,1fr)_auto_auto_auto]')}>
          <label className="field">
            <span className="label mb-0">Search Collection</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ghost"><Icons.Search /></span>
              <input className="input pl-10" value="signed editions, display-worthy covers, steelbooks" readOnly />
            </div>
          </label>
          {filtersMode === 'toolbar' && <button type="button" className="btn-secondary h-9 px-4 self-end"><Icons.List />Filters</button>}
          {filtersMode === 'toolbar' && <button type="button" className="btn-secondary h-9 px-4 self-end"><Icons.Star />Favorites</button>}
          {filtersMode === 'toolbar' && <button type="button" className="btn-ghost h-9 px-4 self-end"><Icons.Check />In Collection</button>}
          {sortMode === 'explicit' && <button type="button" className="btn-secondary h-9 px-4 self-end"><Icons.ArrowDown />Sort: Recently Added</button>}
          {sortMode === 'compact' && <button type="button" className="btn-icon h-9 w-9 self-end"><Icons.ArrowDown /></button>}
        </div>
        {filtersMode === 'chips' && (
          <div className="flex flex-wrap gap-2">
            {mood.chips.map((chip) => <span key={chip} className="badge badge-dim">{chip}</span>)}
          </div>
        )}
        {filtersMode === 'sidebar' && (
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-ghost">{mood.panelTitle}</div>
            <div className="mt-2 text-sm text-dim">{mood.panelBody}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function MockDetailPanel({ state }) {
  const posterImage = posterUrl(SAMPLE_CARDS[0].poster_path);
  const posterImageClass = getPosterImageClass(state);
  return (
    <aside className="card h-fit sticky top-0" style={{ padding: `${state.cardPadding}px` }}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="section-title text-2xl">Detail Rail</p>
            <p className="text-xs text-ghost mt-1">Optional secondary emphasis for signed or high-context items.</p>
          </div>
          <button type="button" className="btn-icon btn-sm"><Icons.ChevronRight /></button>
        </div>
        <div className="poster shadow-card" style={{ borderRadius: `${state.posterRadius}px` }}>
          {posterImage ? <img src={posterImage} alt="Signed Edition Spotlight" className={posterImageClass} loading="lazy" /> : <div className="absolute inset-0 bg-gradient-to-br from-gold-300 via-blue-600 to-indigo-950" />}
          <div className="absolute inset-0 bg-card-fade" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gold-100/90">Featured Layout</p>
            <p className="mt-2 text-lg font-semibold text-ink">Signed Edition Spotlight</p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-dim">
          <p>Use the split layout when you want art and context to share attention instead of forcing everything into the grid.</p>
          <p>Card width, gutter, and title scale tend to do most of the “feels premium vs feels cramped” work here.</p>
        </div>
      </div>
    </aside>
  );
}

function MockStackRow({ card, state }) {
  const posterClass = state.posterTreatment === 'flat'
    ? 'border border-edge'
    : state.posterTreatment === 'framed'
      ? 'border-2 border-muted shadow-raise bg-raised p-1'
      : state.posterTreatment === 'glass'
        ? 'border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm'
        : 'border border-edge shadow-card';

  const posterImage = posterUrl(card.poster_path);
  const posterImageClass = getPosterImageClass(state);
  const selectionUi = state.selectionUi;
  const showSelection = selectionUi !== 'off';

  return (
    <article className="card overflow-hidden">
      <div
        className="grid items-stretch md:grid-cols-[150px_minmax(0,1fr)]"
        style={{ gap: `${state.gridGap}px`, padding: `${state.cardPadding}px` }}
      >
        <div className={cx('poster', posterClass)} style={{ borderRadius: `${state.posterRadius}px` }}>
          {posterImage ? <img src={posterImage} alt={card.title} className={posterImageClass} loading="lazy" /> : <><div className={cx('absolute inset-0 bg-gradient-to-br', card.accent)} /><div className="absolute inset-0 bg-grain opacity-30" /></>}
          <div className="absolute inset-0 bg-card-fade" />
          <div className="absolute left-3 top-3"><span className="badge badge-dim text-[10px] bg-void/65 backdrop-blur-sm">{card.format}</span></div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={getTitleClasses(state)} style={getTitleStyle(state, state.titleScale + 1)}>{card.title}</p>
              <p className="mt-1 text-sm text-dim">{card.year} · {card.type}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {showSelection && <span className={cx('badge', selectionUi === 'checkbox' ? 'badge-dim' : 'badge-gold')}>{selectionUi === 'checkbox' ? 'Select' : 'Curate'}</span>}
              <span className="badge badge-dim">Owned</span>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-dim">{card.meta}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="badge badge-dim">Signed</span>
            <span className="badge badge-dim">Shelf A3</span>
            <span className="badge badge-dim">Priority Display</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-secondary btn-sm"><Icons.Edit />Edit</button>
            {state.actionVisibility !== 'minimal' && <button type="button" className="btn-secondary btn-sm"><Icons.Star />Favorite</button>}
            {state.actionVisibility === 'always' && <button type="button" className="btn-ghost btn-sm"><Icons.List />Compare Metadata</button>}
          </div>
        </div>
      </div>
    </article>
  );
}

function PaginationPreview({ state }) {
  const mood = COLLECTION_MOODS[state.collectionMood];

  if (state.paginationStyle === 'infinite') {
    return (
      <section className="card border-dashed p-4 text-sm text-dim">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ghost">Infinite Scroll Cue</div>
            <p className="mt-1">{mood.footerTone}. New cards continue loading as you reach the shelf edge.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-edge px-3 py-2 text-xs text-ghost">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
            Loading next shelf
          </div>
        </div>
      </section>
    );
  }

  if (state.paginationStyle === 'load-more') {
    return (
      <section className="grid justify-items-center gap-3 py-2">
        <button type="button" className="btn-primary px-5"><Icons.Plus />Load More</button>
        <p className="text-sm text-dim">{mood.footerTone}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-edge bg-raised/80 px-4 py-3 text-sm text-dim">
      <p>{mood.footerTone}</p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-icon btn-sm"><Icons.ChevronLeft /></button>
        <span className="badge badge-gold">1</span>
        <span className="badge badge-dim">2</span>
        <span className="badge badge-dim">3</span>
        <button type="button" className="btn-icon btn-sm"><Icons.ChevronRight /></button>
      </div>
    </section>
  );
}

function ShellPreview({ state, selectedTab, onSelectTab }) {
  const previewWidth = state.previewMode === 'mobile' ? 390 : state.contentWidth;
  const previewHeight = state.previewMode === 'mobile' ? 844 : 920;
  const mobile = state.previewMode === 'mobile';
  const contentGridClass = state.layout === 'split'
    ? 'xl:grid-cols-[minmax(0,1fr)_320px]'
    : 'grid-cols-1';
  const isStackLayout = state.layout === 'stack';
  const previewFrameClass = state.backgroundMood === 'dramatic'
    ? 'bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.18),transparent_45%),radial-gradient(ellipse_at_bottom,rgba(236,72,153,0.12),transparent_40%),linear-gradient(180deg,#06080d,#0b1020)]'
    : state.backgroundMood === 'flat'
      ? 'bg-void'
      : 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.08),transparent_22%),radial-gradient(circle_at_88%_82%,rgba(148,163,184,0.10),transparent_25%),linear-gradient(180deg,#080b10,#0b1020)]';
  const previewCanvasClass = state.backgroundMood === 'dramatic'
    ? 'bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.10),transparent_35%),radial-gradient(circle_at_80%_100%,rgba(236,72,153,0.08),transparent_30%),#080b10]'
    : state.backgroundMood === 'flat'
      ? 'bg-void'
      : 'bg-[linear-gradient(180deg,rgba(15,23,42,0.62),rgba(8,11,16,0.92))]';
  const moodTintClass = state.collectionMood === 'archive'
    ? 'bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.07),transparent_35%)]'
    : state.collectionMood === 'boutique'
      ? 'bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.08),transparent_32%)]'
      : state.collectionMood === 'convention'
        ? 'bg-[radial-gradient(circle_at_top,rgba(236,72,153,0.10),transparent_32%)]'
        : 'bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%)]';
  const navWidth = state.navWeight === 'minimal'
    ? Math.max(64, state.sidebarWidth - 56)
    : state.navWeight === 'heavy'
      ? Math.min(320, state.sidebarWidth + 28)
      : state.sidebarWidth;
  const navCollapsedWidth = state.navWeight === 'minimal' ? 56 : 64;
  const resolvedShellInset = mobile ? 0 : (state.shellPinned ? navWidth : navCollapsedWidth);

  const cardsSection = isStackLayout ? (
    <section className="grid grid-cols-1" style={{ gap: `${state.gridGap}px` }}>
      {SAMPLE_CARDS.map((card) => <MockStackRow key={card.id} card={card} state={state} />)}
    </section>
  ) : (
    <section
      className="grid"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${state.cardMinWidth}px, 1fr))`, gap: `${state.gridGap}px` }}
    >
      {SAMPLE_CARDS.map((card) => <MockCard key={card.id} card={card} state={state} />)}
    </section>
  );

  return (
    <div className="mx-auto">
      <div
        className={cx('overflow-hidden rounded-[28px] border border-edge shadow-deep', previewFrameClass)}
        style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
      >
        {mobile ? (
          <div className="flex h-full flex-col">
            <div className={cx('flex items-center gap-3 border-b border-edge px-4 py-3', state.headerStyle === 'sticky' ? 'sticky top-0 z-10 bg-void/95 backdrop-blur' : 'bg-void/95')}>
              <button type="button" className="btn-icon btn-sm"><Icons.Menu /></button>
              <div className="min-w-0">
                <div className="font-display text-lg tracking-wider text-gold leading-none">COLLECTZ</div>
                <div className="mt-1 text-[11px] text-ghost truncate">Main Space / Film Archive</div>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-4 py-4">
              <div className="grid gap-4">
                <MockLibraryToolbar state={state} />
                {cardsSection}
                <PaginationPreview state={state} />
              </div>
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            <div className="absolute inset-y-0 left-0" style={{ width: `${resolvedShellInset}px` }}>
              <SidebarNav
                user={SAMPLE_USER}
                activeTab={selectedTab}
                onSelect={onSelectTab}
                onLogout={() => {}}
                collapsed={!state.shellPinned}
                pinnedExpanded={state.shellPinned}
                onToggle={() => {}}
                onDesktopHoverChange={() => {}}
                mobileOpen={false}
                onMobileClose={() => {}}
                appVersion="design-lab"
                spaces={SAMPLE_SPACES}
                activeSpaceId={1}
                onSpaceSelect={() => {}}
                libraries={SAMPLE_LIBRARIES}
                activeLibraryId={1}
                onLibrarySelect={() => {}}
                canManageActiveSpace
                activeMembershipRole="owner"
                importReviewPendingCount={4}
                showImportReview
                showCollectibles
                showEvents
                embedded
                expandedWidth={navWidth}
                collapsedWidth={navCollapsedWidth}
              />
            </div>
            <div className="absolute inset-y-0 right-0 overflow-auto" style={{ left: `${resolvedShellInset}px` }}>
              <div className={cx('relative min-h-full px-6 py-6', previewCanvasClass)}>
                <div className={cx('pointer-events-none absolute inset-0', moodTintClass)} />
                {state.backgroundMood === 'texture' && <div className="pointer-events-none absolute inset-0 bg-grain opacity-[0.14]" />}
                {state.backgroundMood === 'dramatic' && <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_30%,transparent_70%,rgba(59,130,246,0.06))]" />}
                <div className={cx('mx-auto grid gap-6', contentGridClass)} style={{ maxWidth: `${state.contentWidth - resolvedShellInset - 48}px` }}>
                  <div className="grid gap-6">
                    <MockLibraryToolbar state={state} />
                    {cardsSection}
                    <PaginationPreview state={state} />
                  </div>
                  {state.layout === 'split' && <MockDetailPanel state={state} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesignLabView({ setUiSettings, showToast }) {
  const [state, setState] = useState(parseLabState);
  const [selectedTab, setSelectedTab] = useState('library-movies');

  useEffect(() => {
    setUiSettings((current) => (
      current.theme === state.theme && current.density === state.density
        ? current
        : { ...current, theme: state.theme, density: state.density }
    ));
  }, [setUiSettings, state.theme, state.density]);

  useEffect(() => {
    window.history.replaceState({}, '', `${LAB_PATH}?${buildLabQuery(state)}`);
  }, [state]);

  const deepLink = useMemo(
    () => `${window.location.origin}${LAB_PATH}?${buildLabQuery(state)}`,
    [state]
  );

  const applyPreset = (presetKey) => {
    const preset = PRESETS[presetKey];
    setState((current) => ({
      ...current,
      ...preset,
      preset: presetKey
    }));
  };

  const updateValue = (key, value) => {
    setState((current) => ({ ...current, [key]: value, preset: 'custom' }));
  };

  const applyEmphasis = (mode) => {
    const emphasis = EMPHASIS_MODES[mode];
    if (!emphasis) return;
    setState((current) => ({
      ...current,
      ...emphasis,
      emphasis: mode,
      preset: 'custom'
    }));
  };

  const copyDeepLink = async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      showToast?.('Design lab link copied');
    } catch (_) {
      showToast?.('Unable to copy link', 'error');
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-void text-ink">
      <div className="mx-auto grid h-full max-w-[1760px] gap-6 px-4 py-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto pr-2 space-y-4">
          <section className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-gold">Direct Route</p>
                <h1 className="section-title">Design Lab</h1>
                <p className="mt-2 text-sm text-dim">
                  A removable sandbox for layout, spacing, hierarchy, and shell experiments using collectZ primitives.
                </p>
              </div>
              <span className="badge badge-dim">Hidden</span>
            </div>
            <div className="card-raised p-3 text-xs text-ghost font-mono break-all">
              {deepLink}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyDeepLink} className="btn-primary"><Icons.Copy />Copy Deep Link</button>
              <button type="button" onClick={() => setState(CURRENT_APP_STATE)} className="btn-secondary"><Icons.Link />Match Current App</button>
              <button type="button" onClick={() => setState(DEFAULT_STATE)} className="btn-secondary"><Icons.Refresh />Reset</button>
              <a href="/login" className="btn-ghost"><Icons.ChevronLeft />Back to App</a>
            </div>
          </section>

          <section className="card p-5 space-y-4">
            <div className="space-y-2">
              <p className="section-title text-2xl">Presets</p>
              <p className="text-sm text-dim">Use a starting point, then tune individual controls.</p>
            </div>
            <div className="grid gap-2">
              {[
                ['airy', 'Airy shelf'],
                ['balanced', 'Balanced library'],
                ['compact', 'Compact operator']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={cx('btn-secondary justify-between', state.preset === key && 'border-gold/50 text-ink')}
                >
                  <span>{label}</span>
                  {state.preset === key ? <Icons.Check /> : <Icons.ChevronRight />}
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5 space-y-4">
            <Segmented
              label="Preview"
              value={state.previewMode}
              options={[
                { value: 'desktop', label: 'Desktop' },
                { value: 'mobile', label: 'Mobile' }
              ]}
              onChange={(value) => updateValue('previewMode', value)}
            />
            <Segmented
              label="Layout"
              value={state.layout}
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'split', label: 'Split' },
                { value: 'stack', label: 'Stack' }
              ]}
              onChange={(value) => updateValue('layout', value)}
            />
            <Segmented
              label="Theme"
              value={state.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]}
              onChange={(value) => updateValue('theme', value)}
            />
            <Segmented
              label="Density"
              value={state.density}
              options={[
                { value: 'comfortable', label: 'Comfort' },
                { value: 'compact', label: 'Compact' }
              ]}
              onChange={(value) => updateValue('density', value)}
            />
            <Segmented
              label="Browsing Emphasis"
              value={state.emphasis}
              options={[
                { value: 'metadata', label: 'Metadata' },
                { value: 'art', label: 'Art' }
              ]}
              onChange={(value) => applyEmphasis(value)}
            />
            <SelectField
              label="Chrome Weight"
              value={state.chrome}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'cinematic', label: 'Cinematic' },
                { value: 'dense', label: 'Dense' }
              ]}
              onChange={(value) => updateValue('chrome', value)}
            />
            <SelectField
              label="Metadata Visibility"
              value={state.metadataVisibility}
              options={[
                { value: 'minimal', label: 'Minimal' },
                { value: 'medium', label: 'Balanced' },
                { value: 'full', label: 'Full' }
              ]}
              onChange={(value) => updateValue('metadataVisibility', value)}
            />
            <SelectField
              label="Poster Treatment"
              value={state.posterTreatment}
              options={[
                { value: 'flat', label: 'Flat' },
                { value: 'shadowed', label: 'Shadowed' },
                { value: 'framed', label: 'Framed' },
                { value: 'glass', label: 'Glass' }
              ]}
              onChange={(value) => updateValue('posterTreatment', value)}
            />
            <SelectField
              label="Action Visibility"
              value={state.actionVisibility}
              options={[
                { value: 'always', label: 'Always Visible' },
                { value: 'hover', label: 'Hover Only' },
                { value: 'minimal', label: 'Minimal' }
              ]}
              onChange={(value) => updateValue('actionVisibility', value)}
            />
            <SelectField
              label="Card Info Placement"
              value={state.cardInfoPlacement}
              options={[
                { value: 'below', label: 'Below Poster' },
                { value: 'overlay', label: 'Overlay' },
                { value: 'side', label: 'Side Panel' }
              ]}
              onChange={(value) => updateValue('cardInfoPlacement', value)}
            />
            <SelectField
              label="Selection UI"
              value={state.selectionUi}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'checkbox', label: 'Checkbox' },
                { value: 'curation', label: 'Curation Mode' }
              ]}
              onChange={(value) => updateValue('selectionUi', value)}
            />
            <SelectField
              label="Filter Presentation"
              value={state.filterPresentation}
              options={[
                { value: 'toolbar', label: 'Toolbar' },
                { value: 'chips', label: 'Chips' },
                { value: 'sidebar', label: 'Sidebar' }
              ]}
              onChange={(value) => updateValue('filterPresentation', value)}
            />
            <SelectField
              label="Sort Visibility"
              value={state.sortVisibility}
              options={[
                { value: 'hidden', label: 'Hidden' },
                { value: 'compact', label: 'Compact' },
                { value: 'explicit', label: 'Explicit' }
              ]}
              onChange={(value) => updateValue('sortVisibility', value)}
            />
            <SelectField
              label="Card Title Treatment"
              value={state.titleTreatment}
              options={[
                { value: 'single', label: 'Single Line' },
                { value: 'clamp', label: 'Two-Line Clamp' },
                { value: 'editorial', label: 'Editorial' }
              ]}
              onChange={(value) => updateValue('titleTreatment', value)}
            />
            <SelectField
              label="Poster Crop Emphasis"
              value={state.posterCrop}
              options={[
                { value: 'full', label: 'Full Poster' },
                { value: 'centered', label: 'Centered Crop' },
                { value: 'top', label: 'Top Crop' }
              ]}
              onChange={(value) => updateValue('posterCrop', value)}
            />
            <SelectField
              label="Pagination / Load Style"
              value={state.paginationStyle}
              options={[
                { value: 'paged', label: 'Paged' },
                { value: 'load-more', label: 'Load More' },
                { value: 'infinite', label: 'Infinite Scroll' }
              ]}
              onChange={(value) => updateValue('paginationStyle', value)}
            />
            <SelectField
              label="Collection Mood"
              value={state.collectionMood}
              options={[
                { value: 'archive', label: 'Archive' },
                { value: 'boutique', label: 'Boutique' },
                { value: 'convention', label: 'Convention Floor' },
                { value: 'utility', label: 'Admin Utility' }
              ]}
              onChange={(value) => updateValue('collectionMood', value)}
            />
            <SelectField
              label="Nav Weight"
              value={state.navWeight}
              options={[
                { value: 'minimal', label: 'Minimal Rail' },
                { value: 'standard', label: 'Standard' },
                { value: 'heavy', label: 'Heavy Shell' }
              ]}
              onChange={(value) => updateValue('navWeight', value)}
            />
            <SelectField
              label="Header Style"
              value={state.headerStyle}
              options={[
                { value: 'quiet', label: 'Quiet' },
                { value: 'hero', label: 'Hero' },
                { value: 'sticky', label: 'Sticky' }
              ]}
              onChange={(value) => updateValue('headerStyle', value)}
            />
            <SelectField
              label="Background Mood"
              value={state.backgroundMood}
              options={[
                { value: 'flat', label: 'Flat' },
                { value: 'texture', label: 'Texture' },
                { value: 'dramatic', label: 'Dramatic' }
              ]}
              onChange={(value) => updateValue('backgroundMood', value)}
            />
            <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-raised px-3 py-2.5 text-sm text-dim">
              <CheckboxControl
                id="design-lab-shell-pinned"
                checked={state.shellPinned}
                onChange={(event) => updateValue('shellPinned', event.target.checked)}
                labelClassName="min-h-0"
              >
                Desktop nav pinned
              </CheckboxControl>
            </div>
          </section>

          <section className="card p-5 space-y-4">
            <p className="section-title text-2xl">Sizing</p>
            <LabSlider label="Sidebar width" value={state.sidebarWidth} min={220} max={320} onChange={(value) => updateValue('sidebarWidth', value)} />
            <LabSlider label="Content width" value={state.contentWidth} min={980} max={1500} onChange={(value) => updateValue('contentWidth', value)} />
            <LabSlider label="Card min width" value={state.cardMinWidth} min={150} max={260} onChange={(value) => updateValue('cardMinWidth', value)} />
            <LabSlider label="Grid gap" value={state.gridGap} min={10} max={32} onChange={(value) => updateValue('gridGap', value)} />
            <LabSlider label="Poster radius" value={state.posterRadius} min={10} max={30} onChange={(value) => updateValue('posterRadius', value)} />
            <LabSlider label="Title scale" value={state.titleScale} min={14} max={22} suffix="px" onChange={(value) => updateValue('titleScale', value)} />
            <LabSlider label="Card padding" value={state.cardPadding} min={10} max={24} suffix="px" onChange={(value) => updateValue('cardPadding', value)} />
          </section>
        </aside>

        <main className="min-h-0 overflow-hidden flex flex-col gap-4">
          <section className="card p-4 text-sm text-dim shrink-0">
            React to the shell, then the content rhythm, then the card treatment. If a direction feels close, copy the deep link and use that URL as the exact discussion artifact in future design threads.
          </section>
          <div className="min-h-0 overflow-hidden">
            <ShellPreview state={state} selectedTab={selectedTab} onSelectTab={setSelectedTab} />
          </div>
        </main>
      </div>
    </div>
  );
}
