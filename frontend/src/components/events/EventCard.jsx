import { Icons, ObjectPosterCard } from '../app/AppPrimitives';

function EventMetaPill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2.5 py-1 text-[11px] font-medium tracking-wide text-dim">
      {children}
    </span>
  );
}

export default function EventCard({ item, supportsHover, onOpen, onEdit, onDelete, formatDate }) {
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Activity />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, formatDate(item.date_start) || 'Date pending']}
      rightBadge={
        item.host ? <span className="badge badge-brand text-[10px] backdrop-blur-sm bg-brand/20 border-brand/30">{item.host}</span> : null
      }
      subtitle={item.location || 'Location not set'}
      meta={item.room ? <EventMetaPill>{`Room ${item.room}`}</EventMetaPill> : null}
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}
