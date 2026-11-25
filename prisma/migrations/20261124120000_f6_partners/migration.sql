-- F6: partner applications, staff review and the partner app's online state.
-- Contract: docs/features/F6/contract.md §9.

-- ---------------------------------------------------------------- enums

CREATE TYPE "IdDocumentType" AS ENUM ('DRIVER_LICENSE', 'STATE_ID', 'PASSPORT');

-- ---------------------------------------------------------------- delivery_partners

-- The file keys move to links to their upload rows (nothing read the keys before F6).
ALTER TABLE "delivery_partners"
  DROP COLUMN "id_document_key",
  DROP COLUMN "photo_key",
  ADD COLUMN "photo_upload_id" UUID,
  ADD COLUMN "id_document_upload_id" UUID,
  ADD COLUMN "id_document_type" "IdDocumentType",
  ADD COLUMN "id_document_expires_on" DATE,
  ADD COLUMN "id_number_last4" TEXT,
  ADD COLUMN "id_number_hash" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "edited_at" TIMESTAMP(3),
  ADD COLUMN "fixed_at" TIMESTAMP(3),
  ADD COLUMN "decided_at" TIMESTAMP(3),
  ADD COLUMN "decided_by" UUID,
  ADD COLUMN "decision_reason" TEXT,
  ADD COLUMN "changes_requested_at" TIMESTAMP(3),
  ADD COLUMN "changes_requested_note" TEXT,
  ADD COLUMN "changes_requested_by" UUID,
  ADD COLUMN "reapply_after" DATE,
  ADD COLUMN "files_deleted_at" TIMESTAMP(3),
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspension_reason" TEXT,
  ADD COLUMN "online_since" TIMESTAMP(3),
  ADD COLUMN "online_session_id" UUID,
  ADD COLUMN "offline_reason" TEXT,
  ADD COLUMN "offline_at" TIMESTAMP(3),
  ADD COLUMN "partner_terms_version" INTEGER,
  ADD COLUMN "partner_terms_accepted_at" TIMESTAMP(3),
  ADD COLUMN "adult_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "welcomed_at" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  -- What two plates are compared by (A22.1): no case, spaces or hyphens.
  ADD COLUMN "plate_key" TEXT GENERATED ALWAYS AS (
    upper(regexp_replace("vehicle_plate", '[[:space:]-]', '', 'g'))
  ) STORED;

ALTER TABLE "delivery_partners"
  ADD CONSTRAINT "delivery_partners_photo_upload_id_fkey" FOREIGN KEY ("photo_upload_id")
    REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_partners_id_document_upload_id_fkey" FOREIGN KEY ("id_document_upload_id")
    REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- decided_by, changes_requested_by and online_session_id are plain ids: accounts are
-- anonymised, never deleted, and a signed-out session takes the partner offline through the
-- service (B11) rather than through a cascade.

-- Foodz keeps no position of an offline partner (P12.5), so the backfill empties Riley's parked
-- point before the rule below holds.
UPDATE "delivery_partners" SET "last_location" = NULL WHERE NOT "is_online";
UPDATE "delivery_partners" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;

ALTER TABLE "delivery_partners"
  ADD CONSTRAINT "delivery_partners_no_position_offline" CHECK ("is_online" OR "last_location" IS NULL),
  ADD CONSTRAINT "delivery_partners_online_approved" CHECK (NOT "is_online" OR "status" = 'APPROVED'),
  ADD CONSTRAINT "delivery_partners_id_number_last4" CHECK ("id_number_last4" ~ '^[A-Z0-9]{4}$'),
  ADD CONSTRAINT "delivery_partners_texts" CHECK (
    char_length("decision_reason") <= 500
    AND char_length("changes_requested_note") <= 500
    AND char_length("suspension_reason") <= 500
  ),
  ADD CONSTRAINT "delivery_partners_offline_reason" CHECK ("offline_reason" IN (
    'self', 'no-location', 'kitchen-closed', 'other-device', 'suspended', 'signed-out',
    'demo-other-visitor'
  )),
  ADD CONSTRAINT "delivery_partners_version" CHECK ("version" >= 0);

