# Platform Companion Offline Event Packet

This document defines the current collectZ offline event packet contract for platform companion clients.

## Product Boundary

- The offline event packet is a read-only snapshot for poor convention-center connectivity.
- The backend remains authoritative for all writes and reconciliation.
- Platform clients should use the packet for display while offline, then refetch the companion snapshot before retrying any user action after reconnect.
- The current product does not yet have a full event schedule catalog; the packet marks that catalog as unavailable instead of inventing catalog data from a personal Sched feed.
- Realtime location, presence, broad social discovery, push notifications, and offline mutation queues are not part of this contract.

## Packet Location

`GET /api/events/:id/companion/today` returns `offline_packet`.

The packet includes:

- `version`: currently `event-social-offline-packet.v1`.
- `generated_at`: when the backend generated the snapshot.
- `cache_key`: an opaque cache identifier for client storage.
- `recommended_ttl_seconds`: recommended short cache TTL.
- `stale_after_at` and `stale_after_seconds`: when the packet should be clearly marked stale.
- `mode`: currently `read_only_snapshot`.
- `backend_authoritative`: always `true`.
- `supports_offline_mutations`: currently `false`.
- `retry_policy`: guidance for reconnect behavior.
- `includes`: booleans that describe what data is present and what is intentionally absent.
- `counts`: packet item counts.
- `freshness`: packet and personal ICS freshness state.
- `privacy`: explicit privacy safety flags.
- `limitations`: machine-readable out-of-scope markers.
- `schedule_catalog`: currently an empty array until the full catalog milestone exists.
- `planned_sessions`: the user's event schedule plans, including personal Sched-derived plans.
- `key_locations`: event, meetup, and planned-session locations with vendor/booth/location-note context where available.

## Current Included Data

The packet is built from current Event social planning data:

- Event identity and location are available through the companion response's `event` object.
- People are represented by Event attendees.
- Groups include their current member summaries.
- Meetups are included in the companion response and summarized into key locations.
- Planned sessions are event schedule plans, including personal Sched ICS plans.
- Key locations are derived from event location, meetup location, and schedule-plan location/vendor/booth/location notes.

## Offline Rules

- Use the packet for read-only display while offline.
- Show stale state when current time is later than `stale_after_at`.
- Do not queue writes under this contract.
- If a future client queues actions anyway, it must refetch before retrying so newer shared planning data wins.
- Treat backend state as canonical after reconnect.

## Privacy Rules

- Raw personal ICS URLs are never returned.
- Realtime location and presence are not included.
- Broad social discovery is not included.
- Key locations are static planning locations, not live user locations.

## Later Work

Keep these separate unless explicitly promoted:

- full event schedule catalog and Now/Next discovery,
- offline mutation queues,
- conflict resolution UI,
- selected-recipient notifications,
- realtime location or presence-like behavior,
- native/platform UI implementation.
