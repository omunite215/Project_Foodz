-- F2: account and address book.
--   * address kinds, checks, and a location kept in step with lat/lng
--   * confirm-link cut-off for email changes
--   * demo actors: real people's rows are hidden from them in the base tables, and staff read
--     people and addresses through views that mask personal details for demo logins

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('HOME', 'WORK', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_links_valid_after" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "kind" "AddressKind" NOT NULL DEFAULT 'OTHER';

UPDATE "addresses" SET "kind" = 'HOME' WHERE "label" = 'Home';
UPDATE "addresses" SET "kind" = 'WORK' WHERE "label" = 'Work';

-- ---------------------------------------------------------------- address rules

ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_lat_range" CHECK ("lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "addresses_lng_range" CHECK ("lng" BETWEEN -180 AND 180),
  ADD CONSTRAINT "addresses_label_length" CHECK (char_length("label") BETWEEN 1 AND 30),
  ADD CONSTRAINT "addresses_line1_length" CHECK (char_length("line1") BETWEEN 1 AND 200),
  ADD CONSTRAINT "addresses_line2_length" CHECK ("line2" IS NULL OR char_length("line2") <= 100),
  ADD CONSTRAINT "addresses_city_length" CHECK (char_length("city") BETWEEN 1 AND 120),
  ADD CONSTRAINT "addresses_notes_length" CHECK ("notes" IS NULL OR char_length("notes") <= 200);

-- The geography point always matches the coordinates, whoever writes the row.
CREATE OR REPLACE FUNCTION addresses_set_location() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END
$$;

CREATE TRIGGER addresses_location
  BEFORE INSERT OR UPDATE OF lat, lng ON "addresses"
  FOR EACH ROW EXECUTE FUNCTION addresses_set_location();

UPDATE "addresses"
  SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  WHERE location IS NULL;

-- ---------------------------------------------------------------- demo actors

-- runAs sets app.is_demo to 'true' for the shared demo logins. Better Auth and other code that
-- runs outside runAs leave it unset, which reads as false.
CREATE OR REPLACE FUNCTION app_is_demo() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.is_demo', true), '') = 'true' $$;

CREATE OR REPLACE FUNCTION app_user_is_demo(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT coalesce((SELECT is_demo FROM users WHERE id = target), false) $$;

-- Whether the current actor must see `owner`'s personal details masked: a demo login looking at
-- a real (non-demo) person other than itself.
CREATE OR REPLACE FUNCTION app_masks_owner(owner uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_is_demo()
      AND owner IS DISTINCT FROM app_user_id()
      AND NOT app_user_is_demo(owner)
  $$;

CREATE OR REPLACE FUNCTION mask_text(value text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN value IS NULL THEN NULL ELSE '•••' END $$;

CREATE OR REPLACE FUNCTION mask_name(value text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN value IS NULL THEN NULL ELSE left(btrim(value), 1) || '•••' END $$;

CREATE OR REPLACE FUNCTION mask_email(value text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN value IS NULL THEN NULL ELSE left(value, 1) || '•••@•••' END $$;

CREATE OR REPLACE FUNCTION mask_phone(value text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN value IS NULL THEN NULL ELSE '•••' || right(regexp_replace(value, '\D', '', 'g'), 2) END $$;

REVOKE ALL ON FUNCTION app_is_demo(), app_user_is_demo(uuid), app_masks_owner(uuid),
  mask_text(text), mask_name(text), mask_email(text), mask_phone(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_is_demo(), app_user_is_demo(uuid), app_masks_owner(uuid),
      mask_text(text), mask_name(text), mask_email(text), mask_phone(text) TO foodz_app;
  END IF;
  -- The analytics role is subject to the same policies, which call these functions.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT EXECUTE ON FUNCTION app_is_demo(), app_user_is_demo(uuid), app_masks_owner(uuid),
      mask_text(text), mask_name(text), mask_email(text), mask_phone(text) TO foodz_readonly;
  END IF;
END
$$;

-- ---------------------------------------------------------------- row-level security

-- Users: unchanged for everyone except demo actors, who see only themselves and other demo
-- accounts. Real people reach a demo actor only through user_directory, masked.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_access ON "users"
  USING (NOT app_is_demo() OR id = app_user_id() OR is_demo)
  WITH CHECK (NOT app_is_demo() OR id = app_user_id());

-- Addresses: owners read and write their own; support and admin read; demo logins never write,
-- and demo staff read only demo users' rows here (everyone else through address_directory).
DROP POLICY addresses_access ON "addresses";

CREATE POLICY addresses_read ON "addresses" FOR SELECT
  USING (
    user_id = app_user_id()
    OR (app_is_support() AND (NOT app_is_demo() OR app_user_is_demo(user_id)))
  );

CREATE POLICY addresses_insert ON "addresses" FOR INSERT
  WITH CHECK ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system');

CREATE POLICY addresses_update ON "addresses" FOR UPDATE
  USING ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system')
  WITH CHECK ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system');

CREATE POLICY addresses_delete ON "addresses" FOR DELETE
  USING ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system');

-- ---------------------------------------------------------------- masked views for staff reads

-- Owned by the migrator, so they read the base tables without the demo restriction above and
-- apply their own row filter. security_barrier keeps callers' predicates from running before it.
CREATE VIEW user_directory WITH (security_barrier = true) AS
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
  m.masked
FROM users u
CROSS JOIN LATERAL (SELECT app_masks_owner(u.id) AS masked) m
WHERE app_is_support() OR u.id = app_user_id();

CREATE VIEW address_directory WITH (security_barrier = true) AS
SELECT
  a.id,
  a.user_id,
  a.kind,
  CASE WHEN m.masked AND a.kind = 'OTHER' THEN 'Other' ELSE a.label END AS label,
  CASE WHEN m.masked THEN mask_text(a.line1) ELSE a.line1 END AS line1,
  CASE WHEN m.masked THEN mask_text(a.line2) ELSE a.line2 END AS line2,
  CASE WHEN m.masked THEN mask_text(a.city) ELSE a.city END AS city,
  CASE WHEN m.masked THEN mask_text(a.notes) ELSE a.notes END AS notes,
  CASE WHEN m.masked THEN round(a.lat::numeric, 2)::double precision ELSE a.lat END AS lat,
  CASE WHEN m.masked THEN round(a.lng::numeric, 2)::double precision ELSE a.lng END AS lng,
  a.is_default,
  a.created_at,
  m.masked
FROM addresses a
CROSS JOIN LATERAL (SELECT app_masks_owner(a.user_id) AS masked) m
WHERE a.user_id = app_user_id() OR app_is_support();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    REVOKE ALL ON user_directory, address_directory FROM foodz_app;
    GRANT SELECT ON user_directory, address_directory TO foodz_app;
  END IF;
END
$$;