CREATE INDEX "delivery_partners_status_submitted_at_idx" ON "delivery_partners" ("status", "submitted_at");
CREATE INDEX "delivery_partners_plate_key_idx" ON "delivery_partners" ("plate_key") WHERE "plate_key" IS NOT NULL;
CREATE INDEX "delivery_partners_id_number_hash_idx" ON "delivery_partners" ("id_number_hash") WHERE "id_number_hash" IS NOT NULL;
CREATE INDEX "delivery_partners_online_idx" ON "delivery_partners" ("is_online") WHERE "is_online";

-- ---------------------------------------------------------------- application history

CREATE TABLE "partner_application_events" (
  "id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "actor_kind" TEXT NOT NULL,
  "actor_id" UUID,
  "actor_name" TEXT,
  "actor_role" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applicant_text" TEXT,
  "staff_note" TEXT,
  "changed_parts" TEXT[] NOT NULL DEFAULT '{}',
  "version_after" INTEGER,
  CONSTRAINT "partner_application_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_application_events_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_application_events_type" CHECK ("type" IN (
    'applied', 'updated', 'sent-back', 'fixed', 'approved', 'rejected', 'reopened', 'suspended',
    'taken-offline', 'reinstated', 'files-deleted'
  )),
  CONSTRAINT "partner_application_events_actor_kind" CHECK ("actor_kind" IN ('staff', 'applicant', 'system')),
  CONSTRAINT "partner_application_events_texts" CHECK (
    char_length("applicant_text") <= 500 AND char_length("staff_note") <= 500
  ),
  CONSTRAINT "partner_application_events_parts" CHECK ("changed_parts" <@ ARRAY[
    'photo', 'idPhoto', 'vehicle', 'plate', 'idType', 'idNumber', 'idExpiry', 'phone'
  ]::text[])
);

CREATE INDEX "partner_application_events_partner_id_at_idx" ON "partner_application_events" ("partner_id", "at");

-- ---------------------------------------------------------------- uploads

ALTER TABLE "uploads" ADD COLUMN "reject_code" TEXT,
  ADD CONSTRAINT "uploads_reject_code" CHECK ("reject_code" IN ('TOO_LARGE', 'BAD_TYPE', 'UNREADABLE', 'NOT_RECEIVED'));

-- Private files (ID documents, photos) are readable by their owner and the platform only. Staff
-- reach partner files through partner_directory and a short signed link (T4).
DROP POLICY uploads_access ON "uploads";
CREATE POLICY uploads_access ON "uploads"
  USING (
    owner_id = app_user_id()
    OR app_role() = 'system'
    OR (bucket = 'PUBLIC' AND app_role() IN ('content_editor', 'kitchen', 'support', 'admin'))
  )
  WITH CHECK (owner_id = app_user_id() OR app_role() = 'system');

-- ---------------------------------------------------------------- helpers

-- Today's date in the store's time zone (reapply dates are store dates).
CREATE OR REPLACE FUNCTION app_store_today() RETURNS date
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM site_settings WHERE id = 1), 'America/New_York'))::date
  $$;

-- Reviewers (not demo) and the platform. Partner rows hold ID details, so the kitchen and the
-- content editors never read them.
CREATE OR REPLACE FUNCTION app_is_reviewer() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_role() IN ('support', 'admin', 'system') AND NOT app_is_demo() $$;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE "delivery_partners" ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_partners_read ON "delivery_partners" FOR SELECT
  USING (user_id = app_user_id() OR app_is_reviewer());

CREATE POLICY delivery_partners_insert ON "delivery_partners" FOR INSERT
  WITH CHECK ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system');

CREATE POLICY delivery_partners_update ON "delivery_partners" FOR UPDATE
  USING ((user_id = app_user_id() AND NOT app_is_demo()) OR app_is_reviewer())
  WITH CHECK ((user_id = app_user_id() AND NOT app_is_demo()) OR app_is_reviewer());

CREATE POLICY delivery_partners_delete ON "delivery_partners" FOR DELETE
  USING ((user_id = app_user_id() AND NOT app_is_demo()) OR app_role() = 'system');

