-- Promote only reviewed, unambiguous identifiers from existing Edition Source
-- Observations. Ambiguous IMDb values remain observation evidence for review.

WITH latest_observation AS (
  SELECT DISTINCT ON (space_id, library_id, edition_id)
         id, space_id, library_id, edition_id, source_provider,
         normalized_facts, actor_user_id, observed_at
    FROM public.edition_source_observations
   ORDER BY space_id, library_id, edition_id, observed_at DESC, id DESC
)
INSERT INTO public.collection_object_identifiers (
  space_id, library_id, target_kind, edition_id, identifier_scheme,
  identifier_value_raw, identifier_value_normalized, resolution_strength,
  source_provider, source_observation_id, first_seen_at, last_seen_at,
  created_by, updated_by
)
SELECT e.space_id, e.library_id, 'edition', e.id, 'bluray.product',
       e.source_item_id, lower(btrim(e.source_item_id)), 'exclusive',
       e.source_provider, o.id, COALESCE(o.observed_at, e.created_at),
       COALESCE(o.observed_at, e.updated_at), e.reviewed_by, e.reviewed_by
  FROM public.collection_editions e
  LEFT JOIN latest_observation o
    ON o.space_id = e.space_id AND o.library_id = e.library_id AND o.edition_id = e.id
 WHERE e.source_provider = 'blu-ray.com'
ON CONFLICT DO NOTHING;

WITH candidates AS (
  SELECT o.id AS observation_id, o.space_id, o.library_id, o.edition_id,
         e.work_id, o.source_provider, o.actor_user_id, o.observed_at,
         btrim(o.normalized_facts #>> '{identifiers,imdb_id}') AS raw_value,
         lower(btrim(o.normalized_facts #>> '{identifiers,imdb_id}')) AS normalized_value
    FROM public.edition_source_observations o
    JOIN public.collection_editions e
      ON e.id = o.edition_id AND e.space_id = o.space_id AND e.library_id = o.library_id
   WHERE NULLIF(btrim(o.normalized_facts #>> '{identifiers,imdb_id}'), '') IS NOT NULL
), unambiguous AS (
  SELECT space_id, library_id, normalized_value
    FROM candidates
   GROUP BY space_id, library_id, normalized_value
  HAVING COUNT(DISTINCT work_id) = 1
), latest AS (
  SELECT DISTINCT ON (c.space_id, c.library_id, c.work_id, c.normalized_value) c.*
    FROM candidates c
    JOIN unambiguous u USING (space_id, library_id, normalized_value)
   ORDER BY c.space_id, c.library_id, c.work_id, c.normalized_value, c.observed_at DESC, c.observation_id DESC
)
INSERT INTO public.collection_object_identifiers (
  space_id, library_id, target_kind, work_id, identifier_scheme,
  identifier_value_raw, identifier_value_normalized, resolution_strength,
  source_provider, source_observation_id, first_seen_at, last_seen_at,
  created_by, updated_by
)
SELECT space_id, library_id, 'work', work_id, 'imdb.title', raw_value,
       normalized_value, 'exclusive', source_provider, observation_id,
       observed_at, observed_at, actor_user_id, actor_user_id
  FROM latest
ON CONFLICT DO NOTHING;

WITH observation_identifiers AS (
  SELECT o.id AS observation_id, o.space_id, o.library_id, o.edition_id,
         o.source_provider, o.actor_user_id, o.observed_at, v.*
    FROM public.edition_source_observations o
    CROSS JOIN LATERAL (VALUES
      ('amazon.asin', o.normalized_facts #>> '{identifiers,asin}', 'corroborating'),
      ('bluray.content', o.normalized_facts #>> '{identifiers,bluray_content_id}', 'corroborating'),
      ('bluray.global_product', o.normalized_facts #>> '{identifiers,bluray_global_product_id}', 'grouping'),
      ('bluray.global_parent', o.normalized_facts #>> '{identifiers,bluray_global_parent_id}', 'grouping'),
      ('gs1.upc', o.normalized_facts #>> '{identifiers,upc}', 'corroborating'),
      ('gs1.ean', o.normalized_facts #>> '{identifiers,ean}', 'corroborating')
    ) AS v(identifier_scheme, raw_value, resolution_strength)
   WHERE NULLIF(btrim(v.raw_value), '') IS NOT NULL
), latest AS (
  SELECT DISTINCT ON (space_id, library_id, edition_id, identifier_scheme, lower(btrim(raw_value))) *
    FROM observation_identifiers
   ORDER BY space_id, library_id, edition_id, identifier_scheme, lower(btrim(raw_value)), observed_at DESC, observation_id DESC
)
INSERT INTO public.collection_object_identifiers (
  space_id, library_id, target_kind, edition_id, identifier_scheme,
  identifier_value_raw, identifier_value_normalized, resolution_strength,
  source_provider, source_observation_id, first_seen_at, last_seen_at,
  created_by, updated_by
)
SELECT space_id, library_id, 'edition', edition_id, identifier_scheme,
       btrim(raw_value), lower(btrim(raw_value)), resolution_strength,
       source_provider, observation_id, observed_at, observed_at,
       actor_user_id, actor_user_id
  FROM latest
ON CONFLICT DO NOTHING;
