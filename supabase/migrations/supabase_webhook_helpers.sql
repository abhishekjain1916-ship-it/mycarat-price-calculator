-- MyCarat — Webhook helper function
-- Run in: https://supabase.com/dashboard/project/gyzgjckmeowmsosqgwkr/sql/new

-- Allows server-side lookup of auth user ID by email (service role only)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$;

-- Only callable with service role (not anon)
REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