ALTER TABLE "partner_application_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_application_events_read ON "partner_application_events" FOR SELECT
  USING (app_is_reviewer());

-- Staff write their own decisions; the applicant writes "applied", "updated" and "fixed" on
-- their own application, as themselves and with no staff name, role, note or text; the
-- platform writes everything else.
CREATE POLICY partner_application_events_insert ON "partner_application_events" FOR INSERT
  WITH CHECK (
    app_role() = 'system'
    OR (app_role() IN ('support', 'admin') AND NOT app_is_demo()
        AND actor_kind = 'staff' AND actor_id = app_user_id())
    OR (partner_id = app_partner_id() AND NOT app_is_demo()
        AND actor_kind = 'applicant' AND type IN ('applied', 'updated', 'fixed')
        AND actor_id = app_user_id() AND actor_name IS NULL AND actor_role IS NULL
        AND staff_note IS NULL AND applicant_text IS NULL)
  );

-- ---------------------------------------------------------------- what may change a partner row

-- An upload an applicant may attach: their own, of the right purpose, checked. Runs as the
-- caller, so row-level security on uploads hides anyone else's.
CREATE OR REPLACE FUNCTION app_partner_upload_ok(upload uuid, owner uuid, wanted "UploadPurpose")
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT upload IS NULL OR EXISTS (
      SELECT 1 FROM uploads u
      WHERE u.id = upload AND u.owner_id = owner AND u.purpose = wanted AND u.status = 'READY'
    )
  $$;

-- Row-level security says whose row; this says what may change in it (§4 of the contract):
-- the applicant edits the application while it is waiting and applies again from the reapply
-- date; an approved partner changes only the online state; reviewers decide along their role's
-- transitions and never touch the application itself; going offline is always allowed. The
-- table owner and the platform pass.
CREATE OR REPLACE FUNCTION delivery_partners_guard_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  actor text := app_role();
  changed text[];
  move text;
  bookkeeping constant text[] := ARRAY['version', 'updated_at', 'plate_key'];
  online_cols constant text[] := ARRAY[
    'is_online', 'online_since', 'online_session_id', 'offline_reason', 'offline_at',
    'last_location', 'last_seen_at'
  ];
  application_cols constant text[] := ARRAY[
    'vehicle_type', 'vehicle_plate', 'license_number_enc', 'id_number_hash', 'id_number_last4',
    'id_document_type', 'id_document_expires_on', 'photo_upload_id', 'id_document_upload_id',
    'edited_at', 'fixed_at'
  ];
  reapply_cols constant text[] := ARRAY[
    'status', 'submitted_at', 'decided_at', 'decided_by', 'decision_reason', 'reapply_after',
    'changes_requested_at', 'changes_requested_note', 'changes_requested_by', 'files_deleted_at',
    'partner_terms_version', 'partner_terms_accepted_at', 'adult_confirmed_at'
  ];
  decision_cols constant text[] := ARRAY[
    'status', 'approved_at', 'decided_at', 'decided_by', 'decision_reason', 'reapply_after',
    'changes_requested_at', 'changes_requested_note', 'changes_requested_by', 'fixed_at',
    'suspended_at', 'suspension_reason'
  ];
