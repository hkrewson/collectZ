import { Icons, cx } from '../app/AppPrimitives';

function EventMetaPill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2.5 py-1 text-[11px] font-medium tracking-wide text-dim">
      {children}
    </span>
  );
}

export default function EventListRow({ item, supportsHover, onOpen, onEdit, onDelete, formatDate }) {
  const openItem = () => onOpen(item);

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in"
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
          <EventMetaPill>{formatDate(item.date_start) || 'Date pending'}</EventMetaPill>
          {item.location ? <EventMetaPill>{item.location}</EventMetaPill> : null}
        </div>
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
