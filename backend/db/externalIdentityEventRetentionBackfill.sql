UPDATE public.external_media_identity_events e
   SET from_media_public_id = m.public_id
  FROM public.media m
 WHERE e.from_media_id = m.id
   AND e.space_id = m.space_id
   AND e.from_media_public_id IS NULL;

UPDATE public.external_media_identity_events e
   SET to_media_public_id = m.public_id
  FROM public.media m
 WHERE e.to_media_id = m.id
   AND e.space_id = m.space_id
   AND e.to_media_public_id IS NULL;
