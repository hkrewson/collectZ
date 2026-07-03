import { CollectibleTraitPills, Icons, ObjectPosterCard } from '../app/AppPrimitives';

function FilterPill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2.5 py-1 text-[11px] font-medium tracking-wide text-dim">
      {children}
    </span>
  );
}

export default function CollectibleCard({ item, supportsHover, onOpen, onEdit, onDelete, classificationLabel }) {
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Library />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, classificationLabel]}
      rightBadge={
        item.exclusive ? (
          <span className="badge badge-brand text-[10px] backdrop-blur-sm bg-brand/20 border-brand/30">Exclusive</span>
        ) : null
      }
      subtitle={`${item.franchise ? `${item.franchise} · ` : ''}${item.series ? `${item.series} · ` : ''}${item.event_title ? `${item.event_title} · ` : ''}${classificationLabel}`}
      meta={
        <>
          <CollectibleTraitPills traits={item.collectible_traits} limit={3} />
          {item.franchise ? <FilterPill>{item.franchise}</FilterPill> : null}
          {item.artist ? <FilterPill>{item.artist}</FilterPill> : null}
          {item.vendor ? <FilterPill>{item.vendor}</FilterPill> : null}
          {item.booth ? <FilterPill>{item.booth}</FilterPill> : null}
        </>
      }
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}
