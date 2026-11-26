-- F8: live tracking, the courier's own steps, the delivery code and the live map.
-- Contract: docs/features/F8/contract.md §2, §4, §5, §11.

-- ---------------------------------------------------------------- deliveries

ALTER TABLE "deliveries"
  DROP COLUMN "otp_hash",
  DROP COLUMN "otp_attempts",
  ADD COLUMN "at_restaurant_at" TIMESTAMP(3),
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "otp_wrong_tries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otp_locked_at" TIMESTAMP(3),
  ADD COLUMN "almost_notified_at" TIMESTAMP(3),
  ADD COLUMN "no_answer_since" TIMESTAMP(3),
  ADD COLUMN "no_answer_reported_at" TIMESTAMP(3),
  ADD COLUMN "no_answer_wait_restarted_at" TIMESTAMP(3),
  ADD COLUMN "problem_kind" TEXT,
  ADD COLUMN "problem_at" TIMESTAMP(3),
  ADD COLUMN "eta_estimated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "route_updated_at" TIMESTAMP(3),
  ADD COLUMN "handover_how" TEXT;

UPDATE "deliveries" SET "ended_at" = coalesce("delivered_at", "updated_at")
WHERE "status" IN ('DELIVERED', 'CANCELLED');

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_otp_tries" CHECK ("otp_wrong_tries" BETWEEN 0 AND 5),
  ADD CONSTRAINT "deliveries_problem_kind" CHECK ("problem_kind" IN ('address', 'refused', 'cant-finish', 'other')),
  ADD CONSTRAINT "deliveries_handover_how" CHECK ("handover_how" IN ('code', 'staff-confirmed', 'admin-override', 'demo'));

-- L8.2: the retention job finds ended deliveries by this.
CREATE INDEX "deliveries_ended_at_idx" ON "deliveries" ("ended_at") WHERE "ended_at" IS NOT NULL;

-- ---------------------------------------------------------------- the delivery code (U4, L6)

