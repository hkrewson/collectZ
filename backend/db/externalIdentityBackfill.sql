UPDATE public.media
   SET public_id = gen_random_uuid()
 WHERE public_id IS NULL;
