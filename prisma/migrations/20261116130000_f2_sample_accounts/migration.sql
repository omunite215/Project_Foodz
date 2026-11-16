-- F2 (U4): seeded sample people are shown in full to demo logins, like demo accounts. Only real
-- sign-ups are masked. Both flags can be set only by the table owner (migrations and the seed).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- who may set it

-- is_demo and is_sample decide who is shown in full to demo logins, and is_demo also makes an
-- account a shared read-only login. Only the table owner (migrations and the seed) may set
-- either flag or change it, so no sign-up, profile update or other app code can mark an account.
-- Inserting false is allowed: Better Auth writes is_demo = false on every sign-up.
-- A trigger rather than column grants: Prisma's multi-row inserts name every column (DEFAULT
-- for the missing ones), which would need INSERT grants on these columns too.
CREATE OR REPLACE FUNCTION users_guard_seed_flags() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.is_demo OR NEW.is_sample) THEN
    RAISE EXCEPTION 'permission denied: users.is_demo and users.is_sample are set by the seed only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.is_demo IS DISTINCT FROM OLD.is_demo OR NEW.is_sample IS DISTINCT FROM OLD.is_sample
  ) THEN
    RAISE EXCEPTION 'permission denied: users.is_demo and users.is_sample are set by the seed only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_seed_flags_guard
  BEFORE INSERT OR UPDATE OF is_demo, is_sample ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_guard_seed_flags();

-- ---------------------------------------------------------------- shown in full to demo logins

CREATE OR REPLACE FUNCTION app_shown_to_demo(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT coalesce((SELECT is_demo OR is_sample FROM users WHERE id = target), false) $$;

CREATE OR REPLACE FUNCTION app_masks_owner(owner uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_is_demo()
      AND owner IS DISTINCT FROM app_user_id()
      AND NOT app_shown_to_demo(owner)
  $$;

REVOKE ALL ON FUNCTION app_shown_to_demo(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_shown_to_demo(uuid) TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT EXECUTE ON FUNCTION app_shown_to_demo(uuid) TO foodz_readonly;
  END IF;
END
$$;

DROP POLICY users_access ON "users";
CREATE POLICY users_access ON "users"
  USING (NOT app_is_demo() OR id = app_user_id() OR is_demo OR is_sample)
  WITH CHECK (NOT app_is_demo() OR id = app_user_id());

DROP POLICY addresses_read ON "addresses";
CREATE POLICY addresses_read ON "addresses" FOR SELECT
  USING (
    user_id = app_user_id()
    OR (app_is_support() AND (NOT app_is_demo() OR app_shown_to_demo(user_id)))
  );

DROP FUNCTION app_user_is_demo(uuid);

-- The staff view also says which rows are sample data.
CREATE OR REPLACE VIEW user_directory WITH (security_barrier = true) AS
SELECT
  u.id,
  CASE WHEN m.masked THEN mask_name(u.name) ELSE u.name END AS name,
  CASE WHEN m.masked THEN mask_email(u.email) ELSE u.email END AS email,
  CASE WHEN m.masked THEN mask_phone(u.phone) ELSE u.phone END AS phone,
  u.role,
  u.is_demo,
  u.email_verified,
  coalesce(u.banned, false) AS banned,
  u.created_at,
  u.deleted_at,
  m.masked,
  u.is_sample
FROM users u
CROSS JOIN LATERAL (SELECT app_masks_owner(u.id) AS masked) m
WHERE app_is_support() OR u.id = app_user_id();
