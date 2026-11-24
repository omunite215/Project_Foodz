-- F7: dispatch and delivery offers.
-- Contract: docs/features/F7/contract.md §7, §8 and §12.

-- ---------------------------------------------------------------- enums

-- Used only inside function bodies below: a value added here can't be used by other DDL in the
-- same transaction.
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

-- The database's clock in the form the app stores (UTC, millisecond timestamps). Every dispatch
-- cut-off is decided with it, never with a phone's or an app server's clock.
CREATE OR REPLACE FUNCTION app_now() RETURNS timestamp(3)
  LANGUAGE sql STABLE
  AS $$ SELECT timezone('UTC', now())::timestamp(3) $$;

-- Support and admin, not demo: who may offer an order to a courier or take it off one.
CREATE OR REPLACE FUNCTION app_is_dispatcher() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_role() IN ('support', 'admin') AND NOT app_is_demo() $$;

-- ---------------------------------------------------------------- delivery_partners

ALTER TABLE "delivery_partners"
  ADD COLUMN "waiting_since" TIMESTAMP(3),
  ADD COLUMN "last_point_at" TIMESTAMP(3),
  ADD COLUMN "missed_in_row" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unseen_in_row" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "released_kind" TEXT,
  ADD COLUMN "released_order_number" TEXT,
  ADD COLUMN "released_at" TIMESTAMP(3);

UPDATE "delivery_partners"
SET "waiting_since" = "online_since", "last_point_at" = "last_seen_at"
WHERE "is_online";

ALTER TABLE "delivery_partners"
  DROP CONSTRAINT "delivery_partners_offline_reason",
  ADD CONSTRAINT "delivery_partners_offline_reason" CHECK ("offline_reason" IN (
    'self', 'no-location', 'kitchen-closed', 'other-device', 'suspended', 'signed-out',
    'demo-other-visitor', 'missed-offers'
  )),
  ADD CONSTRAINT "delivery_partners_dispatch_counters" CHECK ("missed_in_row" >= 0 AND "unseen_in_row" >= 0),
  ADD CONSTRAINT "delivery_partners_released_kind" CHECK ("released_kind" IN ('takenOff', 'cancelled', 'handedOver'));

-- The dispatch bookkeeping of a partner row (W3.3, W7.4, B12), kept by the database so no caller
-- can set it: going online starts the wait and the counters again; going offline clears them;
-- every point the server accepts while online (`last_seen_at` moves) proves the phone is alive.
-- Runs after delivery_partners_guard_write (triggers fire by name), so the guard judges only
-- what the caller changed.
CREATE OR REPLACE FUNCTION delivery_partners_track_online() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.is_online AND NOT OLD.is_online THEN
    NEW.waiting_since := app_now();
    NEW.last_point_at := app_now();
    NEW.missed_in_row := 0;
    NEW.unseen_in_row := 0;
  ELSIF OLD.is_online AND NOT NEW.is_online THEN
    NEW.last_point_at := NULL;
    NEW.missed_in_row := 0;
    NEW.unseen_in_row := 0;
  ELSIF NEW.is_online AND NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    NEW.last_point_at := app_now();
    NEW.unseen_in_row := 0;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER delivery_partners_track_online
  BEFORE UPDATE ON "delivery_partners"
  FOR EACH ROW EXECUTE FUNCTION delivery_partners_track_online();

-- ---------------------------------------------------------------- deliveries

ALTER TABLE "deliveries"
  ALTER COLUMN "otp_hash" DROP NOT NULL,
  ADD COLUMN "ready_at" TIMESTAMP(3),
  ADD COLUMN "ready_event_id" UUID,
  ADD COLUMN "search_started_at" TIMESTAMP(3),
  ADD COLUMN "search_restarted_at" TIMESTAMP(3),
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "search_stopped_at" TIMESTAMP(3),
  ADD COLUMN "search_stop_reason" TEXT,
  ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN "tip_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "excluded_partner_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN "partner_waiting_since" TIMESTAMP(3),
  ADD COLUMN "ready_to_assigned_seconds" INTEGER,
  ADD COLUMN "courier_changed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_search_stop_reason" CHECK ("search_stop_reason" IN ('timeout', 'order-changed')),
  ADD CONSTRAINT "deliveries_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  ADD CONSTRAINT "deliveries_amounts" CHECK (
    "partner_fee_cents" >= 0 AND "tip_cents" >= 0 AND "version" >= 0
  ),
  ADD CONSTRAINT "deliveries_held_by_a_partner" CHECK (
    "status" NOT IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP') OR "partner_id" IS NOT NULL
  );