BEGIN
  IF actor = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF app_is_demo() THEN
    RAISE EXCEPTION 'permission denied: demo logins change no partner' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id = app_user_id() AND actor IN ('customer', 'partner') AND NEW.status = 'APPLIED'
      AND NOT NEW.is_online AND NEW.rating_count = 0 AND NEW.approved_at IS NULL
      AND NEW.decided_at IS NULL AND NEW.suspended_at IS NULL
      AND app_partner_upload_ok(NEW.photo_upload_id, NEW.user_id, 'PARTNER_PHOTO')
      AND app_partner_upload_ok(NEW.id_document_upload_id, NEW.user_id, 'PARTNER_DOCUMENT') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'permission denied: % may not create this partner row', actor
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id = app_user_id() AND OLD.status = 'APPLIED' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'permission denied: only a waiting application may be withdrawn'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(array_agg(n.key), '{}') INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
  changed := array(SELECT unnest(changed) EXCEPT SELECT unnest(bookkeeping));

  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'permission denied: a partner row''s version never goes back'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'permission denied: a partner row keeps its account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Going offline (and only that) is always allowed to whoever may update the row.
  IF changed <@ online_cols AND NOT NEW.is_online AND NEW.online_session_id IS NULL
    AND NEW.last_location IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.user_id = app_user_id() AND actor IN ('customer', 'partner') THEN
    IF ('photo_upload_id' = ANY (changed)
          AND NOT app_partner_upload_ok(NEW.photo_upload_id, NEW.user_id, 'PARTNER_PHOTO'))
      OR ('id_document_upload_id' = ANY (changed)
          AND NOT app_partner_upload_ok(NEW.id_document_upload_id, NEW.user_id, 'PARTNER_DOCUMENT')) THEN
      RAISE EXCEPTION 'permission denied: an application links only its own checked uploads'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'APPLIED' AND NEW.status = 'APPLIED' AND changed <@ application_cols THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'REJECTED' AND NEW.status = 'APPLIED' AND OLD.reapply_after <= app_store_today()
      AND changed <@ (application_cols || reapply_cols) THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.status = 'APPROVED'
      AND changed <@ (online_cols || ARRAY['welcomed_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'permission denied: a % application can''t change %', OLD.status, changed
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF actor IN ('support', 'admin') THEN
    IF NEW.version <= OLD.version THEN
      RAISE EXCEPTION 'permission denied: a decision moves the version on' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT changed <@ (decision_cols || online_cols) THEN
      RAISE EXCEPTION 'permission denied: reviewers don''t change %', changed
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Reviewers only ever take a partner offline.
    IF changed && online_cols AND (NEW.is_online OR NEW.online_session_id IS NOT NULL OR NEW.last_location IS NOT NULL) THEN
      RAISE EXCEPTION 'permission denied: reviewers only take partners offline' USING ERRCODE = 'insufficient_privilege';
    END IF;
    move := OLD.status::text || '>' || NEW.status::text;
    IF move IN ('APPLIED>APPLIED', 'APPLIED>APPROVED', 'APPLIED>REJECTED', 'APPROVED>SUSPENDED')
      OR (actor = 'admin' AND move IN ('SUSPENDED>APPROVED', 'REJECTED>APPLIED')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'permission denied: % may not move a partner from % to %', actor, OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE EXCEPTION 'permission denied: % may not change partners', actor USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER delivery_partners_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON "delivery_partners"
  FOR EACH ROW EXECUTE FUNCTION delivery_partners_guard_write();

-- A user's role changes only through the platform, the auth library (which runs outside any
-- request context, so app.role is unset) or the definer functions below (which run as the
-- owner). Every request context, signed out included, is refused.
CREATE OR REPLACE FUNCTION users_guard_role() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
    AND coalesce(current_setting('app.role', true), '') NOT IN ('', 'system')
    AND NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RAISE EXCEPTION 'permission denied: a role changes only through its own step'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_guard_role
  BEFORE UPDATE OF "role" ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_guard_role();

-- Approving makes the applicant a partner (B6) in the reviewer's own transaction: reviewers
-- (not demo) or the platform, and only for a customer whose application is approved.
CREATE OR REPLACE FUNCTION app_set_partner_role(target uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  owner uuid;
BEGIN
  IF NOT app_is_reviewer() THEN
    RAISE EXCEPTION 'permission denied: only reviewers approve partners' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT user_id INTO owner FROM delivery_partners WHERE id = target AND status = 'APPROVED';
  IF owner IS NULL THEN
    RETURN false;
  END IF;
  UPDATE users SET role = 'partner', updated_at = now() WHERE id = owner AND role = 'customer';
  RETURN FOUND;
END
$$;

-- Deleting an account (F2) with a partner row (P15.5): refused while online; a waiting
-- application is withdrawn (its history goes with it); any other row is anonymised and its
-- history keeps decisions, states and times but loses its texts. Returns what happened and the
-- uploads whose files the caller deletes after commit.
CREATE OR REPLACE FUNCTION app_erase_own_partner_data() RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  row delivery_partners%ROWTYPE;
  files uuid[];
BEGIN
  IF app_user_id() IS NULL OR app_is_demo() THEN
    RAISE EXCEPTION 'permission denied: only the account itself erases its partner data'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO row FROM delivery_partners WHERE user_id = app_user_id() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  IF row.is_online THEN
    RAISE EXCEPTION 'partner is online' USING ERRCODE = 'object_in_use';
  END IF;
  files := array_remove(ARRAY[row.photo_upload_id, row.id_document_upload_id], NULL);
  IF row.status = 'APPLIED' THEN
    DELETE FROM delivery_partners WHERE id = row.id;
    RETURN jsonb_build_object('outcome', 'withdrawn', 'partnerId', row.id, 'uploadIds', to_jsonb(files));
  END IF;
  UPDATE delivery_partners
  SET vehicle_plate = NULL, license_number_enc = NULL, id_number_hash = NULL,
      id_number_last4 = NULL, photo_upload_id = NULL, id_document_upload_id = NULL,
      decision_reason = NULL, changes_requested_note = NULL, suspension_reason = NULL,
      files_deleted_at = coalesce(files_deleted_at, now()), updated_at = now()
  WHERE id = row.id;
  UPDATE partner_application_events SET applicant_text = NULL, staff_note = NULL
  WHERE partner_id = row.id;
  RETURN jsonb_build_object('outcome', 'anonymised', 'partnerId', row.id, 'uploadIds', to_jsonb(files));
END
$$;

-- ---------------------------------------------------------------- masked views for staff reads

-- Owned by the migrator, so they read partners without the demo restriction and apply their own
-- row filter. A demo staff login sees a real person's name, contact, plate, ID details, texts
-- and file keys masked; sample and demo accounts are shown in full. The position is never here.
CREATE VIEW partner_directory WITH (security_barrier = true) AS
SELECT
  p.id,
  p.user_id,
  p.status,
  CASE WHEN m.masked THEN mask_name(u.name) ELSE u.name END AS name,
  CASE WHEN m.masked THEN mask_email(u.email) ELSE u.email END AS email,
  CASE WHEN m.masked THEN NULL ELSE u.phone END AS phone,
  coalesce(u.banned, false) AS banned,
  CASE WHEN m.masked THEN mask_text(u.ban_reason) ELSE u.ban_reason END AS ban_reason,
  u.is_demo,
  u.is_sample,
  u.created_at AS customer_since,
  (SELECT count(*)::int FROM orders o WHERE o.user_id = p.user_id AND o.status <> 'PENDING_PAYMENT') AS order_count,
  p.vehicle_type,
  CASE WHEN m.masked THEN mask_text(p.vehicle_plate) ELSE p.vehicle_plate END AS vehicle_plate,
  CASE WHEN m.masked THEN NULL ELSE p.plate_key END AS plate_key,
  CASE WHEN m.masked THEN NULL ELSE p.id_number_hash END AS id_number_hash,
  p.id_document_type,
  CASE WHEN m.masked THEN NULL ELSE p.id_number_last4 END AS id_number_last4,
  CASE WHEN m.masked THEN NULL ELSE p.id_document_expires_on END AS id_document_expires_on,
  p.photo_upload_id,
  CASE WHEN m.masked THEN NULL ELSE ph.key END AS photo_key,
  ph.status AS photo_status,
  p.id_document_upload_id,
  CASE WHEN m.masked THEN NULL ELSE doc.key END AS id_document_key,
  doc.status AS id_document_status,
  p.submitted_at,
  p.edited_at,
  p.fixed_at,
  p.decided_at,
  p.decided_by,
  CASE WHEN m.masked THEN mask_text(p.decision_reason) ELSE p.decision_reason END AS decision_reason,
  p.changes_requested_at,
  CASE WHEN m.masked THEN mask_text(p.changes_requested_note) ELSE p.changes_requested_note END AS changes_requested_note,
  p.changes_requested_by,
  p.reapply_after,
  p.files_deleted_at,
  p.suspended_at,
  CASE WHEN m.masked THEN mask_text(p.suspension_reason) ELSE p.suspension_reason END AS suspension_reason,
  p.approved_at,
  p.is_online,
  p.online_since,
  p.offline_reason,
  p.offline_at,
  p.last_seen_at,
  p.partner_terms_version,
  p.partner_terms_accepted_at,
  p.adult_confirmed_at,
  p.version,
  p.created_at,
  p.updated_at,
  m.masked
FROM delivery_partners p
JOIN users u ON u.id = p.user_id
LEFT JOIN uploads ph ON ph.id = p.photo_upload_id
LEFT JOIN uploads doc ON doc.id = p.id_document_upload_id
CROSS JOIN LATERAL (SELECT app_masks_owner(p.user_id) AS masked) m
WHERE app_role() IN ('support', 'admin', 'system');

-- The history for staff: a real person's texts and notes are withheld from demo staff, and the
-- demo admin never reads the name of a real (not demo or sample) staff member.
CREATE VIEW partner_event_directory WITH (security_barrier = true) AS
SELECT
  e.id,
  e.partner_id,
  e.type,
  e.actor_kind,
  e.actor_id,
  CASE WHEN app_is_demo() AND e.actor_kind = 'staff' AND NOT app_shown_to_demo(e.actor_id) THEN NULL
       ELSE e.actor_name END AS actor_name,
  e.actor_role,
  e.at,
  CASE WHEN m.masked THEN NULL ELSE e.applicant_text END AS applicant_text,
  CASE WHEN m.masked THEN NULL ELSE e.staff_note END AS staff_note,
  e.changed_parts,
  e.version_after,
  m.masked
FROM partner_application_events e
JOIN delivery_partners p ON p.id = e.partner_id
CROSS JOIN LATERAL (SELECT app_masks_owner(p.user_id) AS masked) m
WHERE app_role() IN ('support', 'admin', 'system');

-- Other applications sharing a plate or an ID number with `target` (A22), for reviewers and the
-- demo admin. It compares the stored keys itself and returns only ids and which key matched,
-- so the keys never leave the database and a masked row's plate can't be searched for.
CREATE OR REPLACE FUNCTION app_partner_flag_matches(target uuid)
  RETURNS TABLE (id uuid, same_plate boolean, same_id boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT o.id,
           (t.plate_key IS NOT NULL AND o.plate_key = t.plate_key),
           (t.id_number_hash IS NOT NULL AND o.id_number_hash = t.id_number_hash)
    FROM delivery_partners t
    JOIN delivery_partners o ON o.id <> t.id
      AND ((t.plate_key IS NOT NULL AND o.plate_key = t.plate_key)
        OR (t.id_number_hash IS NOT NULL AND o.id_number_hash = t.id_number_hash))
    WHERE t.id = target AND app_role() IN ('support', 'admin', 'system')
  $$;

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app_store_today(), app_set_partner_role(uuid), app_erase_own_partner_data(),
  app_is_reviewer(), app_partner_flag_matches(uuid), app_partner_upload_ok(uuid, uuid, "UploadPurpose")
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_store_today(), app_set_partner_role(uuid),
      app_erase_own_partner_data(), app_is_reviewer(), app_partner_flag_matches(uuid),
      app_partner_upload_ok(uuid, uuid, "UploadPurpose") TO foodz_app;
    -- The history is append-only for the app (A31.1).
    REVOKE UPDATE, DELETE, TRUNCATE ON "partner_application_events" FROM foodz_app;
    GRANT SELECT, INSERT ON "partner_application_events" TO foodz_app;
    REVOKE ALL ON partner_directory, partner_event_directory FROM foodz_app;
    GRANT SELECT ON partner_directory, partner_event_directory TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT EXECUTE ON FUNCTION app_is_reviewer(), app_store_today() TO foodz_readonly;
    REVOKE ALL ON partner_directory, partner_event_directory, "partner_application_events" FROM foodz_readonly;
  END IF;
END
$$;
