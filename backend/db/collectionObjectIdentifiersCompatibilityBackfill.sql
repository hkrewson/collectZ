-- Older reviewed Blu-ray observations predate normalized UPC/EAN facts. The
-- exact-product media_variant retained the original bounded identifier payload,
-- so promote only identifiers from the variant matching the reviewed Edition.

WITH latest_observation AS (
  SELECT DISTINCT ON (space_id, library_id, edition_id)
         id, space_id, library_id, edition_id, source_provider,
         actor_user_id, observed_at
    FROM public.edition_source_observations
   ORDER BY space_id, library_id, edition_id, observed_at DESC, id DESC
), compatibility_identifiers AS (
  SELECT e.space_id, e.library_id, e.id AS edition_id,
         o.id AS observation_id, e.source_provider,
         COALESCE(o.actor_user_id, e.reviewed_by) AS actor_user_id,
         COALESCE(o.observed_at, e.reviewed_at) AS observed_at,
         v.*
    FROM public.collection_editions e
    JOIN public.collection_works w
      ON w.id = e.work_id AND w.space_id = e.space_id AND w.library_id = e.library_id
    JOIN public.media_variants mv
      ON mv.media_id = w.media_id
     AND mv.source = e.source_provider
     AND mv.source_item_key = e.source_item_id
    LEFT JOIN latest_observation o
      ON o.space_id = e.space_id AND o.library_id = e.library_id AND o.edition_id = e.id
    CROSS JOIN LATERAL (VALUES
      ('gs1.upc', mv.raw_json #>> '{identifiers,upc}'),
      ('gs1.ean', mv.raw_json #>> '{identifiers,ean}')
    ) AS v(identifier_scheme, raw_value)
   WHERE e.source_provider = 'blu-ray.com'
     AND NULLIF(btrim(v.raw_value), '') IS NOT NULL
), latest AS (
  SELECT DISTINCT ON (space_id, library_id, edition_id, identifier_scheme, regexp_replace(raw_value, '[^0-9]', '', 'g')) *
    FROM compatibility_identifiers
   WHERE regexp_replace(raw_value, '[^0-9]', '', 'g') <> ''
   ORDER BY space_id, library_id, edition_id, identifier_scheme,
            regexp_replace(raw_value, '[^0-9]', '', 'g'), observed_at DESC
)
INSERT INTO public.collection_object_identifiers (
  space_id, library_id, target_kind, edition_id, identifier_scheme,
  identifier_value_raw, identifier_value_normalized, resolution_strength,
  source_provider, source_observation_id, first_seen_at, last_seen_at,
  created_by, updated_by
)
SELECT space_id, library_id, 'edition', edition_id, identifier_scheme,
       btrim(raw_value), regexp_replace(raw_value, '[^0-9]', '', 'g'),
       'corroborating', source_provider, observation_id, observed_at, observed_at,
       actor_user_id, actor_user_id
  FROM latest
ON CONFLICT DO NOTHING;