-- One order at a time per partner (B2, W6).
CREATE UNIQUE INDEX "deliveries_one_active_per_partner" ON "deliveries" ("partner_id")
  WHERE "status" IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP');
CREATE INDEX "deliveries_searching_idx" ON "deliveries" ("ready_at") WHERE "status" = 'SEARCHING';

-- ---------------------------------------------------------------- delivery_offers

-- A partner may be offered the same order again (a staff offer after a decline, a second chance
-- after a timeout), so the old one-row-per-pair rule goes (lead decision on B2).
DROP INDEX "delivery_offers_delivery_id_partner_id_key";

ALTER TABLE "delivery_offers"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN "offered_by" UUID,
  ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reach_km" INTEGER,
  ADD COLUMN "pickup_m" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pay_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tip_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "seen_at" TIMESTAMP(3),
  ADD COLUMN "pressed_at" TIMESTAMP(3),
  ADD COLUMN "ended_reason" TEXT;

UPDATE "delivery_offers" SET "ended_reason" = lower("status"::text)
WHERE "status" <> 'PENDING' AND "ended_reason" IS NULL;

ALTER TABLE "delivery_offers"
  ADD CONSTRAINT "delivery_offers_kind" CHECK ("kind" IN ('auto', 'staff')),
  ADD CONSTRAINT "delivery_offers_staff_sender" CHECK (("kind" = 'staff') = ("offered_by" IS NOT NULL)),
  ADD CONSTRAINT "delivery_offers_amounts" CHECK (
    "pay_cents" >= 0 AND "tip_cents" >= 0 AND "tip_cents" <= "pay_cents"
    AND "pickup_m" >= 0 AND "round" >= 1
  ),
  ADD CONSTRAINT "delivery_offers_ended_reason" CHECK ("ended_reason" IN (
    'accepted', 'declined', 'expired', 'withdrawn-offline', 'withdrawn-order', 'withdrawn-staff',
    'taken', 'too-late'
  )),
  ADD CONSTRAINT "delivery_offers_open_has_no_ending" CHECK (("status" = 'PENDING') = ("ended_reason" IS NULL));

-- One open offer per order and one per partner (B2, W4.1, W6): the guards an accept, a timeout
-- and a staff offer race against.
CREATE UNIQUE INDEX "delivery_offers_one_open_per_delivery" ON "delivery_offers" ("delivery_id")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "delivery_offers_one_open_per_partner" ON "delivery_offers" ("partner_id")
  WHERE "status" = 'PENDING';
CREATE INDEX "delivery_offers_delivery_id_created_at_idx" ON "delivery_offers" ("delivery_id", "created_at");

-- ---------------------------------------------------------------- row-level security

-- Partners never write deliveries or offers themselves: their answers go through the definer
-- functions below. The kitchen writes nothing. Support and admin (not demo) write under the
-- guard triggers; the dispatch run writes as the platform.
DROP POLICY deliveries_access ON "deliveries";

CREATE POLICY deliveries_read ON "deliveries" FOR SELECT
  USING (app_can_see_order(order_id));

CREATE POLICY deliveries_insert ON "deliveries" FOR INSERT
  WITH CHECK (app_role() = 'system' OR app_is_dispatcher());

CREATE POLICY deliveries_update ON "deliveries" FOR UPDATE
  USING (app_role() = 'system' OR app_is_dispatcher())
  WITH CHECK (app_role() = 'system' OR app_is_dispatcher());

DROP POLICY delivery_offers_access ON "delivery_offers";

CREATE POLICY delivery_offers_read ON "delivery_offers" FOR SELECT
  USING (partner_id = app_partner_id() OR app_is_operations());

CREATE POLICY delivery_offers_insert ON "delivery_offers" FOR INSERT
  WITH CHECK (
    app_role() = 'system'
    OR (app_is_dispatcher() AND kind = 'staff' AND offered_by = app_user_id())
  );

CREATE POLICY delivery_offers_update ON "delivery_offers" FOR UPDATE
  USING (app_role() = 'system' OR app_is_dispatcher())
  WITH CHECK (app_role() = 'system' OR app_is_dispatcher());

