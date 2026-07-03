import { CollectibleTraitPills, Icons, cx } from '../app/AppPrimitives';

function FilterPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        tone === 'brand' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-edge bg-surface text-dim'
      )}
    >
      {children}
    </span>
  );
}

export default function CollectibleRow({ item, supportsHover, onOpen, onEdit, onDelete, classificationLabel }) {
  const openItem = () => onOpen(item);

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised transition-all duration-150 animate-fade-in cursor-pointer"
      onClick={openItem}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openItem();
        }
      }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-raised text-ghost">
        <Icons.Activity />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <FilterPill>{classificationLabel}</FilterPill>
          {item.franchise ? <FilterPill>{item.franchise}</FilterPill> : null}
          {item.series ? <FilterPill>{item.series}</FilterPill> : null}
          {item.event_title ? <FilterPill>{item.event_title}</FilterPill> : null}
          {item.exclusive ? <FilterPill tone="brand">Exclusive</FilterPill> : null}
        </div>
        <CollectibleTraitPills traits={item.collectible_traits} limit={3} className="mt-2" />
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div
        className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}
      >
        <button
          className="btn-ghost btn-sm"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(item);
          }}
        >
          <Icons.Edit />
          Edit
        </button>
        <button
          className="btn-ghost btn-sm text-err hover:bg-err/10"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(item.id);
          }}
        >
          <Icons.Trash />
        </button>
      </div>
    </div>
  );
}