-- A table of its own because row-level security hides rows, not columns, and the courier and
-- staff read `deliveries`. Only the order's customer and the platform read a code; it is written
-- and checked only by the definer functions below and deleted when the delivery ends.
CREATE TABLE "delivery_codes" (
  "delivery_id" UUID NOT NULL,
  "code_enc" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_codes_pkey" PRIMARY KEY ("delivery_id"),
  CONSTRAINT "delivery_codes_delivery_id_fkey" FOREIGN KEY ("delivery_id")
    REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivery_codes_hash" CHECK ("code_hash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "delivery_codes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_codes_read ON "delivery_codes" FOR SELECT
  USING (
    app_role() = 'system'
    OR EXISTS (
      SELECT 1 FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.id = delivery_id AND o.user_id = app_user_id()
    )
  );

CREATE POLICY delivery_codes_write ON "delivery_codes" FOR ALL
  USING (app_role() = 'system')
  WITH CHECK (app_role() = 'system');

-- However a delivery ends (code, staff, override, cancellation) or goes back to the search, the
-- end time is stamped and the code is deleted (L6.4). The stamp runs after F7's guard (by name),
-- so staff are never judged on it; the delete runs as the owner because nobody else may.
CREATE OR REPLACE FUNCTION deliveries_track_end() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.status IN ('DELIVERED', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.ended_at := coalesce(NEW.ended_at, app_now());
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER deliveries_track_end
  BEFORE UPDATE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_track_end();

CREATE OR REPLACE FUNCTION deliveries_drop_code() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF NEW.status IN ('DELIVERED', 'CANCELLED', 'SEARCHING') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM delivery_codes WHERE delivery_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER deliveries_drop_code
  AFTER UPDATE OF "status" ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_drop_code();

-- ---------------------------------------------------------------- the demo run (L10)

CREATE TABLE "demo_runs" (
  "id" UUID NOT NULL,
  "order_id" UUID,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "requested_by" UUID,
  CONSTRAINT "demo_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_runs_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "demo_runs_status" CHECK ("status" IN ('running', 'done', 'failed'))
);

-- One run at a time for the whole demo (L10.2).
CREATE UNIQUE INDEX "demo_runs_one_running" ON "demo_runs" ((true)) WHERE "status" = 'running';
CREATE INDEX "demo_runs_started_at_idx" ON "demo_runs" ("started_at");

ALTER TABLE "demo_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY demo_runs_read ON "demo_runs" FOR SELECT
  USING (app_role() = 'system' OR (app_is_operations() AND app_is_demo()));

CREATE POLICY demo_runs_write ON "demo_runs" FOR ALL
  USING (app_role() = 'system')
  WITH CHECK (app_role() = 'system');

-- ---------------------------------------------------------------- the bot courier (U14)

ALTER TABLE "delivery_partners" ADD COLUMN "is_bot" BOOLEAN NOT NULL DEFAULT false;

-- Only the platform (or the table owner) makes or unmakes a bot; F6's guard runs first.
CREATE OR REPLACE FUNCTION delivery_partners_guard_bot() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_bot OR TG_OP = 'UPDATE' AND NEW.is_bot IS DISTINCT FROM OLD.is_bot)
    AND app_role() <> 'system'
    AND NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RAISE EXCEPTION 'permission denied: only the platform marks a bot courier'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER delivery_partners_guard_bot
  BEFORE INSERT OR UPDATE ON "delivery_partners"
  FOR EACH ROW EXECUTE FUNCTION delivery_partners_guard_bot();

-- ---------------------------------------------------------------- orders

ALTER TABLE "orders" ADD COLUMN "address_area" TEXT;

ALTER TABLE "orders" DROP CONSTRAINT "orders_cancel_code";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancel_code" CHECK (
    ("cancel_code" IS NOT NULL) = ("cancel_reason" IS NOT NULL AND "cancel_reason" IN ('staff', 'kitchen-refused'))
    AND (
      "cancel_code" IS NULL
      OR "cancel_code" IN ('customer-asked', 'dish-unavailable', 'too-busy', 'closing', 'cant-deliver', 'fraud',
                           'other', 'customer-unreachable')
    )
    AND (
      "cancel_reason" IS DISTINCT FROM 'kitchen-refused'
      OR "cancel_code" IN ('dish-unavailable', 'too-busy', 'closing', 'other')
    )
  );

-- ---------------------------------------------------------------- location history (L8, U16)

-- The path is the platform's and, for F10's replay, non-demo support and admin's. The customer
-- sees the live point only while the food is on its way; the courier never reads it back.
DROP POLICY delivery_locations_access ON "delivery_locations";

CREATE POLICY delivery_locations_read ON "delivery_locations" FOR SELECT
  USING (app_role() = 'system' OR app_is_dispatcher());

CREATE POLICY delivery_locations_insert ON "delivery_locations" FOR INSERT
  WITH CHECK (app_role() = 'system');

-- ---------------------------------------------------------------- the courier's steps (B1, L6, L7)

-- Each runs as the table owner for the partner the session belongs to and locks the delivery,
-- then the order, then the partner, as F7's functions do. The app runs realtime, notices and jobs
-- after commit from the answer.

