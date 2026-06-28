import React, { useCallback, useEffect, useMemo, useState } from 'react';
import appMeta from '../app-meta.json';
import { DisclosureList, SectionTabPanel, SectionTabs } from './app/AppPrimitives';
import { getSafeHelpTab, getHelpTabDefinitions, LOCAL_PRODUCT_EDITION } from './app/productEdition';

const HELP_ARTICLES = [
  {
    id: 'barcode',
    title: 'Barcode lookup tips',
    summary: 'Use UPC or ISBN lookup when a physical release has packaging metadata you want to pull in quickly.',
    bullets: [
      'Books work best when you scan or enter the ISBN barcode from the back cover.',
      'Movies, TV, games, audio, and comics can all use the shared barcode field now.',
      'If a barcode match looks odd, save the code and release type so you can revisit provider quality later.'
    ]
  },
  {
    id: 'images',
    title: 'Cover and image attachment',
    summary: 'Attach poster, cover, event, or collectible images directly without relying on image recognition.',
    bullets: [
      'Manual cover attachment is still supported in the add/edit workflow.',
      'Events and collectibles support first-class image capture and upload.',
      'On iOS local dev, photo upload may be more reliable than live camera APIs over plain HTTP.'
    ]
  },
  {
    id: 'workspace',
    title: 'Workspace boundaries',
    summary: 'Workspace scope controls which libraries, settings, and collection records are visible while you work.',
    bullets: [
      'Use the workspace settings surface to manage local workspace members and feature flags.',
      'Core API keys belong to the Core app and should be scoped to the automation that needs them.',
      'Platform support, global workspace routing, and cross-instance administration belong outside Core.'
    ]
  }
];

export default function HelpView({
  apiCall,
  onToast,
  Spinner,
  Icons,
  initialTab = 'guidance'
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [releases, setReleases] = useState([]);
  const [releaseLoading, setReleaseLoading] = useState(true);
  const [expandedReleaseVersion, setExpandedReleaseVersion] = useState(null);
  const [expandedGuidanceId, setExpandedGuidanceId] = useState(HELP_ARTICLES[0]?.id || null);
  const helpTabs = useMemo(() => getHelpTabDefinitions(LOCAL_PRODUCT_EDITION, false), []);
  const releaseMeta = useMemo(() => ({
    version: appMeta?.version || null,
    build: appMeta?.build || null
  }), []);

  const loadReleases = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReleaseLoading(true);
    try {
      const payload = await apiCall('get', '/support/releases');
      const nextReleases = Array.isArray(payload?.releases) ? payload.releases : [];
      setReleases(nextReleases);
      setExpandedReleaseVersion((prev) => (nextReleases.some((release) => release.version === prev) ? prev : null));
    } catch (error) {
      if (!silent) {
        onToast(error.response?.data?.error || 'Failed to load release notes', 'error');
      }
    } finally {
      if (!silent) setReleaseLoading(false);
    }
  }, [apiCall, onToast]);

  useEffect(() => {
    const safeTab = getSafeHelpTab(LOCAL_PRODUCT_EDITION, false, initialTab);
    setActiveTab(safeTab);
  }, [initialTab]);

  useEffect(() => {
    if (helpTabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab('guidance');
  }, [activeTab, helpTabs]);

  useEffect(() => {
    loadReleases();
  }, [loadReleases]);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">Help</h1>
      </div>

      <SectionTabs
        tabs={helpTabs}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel="Help sections"
        idBase="help-sections"
      />

      <SectionTabPanel activeId={activeTab} tabKey="guidance" idBase="help-sections">
        <section className="space-y-4 border-t border-edge pt-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">Guidance</h2>
          </div>
          <DisclosureList
            items={HELP_ARTICLES}
            openId={expandedGuidanceId}
            onToggle={setExpandedGuidanceId}
            className=""
            renderSummary={(article) => (
              <>
                <p className="text-sm font-medium text-ink">{article.title}</p>
                <p className="mt-1 text-sm text-ghost">{article.summary}</p>
              </>
            )}
            renderContent={(article) => (
              <ul className="space-y-2 text-sm text-ghost leading-6">
                {article.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-muted" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}
          />
        </section>
      </SectionTabPanel>

      <SectionTabPanel activeId={activeTab} tabKey="releases" idBase="help-sections">
        <section className="space-y-4 border-t border-edge pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Recent Releases</h2>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => loadReleases()}>
              <Icons.Refresh />Refresh
            </button>
          </div>
          {releaseLoading ? (
            <div className="flex items-center gap-3 text-dim"><Spinner />Loading release notes...</div>
          ) : releases.length === 0 ? (
            <div className="border border-dashed border-edge p-6 text-sm text-ghost text-center">
              No release notes are available yet.
            </div>
          ) : (
            <div className="divide-y divide-edge/60 border border-edge/60">
              {releases.map((release) => {
                const expanded = expandedReleaseVersion === release.version;
                const isCurrent = release.version === releaseMeta.version;
                return (
                  <article key={release.version} className="space-y-4 px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 text-sm text-ghost">
                          <span className="font-medium text-ink">{release.version}</span>
                          {release.date ? <span>{release.date}</span> : null}
                          {isCurrent ? <span className="badge badge-warn">Current build</span> : null}
                          {isCurrent && releaseMeta.build ? <span className="font-mono text-xs text-ghost">{releaseMeta.build}</span> : null}
                        </div>
                        <h3 className="text-base font-semibold text-ink">{release.title}</h3>
                        <p className="text-sm text-ghost leading-6">{release.summary}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setExpandedReleaseVersion(expanded ? null : release.version)}
                      >
                        <Icons.ChevronDown />{expanded ? 'Hide details' : 'Details'}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="space-y-4 border-t border-edge pt-4">
                        {release.details.map((detail) => (
                          <div key={`${release.version}:${detail.heading}`} className="space-y-2">
                            <h4 className="text-sm font-semibold text-ink">{detail.heading}</h4>
                            <ul className="list-disc space-y-2 pl-5 text-sm text-ghost">
                              {detail.bullets.map((bullet) => (
                                <li key={bullet}>{bullet}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </SectionTabPanel>
    </div>
  );
}