-- What staff may change in a delivery (A37, A38, A39.4): open a search for a ready order, offer
-- it (the version moves on), take it off a courier before pickup and find a courier again. The
-- version always rises and the excluded list only grows. The table owner and the platform pass.
CREATE OR REPLACE FUNCTION deliveries_guard_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  changed text[];
  staff_cols constant text[] := ARRAY[
    'status', 'partner_id', 'assigned_at', 'excluded_partner_ids', 'search_stopped_at',
    'search_stop_reason', 'courier_changed'
  ];
BEGIN
  IF app_role() = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT app_is_dispatcher() THEN
    RAISE EXCEPTION 'permission denied: % may not change deliveries', app_role()
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'SEARCHING' AND NEW.partner_id IS NULL AND NEW.version = 0
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.status = 'READY') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'permission denied: staff open a search only for a ready order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permission denied: deliveries are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(array_agg(n.key), '{}') INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
  changed := array(SELECT unnest(changed) EXCEPT SELECT unnest(ARRAY['version', 'updated_at']));

  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'permission denied: a staff change moves the version on' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT changed <@ staff_cols THEN
    RAISE EXCEPTION 'permission denied: staff don''t change %', changed USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT OLD.excluded_partner_ids <@ NEW.excluded_partner_ids THEN
    RAISE EXCEPTION 'permission denied: the excluded list only grows' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.partner_id IS NOT NULL OR NEW.assigned_at IS NOT NULL AND 'assigned_at' = ANY (changed) THEN
    RAISE EXCEPTION 'permission denied: staff never assign a courier directly' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.status = 'SEARCHING' AND NEW.status = 'SEARCHING')
    OR (OLD.status IN ('ASSIGNED', 'AT_RESTAURANT') AND NEW.status = 'SEARCHING')
    OR (OLD.status = 'CANCELLED' AND NEW.status = 'SEARCHING'
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.status = 'READY')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'permission denied: staff may not move a delivery from % to %', OLD.status, NEW.status
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER deliveries_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_guard_write();