-- P38: "Picked up". The code is drawn, encrypted and hashed by the app and stored here.
CREATE OR REPLACE FUNCTION app_pick_up(target uuid, code_enc text, code_hash text, confirm_far boolean DEFAULT false)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO o FROM orders WHERE id = d.order_id FOR UPDATE;
  IF d.partner_id IS NOT DISTINCT FROM me AND d.status IN ('PICKED_UP', 'DELIVERED') THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'deliveryId', d.id, 'orderId', d.order_id,
      'orderNumber', o.number, 'version', d.version);
  END IF;
  IF d.partner_id IS DISTINCT FROM me OR d.status NOT IN ('ASSIGNED', 'AT_RESTAURANT') THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  IF o.status <> 'READY' THEN
    RETURN jsonb_build_object('outcome', 'not-ready', 'orderNumber', o.number);
  END IF;
  IF code_hash !~ '^[0-9a-f]{64}$' OR coalesce(code_enc, '') = '' THEN
    RAISE EXCEPTION 'a delivery code is required' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO delivery_codes (delivery_id, code_enc, code_hash, created_at)
  VALUES (d.id, code_enc, code_hash, app_now())
  ON CONFLICT (delivery_id) DO UPDATE SET code_enc = EXCLUDED.code_enc, code_hash = EXCLUDED.code_hash,
    created_at = EXCLUDED.created_at;
  UPDATE deliveries
  SET status = 'PICKED_UP', picked_up_at = app_now(), otp_wrong_tries = 0, otp_locked_at = NULL,
      version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  UPDATE orders
  SET status = 'PICKED_UP', picked_up_at = app_now(), version = o.version + 1, updated_at = app_now()
  WHERE id = o.id;
  INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'picked-up', 'READY', 'PICKED_UP', app_user_id(),
    jsonb_build_object('actor', 'courier', 'partnerId', me, 'confirmFar', coalesce(confirm_far, false)),
    app_now());
  RETURN jsonb_build_object('outcome', 'picked-up', 'deliveryId', d.id, 'orderId', o.id,
    'orderNumber', o.number, 'version', d.version + 1, 'orderVersion', o.version + 1);
END
$$;

-- P41, P42, L6.2: the code check, atomic with the try count; the fifth wrong try locks it.
CREATE OR REPLACE FUNCTION app_hand_over(target uuid, typed_hash text, cash_collected boolean DEFAULT false,
  confirm_far boolean DEFAULT false)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
  stored text;
  tries integer;
  cash integer;
BEGIN
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND OR d.partner_id IS DISTINCT FROM me THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO o FROM orders WHERE id = d.order_id FOR UPDATE;
  IF d.status = 'DELIVERED' THEN
    RETURN jsonb_build_object('outcome', 'delivered', 'replayed', true, 'deliveryId', d.id,
      'orderId', o.id, 'orderNumber', o.number, 'payCents', d.partner_fee_cents, 'version', d.version);
  END IF;
  IF d.status <> 'PICKED_UP' THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  IF d.otp_locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'locked');
  END IF;
  SELECT c.code_hash INTO stored FROM delivery_codes c WHERE c.delivery_id = d.id;
  IF stored IS NULL OR typed_hash IS NULL OR typed_hash <> stored THEN
    tries := d.otp_wrong_tries + 1;
    UPDATE deliveries
    SET otp_wrong_tries = tries,
        otp_locked_at = CASE WHEN tries >= 5 THEN app_now() ELSE NULL END,
        version = d.version + 1, updated_at = app_now()
    WHERE id = d.id;
    INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
    VALUES (gen_random_uuid(), o.id, CASE WHEN tries >= 5 THEN 'otp-locked' ELSE 'otp-wrong' END,
      app_user_id(), jsonb_build_object('try', tries, 'partnerId', me), app_now());
    IF tries >= 5 THEN
      RETURN jsonb_build_object('outcome', 'locked', 'orderId', o.id, 'version', d.version + 1, 'justLocked', true);
    END IF;
    RETURN jsonb_build_object('outcome', 'wrong', 'triesLeft', 5 - tries, 'orderId', o.id, 'version', d.version + 1);
  END IF;
  IF o.payment_method = 'CASH' AND o.payment_status = 'UNPAID' AND NOT coalesce(cash_collected, false) THEN
    RETURN jsonb_build_object('outcome', 'cash-required');
  END IF;
  cash := CASE WHEN o.payment_method = 'CASH' AND o.payment_status = 'UNPAID' THEN o.total_cents ELSE 0 END;
  PERFORM app_finish_delivery(d.id, 'code');
  UPDATE orders
  SET status = 'DELIVERED', delivered_at = app_now(),
      payment_status = CASE WHEN cash > 0 THEN 'PAID'::"PaymentStatus" ELSE payment_status END,
      version = o.version + 1, updated_at = app_now()
  WHERE id = o.id;
  INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'delivered', 'PICKED_UP', 'DELIVERED', app_user_id(),
    jsonb_build_object('actor', 'courier', 'partnerId', me, 'cashCollectedCents', CASE WHEN cash > 0 THEN cash END,
      'confirmFar', coalesce(confirm_far, false)),
    app_now());
  RETURN jsonb_build_object('outcome', 'delivered', 'replayed', false, 'deliveryId', d.id, 'orderId', o.id,
    'orderNumber', o.number, 'payCents', d.partner_fee_cents, 'tipCents', d.tip_cents, 'cashCents', cash,
    'version', d.version + 1, 'partnerId', me);