-- Staff send their own offers (open, 60 seconds or less from now) and withdraw an open one
-- instead of the run's; every other offer change is the platform's or a partner's answer
-- through the definer functions.
CREATE OR REPLACE FUNCTION delivery_offers_guard_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  changed text[];
BEGIN
  IF app_role() = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT app_is_dispatcher() THEN
    RAISE EXCEPTION 'permission denied: % may not change offers', app_role()
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'PENDING' AND NEW.kind = 'staff' AND NEW.offered_by = app_user_id()
      AND NEW.seen_at IS NULL AND NEW.pressed_at IS NULL AND NEW.responded_at IS NULL
      AND NEW.expires_at <= app_now() + interval '61 seconds' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'permission denied: staff send only their own open offers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permission denied: offers are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(array_agg(n.key), '{}') INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
  IF OLD.status = 'PENDING' AND NEW.status::text = 'WITHDRAWN' AND NEW.ended_reason = 'withdrawn-staff'
    AND changed <@ ARRAY['status', 'ended_reason', 'responded_at'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'permission denied: staff only withdraw an open offer' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER delivery_offers_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON "delivery_offers"
  FOR EACH ROW EXECUTE FUNCTION delivery_offers_guard_write();

-- ---------------------------------------------------------------- a partner's answers (W6, P22 to P30)

-- Each runs as the table owner for the partner the session belongs to (`app_partner_id()`), and
-- locks rows in one order (the delivery, then the offer, then the partner), the same order every
-- other writer uses. They return what happened; the app maps it to an answer and runs the
-- realtime messages and jobs after commit.

-- How a closed offer reads to a partner who answers it (OFFER_GONE's `why`).
CREATE OR REPLACE FUNCTION app_offer_gone_why(ending text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT CASE
      WHEN ending = 'taken' THEN 'taken'
      WHEN ending = 'withdrawn-order' THEN 'order-changed'
      WHEN ending IN ('withdrawn-offline', 'withdrawn-staff') THEN 'withdrawn'
      ELSE 'expired'
    END
  $$;

CREATE OR REPLACE FUNCTION app_accept_offer(target uuid, grace_seconds integer DEFAULT 2) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  offer_delivery uuid;
  o delivery_offers%ROWTYPE;
  d deliveries%ROWTYPE;
  order_number text;
  order_status text;
  partner_ok boolean;
  busy text;
  waited timestamp(3);
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT f.delivery_id INTO offer_delivery FROM delivery_offers f WHERE f.id = target AND f.partner_id = me;
  IF offer_delivery IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = offer_delivery FOR UPDATE;
  SELECT * INTO o FROM delivery_offers WHERE id = target FOR UPDATE;
  SELECT number, status::text INTO order_number, order_status FROM orders WHERE id = d.order_id;

  IF o.status = 'ACCEPTED' THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'deliveryId', d.id, 'orderId', d.order_id,
      'orderNumber', order_number, 'version', d.version);
  END IF;
  IF o.status <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'gone', 'why', app_offer_gone_why(o.ended_reason));
  END IF;
  IF app_now() > o.expires_at + make_interval(secs => grace_seconds) THEN
    -- Too late: the expiry job closes it as "answered too late" (A36.2).
    UPDATE delivery_offers SET responded_at = coalesce(responded_at, app_now()) WHERE id = target;
    RETURN jsonb_build_object('outcome', 'gone', 'why', 'expired');
  END IF;
  IF order_status <> 'READY' OR d.status <> 'SEARCHING' THEN
    RETURN jsonb_build_object('outcome', 'gone', 'why', 'order-changed');
  END IF;

  SELECT p.status = 'APPROVED' AND p.is_online AND NOT coalesce(u.banned, false), p.waiting_since
    INTO partner_ok, waited
  FROM delivery_partners p JOIN users u ON u.id = p.user_id
  WHERE p.id = me
  FOR UPDATE OF p;
  IF NOT partner_ok THEN
    RETURN jsonb_build_object('outcome', 'not-offerable', 'why', 'offline');
  END IF;
  SELECT o2.number INTO busy
  FROM deliveries d2 JOIN orders o2 ON o2.id = d2.order_id
  WHERE d2.partner_id = me AND d2.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')
  LIMIT 1;
  IF busy IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'busy', 'orderNumber', busy);
  END IF;

  UPDATE delivery_offers
  SET status = 'ACCEPTED', ended_reason = 'accepted', responded_at = app_now()
  WHERE id = target;
  UPDATE delivery_offers
  SET status = 'WITHDRAWN', ended_reason = 'taken', responded_at = app_now()
  WHERE delivery_offers.delivery_id = d.id AND status = 'PENDING';
  UPDATE deliveries
  SET status = 'ASSIGNED', partner_id = me, assigned_at = app_now(),
      partner_fee_cents = o.pay_cents, tip_cents = o.tip_cents, partner_waiting_since = waited,
      ready_to_assigned_seconds = CASE
        WHEN d.ready_at IS NULL THEN NULL
        ELSE greatest(0, extract(epoch FROM app_now() - d.ready_at))::integer
      END,
      version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  UPDATE delivery_partners
  SET missed_in_row = 0, unseen_in_row = 0, released_kind = NULL, released_order_number = NULL,
      released_at = NULL
  WHERE id = me;
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), d.order_id, 'courier-assigned', app_user_id(),
    jsonb_build_object('partnerId', me, 'offerId', target, 'pickupM', o.pickup_m, 'kind', o.kind),
    app_now());
  RETURN jsonb_build_object('outcome', 'accepted', 'deliveryId', d.id, 'orderId', d.order_id,
    'orderNumber', order_number, 'version', d.version + 1);
END
$$;

CREATE OR REPLACE FUNCTION app_decline_offer(target uuid, pressed timestamp(3) DEFAULT NULL,
  grace_seconds integer DEFAULT 2) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  offer_delivery uuid;
  o delivery_offers%ROWTYPE;
  d deliveries%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT f.delivery_id INTO offer_delivery FROM delivery_offers f WHERE f.id = target AND f.partner_id = me;
  IF offer_delivery IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = offer_delivery FOR UPDATE;
  SELECT * INTO o FROM delivery_offers WHERE id = target FOR UPDATE;
  IF o.status = 'DECLINED' THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'deliveryId', d.id, 'orderId', d.order_id);
  END IF;
  IF o.status <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'gone', 'why', app_offer_gone_why(o.ended_reason));
  END IF;
  IF app_now() > o.expires_at + make_interval(secs => grace_seconds) THEN
    UPDATE delivery_offers SET responded_at = coalesce(responded_at, app_now()) WHERE id = target;
    RETURN jsonb_build_object('outcome', 'gone', 'why', 'expired');
  END IF;
  UPDATE delivery_offers
  SET status = 'DECLINED', ended_reason = 'declined', responded_at = app_now(),
      -- Recorded as the phone sent it (P28.4); it never changes the outcome.
      pressed_at = CASE WHEN pressed BETWEEN o.created_at AND app_now() THEN pressed END
  WHERE id = target;
  UPDATE deliveries
  SET excluded_partner_ids = CASE
        WHEN me = ANY (excluded_partner_ids) THEN excluded_partner_ids
        ELSE array_append(excluded_partner_ids, me)
      END,
      version = version + 1, updated_at = app_now()
  WHERE id = d.id;
  UPDATE delivery_partners SET missed_in_row = 0, unseen_in_row = 0 WHERE id = me;
  RETURN jsonb_build_object('outcome', 'declined', 'deliveryId', d.id, 'orderId', d.order_id,
    'version', d.version + 1);
END
$$;

-- The card is on screen (W7.4): the first time is kept, and the phone is alive.
CREATE OR REPLACE FUNCTION app_offer_seen(target uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  seen timestamp(3);
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  UPDATE delivery_offers SET seen_at = coalesce(seen_at, app_now())
  WHERE id = target AND partner_id = me AND status = 'PENDING'
  RETURNING seen_at INTO seen;
  IF seen IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  UPDATE delivery_partners SET unseen_in_row = 0 WHERE id = me AND unseen_in_row > 0;
  RETURN jsonb_build_object('outcome', 'seen', 'seenAt', seen);
END
$$;

-- P28.2: Accept was pressed before the end but reached the server too late. The press is kept
-- so the offer isn't counted as a miss (a miss already counted is taken back); nothing is
-- assigned.
CREATE OR REPLACE FUNCTION app_offer_late_accept(target uuid, pressed timestamp(3)) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  o delivery_offers%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT * INTO o FROM delivery_offers WHERE id = target AND partner_id = me FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  IF o.pressed_at IS NOT NULL OR pressed IS NULL OR pressed < o.created_at OR pressed >= o.expires_at
    OR pressed > app_now() OR o.status::text NOT IN ('PENDING', 'EXPIRED') THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;
  UPDATE delivery_offers SET pressed_at = pressed WHERE id = target;
  IF o.status = 'EXPIRED' AND o.ended_reason = 'expired' AND o.seen_at IS NOT NULL AND o.kind = 'auto' THEN
    UPDATE delivery_partners SET missed_in_row = greatest(missed_in_row - 1, 0) WHERE id = me;
  END IF;
  RETURN jsonb_build_object('outcome', 'recorded');
END
$$;

-- P30: give an assigned order back before pickup. The partner goes to the back of the line and
-- isn't offered this order again; the app starts a new search after commit.
CREATE OR REPLACE FUNCTION app_give_back(target uuid, why text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  d deliveries%ROWTYPE;
  order_number text;
BEGIN
  IF me IS NULL OR why NOT IN ('vehicle', 'emergency', 'too-far', 'other') THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND OR d.partner_id IS DISTINCT FROM me THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  IF d.status NOT IN ('ASSIGNED', 'AT_RESTAURANT') THEN
    RETURN jsonb_build_object('outcome', 'closed', 'status', d.status);
  END IF;
  SELECT number INTO order_number FROM orders WHERE id = d.order_id;
  UPDATE deliveries
  SET status = 'SEARCHING', partner_id = NULL, assigned_at = NULL,
      excluded_partner_ids = CASE
        WHEN me = ANY (excluded_partner_ids) THEN excluded_partner_ids
        ELSE array_append(excluded_partner_ids, me)
      END,
      courier_changed = true, search_stopped_at = NULL, search_stop_reason = NULL,
      version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  UPDATE delivery_partners SET waiting_since = app_now() WHERE id = me;
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), d.order_id, 'courier-gave-back', app_user_id(),
    jsonb_build_object('partnerId', me, 'reason', why), app_now());
  RETURN jsonb_build_object('outcome', 'gave-back', 'deliveryId', d.id, 'orderId', d.order_id,
    'orderNumber', order_number, 'version', d.version + 1, 'partnerId', me);
END
$$;

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app_accept_offer(uuid, integer), app_decline_offer(uuid, timestamp, integer),
  app_offer_seen(uuid), app_offer_late_accept(uuid, timestamp), app_give_back(uuid, text),
  app_offer_gone_why(text), app_now(), app_is_dispatcher() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_accept_offer(uuid, integer), app_decline_offer(uuid, timestamp, integer),
      app_offer_seen(uuid), app_offer_late_accept(uuid, timestamp), app_give_back(uuid, text),
      app_offer_gone_why(text), app_now(), app_is_dispatcher() TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT EXECUTE ON FUNCTION app_now(), app_is_dispatcher() TO foodz_readonly;
  END IF;
END
$$;