END
$$;

-- Ends a delivery as delivered (code, staff or override): the code goes, the partner goes back
-- to the line. Called from the definer functions above and below; never granted to the app.
CREATE OR REPLACE FUNCTION app_finish_delivery(target uuid, how text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  holder uuid;
BEGIN
  UPDATE deliveries
  SET status = 'DELIVERED', delivered_at = app_now(), ended_at = app_now(), handover_how = how,
      no_answer_since = NULL, version = version + 1, updated_at = app_now()
  WHERE id = target
  RETURNING partner_id INTO holder;
  DELETE FROM delivery_codes WHERE delivery_id = target;
  IF holder IS NOT NULL THEN
    UPDATE delivery_partners SET waiting_since = app_now() WHERE id = holder;
  END IF;
END
$$;

-- P43: a problem at the door. "isn't answering" starts the 5-minute clock (kept if running).
CREATE OR REPLACE FUNCTION app_report_problem(target uuid, kind text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  d deliveries%ROWTYPE;
BEGIN
  IF me IS NULL OR kind NOT IN ('no-answer', 'address', 'refused', 'cant-finish', 'other') THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND OR d.partner_id IS DISTINCT FROM me OR d.status <> 'PICKED_UP' THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  IF kind = 'no-answer' THEN
    IF d.no_answer_since IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'replayed', 'since', d.no_answer_since, 'orderId', d.order_id);
    END IF;
    UPDATE deliveries SET no_answer_since = app_now(), version = d.version + 1, updated_at = app_now()
    WHERE id = d.id;
  ELSE
    UPDATE deliveries SET problem_kind = kind, problem_at = app_now(), version = d.version + 1, updated_at = app_now()
    WHERE id = d.id;
  END IF;
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), d.order_id, CASE WHEN kind = 'no-answer' THEN 'courier-no-answer' ELSE 'courier-problem' END,
    app_user_id(), jsonb_build_object('partnerId', me, 'reason', kind), app_now());
  RETURN jsonb_build_object('outcome', 'reported', 'since', app_now(), 'orderId', d.order_id, 'version', d.version + 1);
END
$$;

-- P43.3: "Tell Foodz nobody answered", once the wait has run out (by the database clock).
CREATE OR REPLACE FUNCTION app_report_no_answer(target uuid, wait_seconds integer DEFAULT 300) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  d deliveries%ROWTYPE;
BEGIN
  wait_seconds := least(greatest(coalesce(wait_seconds, 300), 1), 300);
  IF me IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND OR d.partner_id IS DISTINCT FROM me OR d.status <> 'PICKED_UP' OR d.no_answer_since IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-assigned');
  END IF;
  IF d.no_answer_reported_at IS NOT NULL AND d.no_answer_reported_at >= d.no_answer_since THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'toldAt', d.no_answer_reported_at);
  END IF;
  IF app_now() < d.no_answer_since + make_interval(secs => wait_seconds) THEN
    RETURN jsonb_build_object('outcome', 'too-early');
  END IF;
  UPDATE deliveries SET no_answer_reported_at = app_now(), version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  RETURN jsonb_build_object('outcome', 'told', 'toldAt', app_now(), 'orderId', d.order_id, 'version', d.version + 1);
END
$$;

-- ---------------------------------------------------------------- staff finish a stuck delivery (A50, A51)

-- Support and admin (not demo); support only after a lock or a run-out wait (A50.3), admin always
-- for a delivery that is picked up. The caller writes the audit row in the same transaction.
CREATE OR REPLACE FUNCTION app_staff_confirm_handover(target uuid, expected_version integer, reason text,
  cash_collected boolean DEFAULT false, wait_seconds integer DEFAULT 300, note text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
  cash integer;
  stuck boolean;
BEGIN
  wait_seconds := least(greatest(coalesce(wait_seconds, 300), 1), 300);
  IF NOT app_is_dispatcher() THEN
    RAISE EXCEPTION 'permission denied: only support and admin confirm a hand-over' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF reason NOT IN ('customer-confirmed', 'left-as-asked', 'code-checked', 'other', 'courier-app-down') THEN
    RAISE EXCEPTION 'unknown reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT * INTO o FROM orders WHERE id = d.order_id FOR UPDATE;
  IF d.version <> expected_version OR d.status <> 'PICKED_UP' THEN
    RETURN jsonb_build_object('outcome', 'changed', 'status', d.status, 'version', d.version);
  END IF;
  stuck := d.otp_locked_at IS NOT NULL
    OR (d.no_answer_since IS NOT NULL AND app_now() >= d.no_answer_since + make_interval(secs => wait_seconds));
  IF app_role() = 'support' AND NOT stuck THEN
    RETURN jsonb_build_object('outcome', 'not-stuck');
  END IF;
  IF o.payment_method = 'CASH' AND o.payment_status = 'UNPAID' AND NOT coalesce(cash_collected, false) THEN
    RETURN jsonb_build_object('outcome', 'cash-required');
  END IF;
  cash := CASE WHEN o.payment_method = 'CASH' AND o.payment_status = 'UNPAID' THEN o.total_cents ELSE 0 END;
  PERFORM app_finish_delivery(d.id, CASE WHEN stuck THEN 'staff-confirmed' ELSE 'admin-override' END);
  UPDATE orders
  SET status = 'DELIVERED', delivered_at = app_now(),
      payment_status = CASE WHEN cash > 0 THEN 'PAID'::"PaymentStatus" ELSE payment_status END,
      version = o.version + 1, updated_at = app_now()
  WHERE id = o.id;
  INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'delivered', 'PICKED_UP', 'DELIVERED', app_user_id(),
    jsonb_build_object('actor', 'staff', 'reason', reason, 'cashCollectedCents', CASE WHEN cash > 0 THEN cash END,
      'note', note),
    app_now());
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'handover-confirmed', app_user_id(),
    jsonb_build_object('partnerId', d.partner_id, 'reason', reason), app_now());
  RETURN jsonb_build_object('outcome', 'delivered', 'deliveryId', d.id, 'orderId', o.id, 'orderNumber', o.number,
    'partnerId', d.partner_id, 'payCents', d.partner_fee_cents, 'tipCents', d.tip_cents, 'cashCents', cash,
    'version', d.version + 1, 'how', CASE WHEN stuck THEN 'staff-confirmed' ELSE 'admin-override' END);
END
$$;

-- A50.1: "Ask Luis to wait 5 more minutes" restarts the clock.
CREATE OR REPLACE FUNCTION app_staff_ask_to_wait(target uuid, expected_version integer) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  d deliveries%ROWTYPE;
BEGIN
  IF NOT app_is_dispatcher() THEN
    RAISE EXCEPTION 'permission denied: only support and admin ask a courier to wait' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  IF d.version <> expected_version OR d.status <> 'PICKED_UP' OR d.no_answer_since IS NULL THEN
    RETURN jsonb_build_object('outcome', 'changed', 'status', d.status, 'version', d.version);
  END IF;
  UPDATE deliveries
  SET no_answer_since = app_now(), no_answer_wait_restarted_at = app_now(), version = d.version + 1,
      updated_at = app_now()
  WHERE id = d.id;
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), d.order_id, 'asked-to-wait', app_user_id(),
    jsonb_build_object('partnerId', d.partner_id), app_now());
  RETURN jsonb_build_object('outcome', 'waiting', 'deliveryId', d.id, 'orderId', d.order_id,
    'partnerId', d.partner_id, 'since', app_now(), 'version', d.version + 1);
END
$$;

-- A50.1, U6: "Cancel and bring it back" after pickup: the order is cancelled by staff with
-- "Customer couldn't be reached" and the courier released. F5's refund rules run after commit.
CREATE OR REPLACE FUNCTION app_staff_cancel_unreachable(target uuid, expected_version integer, note text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
BEGIN
  IF NOT app_is_dispatcher() THEN
    RAISE EXCEPTION 'permission denied: only support and admin cancel a delivery' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO d FROM deliveries WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  SELECT * INTO o FROM orders WHERE id = d.order_id FOR UPDATE;
  IF d.version <> expected_version OR d.status <> 'PICKED_UP' OR o.status <> 'PICKED_UP' THEN
    RETURN jsonb_build_object('outcome', 'changed', 'status', d.status, 'version', d.version);
  END IF;
  UPDATE deliveries
  SET status = 'CANCELLED', no_answer_since = NULL, version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  IF d.partner_id IS NOT NULL THEN
    UPDATE delivery_partners SET waiting_since = app_now() WHERE id = d.partner_id;
  END IF;
  UPDATE orders
  SET status = 'CANCELLED', cancelled_at = app_now(), cancel_reason = 'staff',
      cancel_code = 'customer-unreachable', version = o.version + 1, updated_at = app_now()
  WHERE id = o.id;
  INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'cancelled', 'PICKED_UP', 'CANCELLED', app_user_id(),
    jsonb_build_object('actor', 'staff', 'reason', 'customer-unreachable', 'note', note), app_now());
  RETURN jsonb_build_object('outcome', 'cancelled', 'deliveryId', d.id, 'orderId', o.id, 'orderNumber', o.number,
    'partnerId', d.partner_id, 'version', d.version + 1, 'paidByCard',
    o.payment_method = 'CARD' AND o.payment_status = 'PAID');
END
$$;

-- L8.2: the app may only append positions, so the nightly purge runs as the owner, for the
-- platform only: positions and stored routes of deliveries that ended before `cutoff`.
CREATE OR REPLACE FUNCTION app_purge_delivery_locations(cutoff timestamp(3)) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  positions integer;
  routes integer;
BEGIN
  IF app_role() <> 'system' THEN
    RAISE EXCEPTION 'permission denied: only the platform purges positions' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM delivery_locations l USING deliveries d
  WHERE l.delivery_id = d.id AND d.ended_at IS NOT NULL AND d.ended_at < cutoff;
  GET DIAGNOSTICS positions = ROW_COUNT;
  UPDATE deliveries SET route_geojson = NULL
  WHERE ended_at IS NOT NULL AND ended_at < cutoff AND route_geojson IS NOT NULL;
  GET DIAGNOSTICS routes = ROW_COUNT;
  RETURN jsonb_build_object('rows', positions, 'routes', routes);
END
$$;

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app_pick_up(uuid, text, text, boolean), app_hand_over(uuid, text, boolean, boolean),
  app_finish_delivery(uuid, text), app_report_problem(uuid, text), app_report_no_answer(uuid, integer),
  app_staff_confirm_handover(uuid, integer, text, boolean, integer, text), app_staff_ask_to_wait(uuid, integer),
  app_staff_cancel_unreachable(uuid, integer, text), app_purge_delivery_locations(timestamp) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_pick_up(uuid, text, text, boolean), app_hand_over(uuid, text, boolean, boolean),
      app_report_problem(uuid, text), app_report_no_answer(uuid, integer),
      app_staff_confirm_handover(uuid, integer, text, boolean, integer, text), app_staff_ask_to_wait(uuid, integer),
      app_staff_cancel_unreachable(uuid, integer, text), app_purge_delivery_locations(timestamp) TO foodz_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "delivery_codes", "demo_runs" TO foodz_app;
  END IF;
END
$$;
