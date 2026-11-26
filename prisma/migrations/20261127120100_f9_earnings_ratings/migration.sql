-- F9 (contract §13): the partner earnings ledger, payouts and the report, online sessions, and
-- food and courier ratings.
--
-- The ledger is append-only for the app. Every delivery that ends writes its entries from a
-- trigger on the delivery's status, in the same transaction as the transition, so no ending can
-- skip it. Staff entries go through one definer function that checks the role, the partner's
-- ledger version, the idempotency key and the limits. Partners read their own rows; the staff
-- member and the staff note live in a side table they can't read. Ratings get row-level
-- security for the first time; partners read only aggregates about themselves.

-- ---------------------------------------------------------------- store time (E5)

CREATE OR REPLACE FUNCTION app_store_zone() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT coalesce((SELECT timezone FROM site_settings WHERE id = 1), 'America/New_York') $$;

-- The store date of a UTC timestamp, and the UTC start of a store date. Computed per date, so a
-- 23- or 25-hour day is right.
CREATE OR REPLACE FUNCTION app_store_date(ts timestamp(3)) RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT ((ts AT TIME ZONE 'UTC') AT TIME ZONE app_store_zone())::date $$;

CREATE OR REPLACE FUNCTION app_store_day_start(d date) RETURNS timestamp(3)
  LANGUAGE sql STABLE
  AS $$ SELECT ((d::timestamp AT TIME ZONE app_store_zone()) AT TIME ZONE 'UTC')::timestamp(3) $$;

-- ---------------------------------------------------------------- the ledger (E1)

ALTER TABLE "partner_earnings" DROP CONSTRAINT "partner_earnings_delivery_id_fkey";
DROP INDEX "partner_earnings_partner_id_created_at_idx";

ALTER TABLE "partner_earnings"
  DROP COLUMN "note",
  ADD COLUMN "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT app_now(),
  ADD COLUMN "recorded_kind" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "partner_message" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "paid_on" DATE,
  ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN "idempotency_key" TEXT NOT NULL,
  ADD COLUMN "version_after" INTEGER NOT NULL,
  ADD COLUMN "balance_after_cents" BIGINT NOT NULL,
  ADD COLUMN "holding_after_cents" BIGINT NOT NULL;

ALTER TABLE "partner_earnings"
  ADD CONSTRAINT "partner_earnings_delivery_id_fkey" FOREIGN KEY ("delivery_id")
    REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_earnings_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  ADD CONSTRAINT "partner_earnings_recorded_kind" CHECK ("recorded_kind" IN ('system', 'staff')),
  ADD CONSTRAINT "partner_earnings_sign" CHECK (
    abs("amount_cents") <= 10000000 AND CASE "type"
      WHEN 'DELIVERY_FEE' THEN "amount_cents" >= 0
      WHEN 'TIP' THEN "amount_cents" > 0
      WHEN 'BONUS' THEN "amount_cents" > 0
      WHEN 'ADJUSTMENT' THEN "amount_cents" <> 0
      WHEN 'CASH_COLLECTED' THEN "amount_cents" < 0
      WHEN 'CASH_HANDED_IN' THEN "amount_cents" > 0
      WHEN 'PAYOUT' THEN "amount_cents" < 0
    END
  ),
  ADD CONSTRAINT "partner_earnings_who" CHECK (
    ("type" IN ('DELIVERY_FEE', 'TIP', 'CASH_COLLECTED')) = ("recorded_kind" = 'system')
    AND ("recorded_kind" = 'staff' OR "delivery_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "partner_earnings_reason" CHECK (CASE "type"
    WHEN 'DELIVERY_FEE' THEN "reason" IS NULL OR "reason" = 'cancelled-after-pickup'
    WHEN 'BONUS' THEN "reason" = 'bonus'
    WHEN 'ADJUSTMENT' THEN "reason" IN ('cancelled-order-pay', 'correction', 'other')
    ELSE "reason" IS NULL
  END),
  ADD CONSTRAINT "partner_earnings_message" CHECK (
    CASE WHEN "type" IN ('BONUS', 'ADJUSTMENT')
      THEN "partner_message" IS NOT NULL AND char_length("partner_message") BETWEEN 1 AND 200
      ELSE "partner_message" IS NULL
    END
  ),
  ADD CONSTRAINT "partner_earnings_payout" CHECK (
    ("type" = 'PAYOUT') = ("method" IS NOT NULL AND "paid_on" IS NOT NULL)
    AND ("method" IS NULL OR "method" IN ('bank-transfer', 'cash-at-kitchen', 'other'))
    AND ("reference" IS NULL OR ("type" = 'PAYOUT' AND char_length("reference") BETWEEN 1 AND 60))
  ),
  ADD CONSTRAINT "partner_earnings_version_after" CHECK ("version_after" > 0);

CREATE INDEX "partner_earnings_partner_id_occurred_at_idx"
  ON "partner_earnings" ("partner_id", "occurred_at", "version_after");
CREATE INDEX "partner_earnings_delivery_id_idx" ON "partner_earnings" ("delivery_id");
CREATE UNIQUE INDEX "partner_earnings_idempotency_key_key" ON "partner_earnings" ("idempotency_key");
-- Exactly once per delivery outcome (E3.1).
CREATE UNIQUE INDEX "partner_earnings_one_automatic_per_delivery" ON "partner_earnings" ("delivery_id", "type")
  WHERE "type" IN ('DELIVERY_FEE', 'TIP', 'CASH_COLLECTED');

-- Who recorded a staff entry and the staff note: staff only (P60.3). A row-level policy can't
-- hide a column, and a partner reads his own ledger rows.
CREATE TABLE "partner_earning_staff" (
  "earning_id" UUID NOT NULL,
  "recorded_by" UUID NOT NULL,
  "recorded_name" TEXT NOT NULL,
  "recorded_role" TEXT NOT NULL,
  "staff_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT app_now(),
  CONSTRAINT "partner_earning_staff_pkey" PRIMARY KEY ("earning_id"),
  CONSTRAINT "partner_earning_staff_earning_id_fkey" FOREIGN KEY ("earning_id")
    REFERENCES "partner_earnings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_earning_staff_role" CHECK ("recorded_role" IN ('support', 'admin')),
  CONSTRAINT "partner_earning_staff_note" CHECK (
    "staff_note" IS NULL OR char_length("staff_note") BETWEEN 1 AND 500
  )
);

-- One row per partner: the cached balance (E1.3), checked every night (E7).
CREATE TABLE "partner_ledgers" (
  "partner_id" UUID NOT NULL,
  "pool" TEXT NOT NULL DEFAULT 'REAL',
  "version" INTEGER NOT NULL DEFAULT 0,
  "balance_cents" BIGINT NOT NULL DEFAULT 0,
  "holding_cents" BIGINT NOT NULL DEFAULT 0,
  "owed_since" TIMESTAMP(3),
  "first_entry_at" TIMESTAMP(3),
  "last_entry_at" TIMESTAMP(3),
  "last_payout_entry_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT app_now(),
  CONSTRAINT "partner_ledgers_pkey" PRIMARY KEY ("partner_id"),
  CONSTRAINT "partner_ledgers_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "delivery_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_ledgers_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  CONSTRAINT "partner_ledgers_counts" CHECK ("version" >= 0 AND "holding_cents" >= 0)
);

-- Store-day totals per partner, written with each entry, so a report sums days (A63.6).
CREATE TABLE "partner_ledger_days" (
  "partner_id" UUID NOT NULL,
  "day" DATE NOT NULL,
  "pool" TEXT NOT NULL DEFAULT 'REAL',
  "deliveries" INTEGER NOT NULL DEFAULT 0,
  "delivery_pay_cents" BIGINT NOT NULL DEFAULT 0,
  "tips_cents" BIGINT NOT NULL DEFAULT 0,
  "adjustments_cents" BIGINT NOT NULL DEFAULT 0,
  "cash_collected_cents" BIGINT NOT NULL DEFAULT 0,
  "cash_handed_in_cents" BIGINT NOT NULL DEFAULT 0,
  "paid_out_cents" BIGINT NOT NULL DEFAULT 0,
  "net_cents" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "partner_ledger_days_pkey" PRIMARY KEY ("partner_id", "day"),
  CONSTRAINT "partner_ledger_days_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "delivery_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_ledger_days_pool" CHECK ("pool" IN ('REAL', 'DEMO'))
);
CREATE INDEX "partner_ledger_days_pool_day_idx" ON "partner_ledger_days" ("pool", "day");

-- ---------------------------------------------------------------- online sessions (E6)

CREATE TABLE "partner_online_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "partner_id" UUID NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "end_reason" TEXT,
  "pool" TEXT NOT NULL DEFAULT 'REAL',
  CONSTRAINT "partner_online_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_online_sessions_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_online_sessions_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  CONSTRAINT "partner_online_sessions_times" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "partner_online_sessions_reason" CHECK ("end_reason" IS NULL OR char_length("end_reason") <= 40)
);
CREATE UNIQUE INDEX "partner_online_sessions_one_open" ON "partner_online_sessions" ("partner_id")
  WHERE "ended_at" IS NULL;
CREATE INDEX "partner_online_sessions_partner_id_started_at_idx"
  ON "partner_online_sessions" ("partner_id", "started_at");

-- ---------------------------------------------------------------- columns on existing tables

-- Who held the delivery when it ended: F5's cancellation clears partner_id (F7 releaseDelivery).
ALTER TABLE "deliveries" ADD COLUMN "ended_partner_id" UUID;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_ended_partner_id_fkey" FOREIGN KEY ("ended_partner_id")
  REFERENCES "delivery_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_partners"
  ADD COLUMN "daily_goal_cents" INTEGER,
  ADD COLUMN "rating_base_avg" NUMERIC(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "rating_base_count" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "delivery_partners_daily_goal" CHECK (
    "daily_goal_cents" IS NULL
    OR ("daily_goal_cents" BETWEEN 1000 AND 100000 AND "daily_goal_cents" % 100 = 0)
  ),
  ADD CONSTRAINT "delivery_partners_rating_base" CHECK (
    "rating_base_avg" BETWEEN 0 AND 5 AND "rating_base_count" >= 0
  );

ALTER TABLE "menu_items"
  ADD COLUMN "rating_base_avg" NUMERIC(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "rating_base_count" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "menu_items_rating_base" CHECK (
    "rating_base_avg" BETWEEN 0 AND 5 AND "rating_base_count" >= 0
  );

ALTER TABLE "orders"
  ADD COLUMN "rating_skipped_at" TIMESTAMP(3),
  ADD COLUMN "rating_reminded_at" TIMESTAMP(3);

-- ---------------------------------------------------------------- ratings (V1–V10)

ALTER TABLE "reviews" DROP CONSTRAINT "reviews_user_id_fkey";
DROP INDEX "reviews_user_id_menu_item_id_order_id_key";
ALTER TABLE "reviews"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "edited_at" TIMESTAMP(3),
  ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN "excluded_reason" TEXT,
  ADD COLUMN "excluded_note" TEXT,
  ADD COLUMN "moderated_by" UUID,
  ADD COLUMN "moderated_at" TIMESTAMP(3);
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "reviews_rating" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_tags" CHECK (
    cardinality("tags") <= 11 AND "tags" <@ CASE WHEN "rating" >= 4
      THEN ARRAY['tasty', 'fresh', 'good-portion', 'well-packed', 'arrived-hot']::text[]
      ELSE ARRAY['cold', 'too-salty', 'too-spicy', 'small-portion', 'not-as-described', 'badly-packed']::text[]
    END
  ),
  ADD CONSTRAINT "reviews_comment" CHECK (
    "comment" IS NULL OR (char_length("comment") BETWEEN 1 AND 500 AND "pool" = 'REAL')
  ),
  ADD CONSTRAINT "reviews_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  ADD CONSTRAINT "reviews_exclusion" CHECK (
    ("status" = 'HIDDEN') = ("excluded_reason" IS NOT NULL)
    AND ("excluded_reason" IS NULL OR "excluded_reason" IN ('abusive', 'wrong-subject', 'test-or-duplicate', 'other'))
    AND ("excluded_reason" IS DISTINCT FROM 'other' OR "excluded_note" IS NOT NULL)
    AND ("excluded_note" IS NULL OR char_length("excluded_note") BETWEEN 1 AND 500)
  );
CREATE UNIQUE INDEX "reviews_order_id_menu_item_id_key" ON "reviews" ("order_id", "menu_item_id");
CREATE INDEX "reviews_user_id_idx" ON "reviews" ("user_id");

ALTER TABLE "partner_ratings" DROP CONSTRAINT "partner_ratings_user_id_fkey";
ALTER TABLE "partner_ratings"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "edited_at" TIMESTAMP(3),
  ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN "excluded_reason" TEXT,
  ADD COLUMN "excluded_note" TEXT,
  ADD COLUMN "moderated_by" UUID,
  ADD COLUMN "moderated_at" TIMESTAMP(3);
ALTER TABLE "partner_ratings"
  ADD CONSTRAINT "partner_ratings_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "partner_ratings_rating" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "partner_ratings_tags" CHECK (
    cardinality("tags") <= 8 AND "tags" <@ CASE WHEN "rating" >= 4
      THEN ARRAY['friendly', 'on-time', 'careful-with-food', 'followed-instructions']::text[]
      ELSE ARRAY['late', 'food-damaged', 'ignored-instructions', 'unfriendly']::text[]
    END
  ),
  ADD CONSTRAINT "partner_ratings_comment" CHECK (
    "comment" IS NULL OR (char_length("comment") BETWEEN 1 AND 500 AND "pool" = 'REAL')
  ),
  ADD CONSTRAINT "partner_ratings_pool" CHECK ("pool" IN ('REAL', 'DEMO')),
  ADD CONSTRAINT "partner_ratings_exclusion" CHECK (
    ("status" = 'HIDDEN') = ("excluded_reason" IS NOT NULL)
    AND ("excluded_reason" IS NULL OR "excluded_reason" IN ('abusive', 'wrong-subject', 'test-or-duplicate', 'other'))
    AND ("excluded_reason" IS DISTINCT FROM 'other' OR "excluded_note" IS NOT NULL)
    AND ("excluded_note" IS NULL OR char_length("excluded_note") BETWEEN 1 AND 500)
  );
CREATE INDEX "partner_ratings_partner_id_status_created_at_idx"
  ON "partner_ratings" ("partner_id", "status", "created_at");
CREATE INDEX "partner_ratings_user_id_idx" ON "partner_ratings" ("user_id");

-- ---------------------------------------------------------------- E2's rule

-- What each ended delivery owes its courier (contract §1.3). The one place the rule is written
-- in SQL; server/modules/earnings/rules.ts mirrors it and a suite compares the two.
CREATE VIEW ledger_expected_entries WITH (security_barrier = true) AS
WITH d AS (
  SELECT d.id AS delivery_id, d.ended_partner_id AS partner_id, d.status, d.picked_up_at, d.pool,
         d.partner_fee_cents - d.tip_cents AS fee, d.tip_cents AS tip,
         CASE WHEN d.status = 'DELIVERED' THEN coalesce(d.delivered_at, d.ended_at) ELSE d.ended_at END AS occurred_at,
         CASE WHEN o.payment_method = 'CASH' AND d.pool = 'REAL' THEN o.total_cents ELSE 0 END AS cash
  FROM deliveries d
  JOIN orders o ON o.id = d.order_id
  WHERE d.ended_partner_id IS NOT NULL AND d.status IN ('DELIVERED', 'CANCELLED')
)
SELECT delivery_id, partner_id, 'DELIVERY_FEE'::"EarningType" AS type, fee AS amount_cents,
       NULL::text AS reason, pool, occurred_at, 1 AS rank
FROM d WHERE status = 'DELIVERED'
UNION ALL
SELECT delivery_id, partner_id, 'TIP'::"EarningType", tip, NULL, pool, occurred_at, 2
FROM d WHERE status = 'DELIVERED' AND tip > 0
UNION ALL
SELECT delivery_id, partner_id, 'CASH_COLLECTED'::"EarningType", -cash, NULL, pool, occurred_at, 3
FROM d WHERE status = 'DELIVERED' AND cash > 0
UNION ALL
SELECT delivery_id, partner_id, 'DELIVERY_FEE'::"EarningType", fee, 'cancelled-after-pickup', pool, occurred_at, 1
FROM d WHERE status = 'CANCELLED' AND picked_up_at IS NOT NULL;

-- ---------------------------------------------------------------- writing the ledger

-- Appends one entry: locks (or creates) the partner's ledger row first, so every write for one
-- partner is serialized and the version is exact; then the running figures, the cached balance,
-- "owed since" and the day's totals. A duplicate key writes nothing and returns null.
CREATE OR REPLACE FUNCTION app_append_entry(
  p_partner uuid, p_kind "EarningType", p_amount integer, p_delivery uuid, p_reason text,
  p_message text, p_method text, p_reference text, p_paid_on date, p_pool text, p_key text,
  p_at timestamp(3), p_recorded_kind text
) RETURNS partner_earnings
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  l partner_ledgers%ROWTYPE;
  e partner_earnings%ROWTYPE;
  new_balance bigint;
  new_holding bigint;
BEGIN
  INSERT INTO partner_ledgers (partner_id, pool) VALUES (p_partner, p_pool) ON CONFLICT (partner_id) DO NOTHING;
  SELECT * INTO l FROM partner_ledgers WHERE partner_id = p_partner FOR UPDATE;
  new_balance := l.balance_cents + p_amount;
  new_holding := l.holding_cents
    - CASE WHEN p_kind IN ('CASH_COLLECTED', 'CASH_HANDED_IN') THEN p_amount ELSE 0 END;

  INSERT INTO partner_earnings (
    id, partner_id, delivery_id, type, amount_cents, occurred_at, created_at, recorded_kind, reason,
    partner_message, method, reference, paid_on, pool, idempotency_key, version_after,
    balance_after_cents, holding_after_cents
  ) VALUES (
    gen_random_uuid(), p_partner, p_delivery, p_kind, p_amount, p_at, app_now(), p_recorded_kind, p_reason,
    p_message, p_method, p_reference, p_paid_on, p_pool, p_key, l.version + 1, new_balance, new_holding
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO e;
  IF e.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE partner_ledgers
  SET version = l.version + 1, balance_cents = new_balance, holding_cents = new_holding,
      owed_since = CASE
        WHEN new_balance >= 0 THEN NULL
        WHEN l.owed_since IS NULL OR l.balance_cents >= 0 THEN p_at
        ELSE l.owed_since END,
      first_entry_at = least(coalesce(l.first_entry_at, p_at), p_at),
      last_entry_at = greatest(coalesce(l.last_entry_at, p_at), p_at),
      last_payout_entry_id = CASE WHEN p_kind = 'PAYOUT' THEN e.id ELSE l.last_payout_entry_id END,
      updated_at = app_now()
  WHERE partner_id = p_partner;

  INSERT INTO partner_ledger_days AS t (
    partner_id, day, pool, deliveries, delivery_pay_cents, tips_cents, adjustments_cents,
    cash_collected_cents, cash_handed_in_cents, paid_out_cents, net_cents
  ) VALUES (
    p_partner, app_store_date(p_at), p_pool,
    CASE WHEN p_kind = 'DELIVERY_FEE' AND p_reason IS NULL THEN 1 ELSE 0 END,
    CASE WHEN p_kind = 'DELIVERY_FEE' THEN p_amount ELSE 0 END,
    CASE WHEN p_kind = 'TIP' THEN p_amount ELSE 0 END,
    CASE WHEN p_kind IN ('BONUS', 'ADJUSTMENT') THEN p_amount ELSE 0 END,
    CASE WHEN p_kind = 'CASH_COLLECTED' THEN -p_amount ELSE 0 END,
    CASE WHEN p_kind = 'CASH_HANDED_IN' THEN p_amount ELSE 0 END,
    CASE WHEN p_kind = 'PAYOUT' THEN -p_amount ELSE 0 END,
    p_amount
  )
  ON CONFLICT (partner_id, day) DO UPDATE SET
    deliveries = t.deliveries + EXCLUDED.deliveries,
    delivery_pay_cents = t.delivery_pay_cents + EXCLUDED.delivery_pay_cents,
    tips_cents = t.tips_cents + EXCLUDED.tips_cents,
    adjustments_cents = t.adjustments_cents + EXCLUDED.adjustments_cents,
    cash_collected_cents = t.cash_collected_cents + EXCLUDED.cash_collected_cents,
    cash_handed_in_cents = t.cash_handed_in_cents + EXCLUDED.cash_handed_in_cents,
    paid_out_cents = t.paid_out_cents + EXCLUDED.paid_out_cents,
    net_cents = t.net_cents + EXCLUDED.net_cents;
  RETURN e;
END
$$;

-- A delivery's automatic entries, by E2's rule, each at most once.
CREATE OR REPLACE FUNCTION app_write_delivery_entries(target uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  x record;
  e partner_earnings%ROWTYPE;
  written integer := 0;
BEGIN
  FOR x IN SELECT * FROM ledger_expected_entries WHERE delivery_id = target ORDER BY rank LOOP
    e := app_append_entry(x.partner_id, x.type, x.amount_cents, target, x.reason, NULL, NULL, NULL, NULL,
      x.pool, 'delivery:' || target::text || ':' || x.type::text, coalesce(x.occurred_at, app_now()), 'system');
    IF e.id IS NOT NULL THEN
      written := written + 1;
    END IF;
  END LOOP;
  RETURN written;
END
$$;

-- Recomputes a partner's ledger row, running figures and day totals from his entries (seed,
-- backfill). Never granted to the app.
CREATE OR REPLACE FUNCTION app_rebuild_partner_ledger(target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  e record;
  v integer := 0;
  bal bigint := 0;
  hold bigint := 0;
  owed timestamp(3);
  first_at timestamp(3);
  last_at timestamp(3);
  last_payout uuid;
  pool_of text;
BEGIN
  SELECT CASE WHEN u.is_demo THEN 'DEMO' ELSE 'REAL' END INTO pool_of
  FROM delivery_partners p JOIN users u ON u.id = p.user_id WHERE p.id = target;
  IF pool_of IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM partner_ledger_days WHERE partner_id = target;
  FOR e IN SELECT * FROM partner_earnings WHERE partner_id = target ORDER BY occurred_at, version_after, id LOOP
    v := v + 1;
    bal := bal + e.amount_cents;
    hold := hold - CASE WHEN e.type IN ('CASH_COLLECTED', 'CASH_HANDED_IN') THEN e.amount_cents ELSE 0 END;
    owed := CASE WHEN bal >= 0 THEN NULL WHEN owed IS NULL THEN e.occurred_at ELSE owed END;
    first_at := coalesce(first_at, e.occurred_at);
    last_at := e.occurred_at;
    IF e.type = 'PAYOUT' THEN
      last_payout := e.id;
    END IF;
    UPDATE partner_earnings
    SET version_after = v, balance_after_cents = bal, holding_after_cents = hold
    WHERE id = e.id;
    INSERT INTO partner_ledger_days AS t (
      partner_id, day, pool, deliveries, delivery_pay_cents, tips_cents, adjustments_cents,
      cash_collected_cents, cash_handed_in_cents, paid_out_cents, net_cents
    ) VALUES (
      target, app_store_date(e.occurred_at), e.pool,
      CASE WHEN e.type = 'DELIVERY_FEE' AND e.reason IS NULL THEN 1 ELSE 0 END,
      CASE WHEN e.type = 'DELIVERY_FEE' THEN e.amount_cents ELSE 0 END,
      CASE WHEN e.type = 'TIP' THEN e.amount_cents ELSE 0 END,
      CASE WHEN e.type IN ('BONUS', 'ADJUSTMENT') THEN e.amount_cents ELSE 0 END,
      CASE WHEN e.type = 'CASH_COLLECTED' THEN -e.amount_cents ELSE 0 END,
      CASE WHEN e.type = 'CASH_HANDED_IN' THEN e.amount_cents ELSE 0 END,
      CASE WHEN e.type = 'PAYOUT' THEN -e.amount_cents ELSE 0 END,
      e.amount_cents
    )
    ON CONFLICT (partner_id, day) DO UPDATE SET
      deliveries = t.deliveries + EXCLUDED.deliveries,
      delivery_pay_cents = t.delivery_pay_cents + EXCLUDED.delivery_pay_cents,
      tips_cents = t.tips_cents + EXCLUDED.tips_cents,
      adjustments_cents = t.adjustments_cents + EXCLUDED.adjustments_cents,
      cash_collected_cents = t.cash_collected_cents + EXCLUDED.cash_collected_cents,
      cash_handed_in_cents = t.cash_handed_in_cents + EXCLUDED.cash_handed_in_cents,
      paid_out_cents = t.paid_out_cents + EXCLUDED.paid_out_cents,
      net_cents = t.net_cents + EXCLUDED.net_cents;
  END LOOP;
  IF v = 0 THEN
    DELETE FROM partner_ledgers WHERE partner_id = target;
    RETURN;
  END IF;
  INSERT INTO partner_ledgers AS l (partner_id, pool, version, balance_cents, holding_cents, owed_since,
    first_entry_at, last_entry_at, last_payout_entry_id, updated_at)
  VALUES (target, pool_of, v, bal, hold, owed, first_at, last_at, last_payout, app_now())
  ON CONFLICT (partner_id) DO UPDATE SET
    pool = EXCLUDED.pool, version = EXCLUDED.version, balance_cents = EXCLUDED.balance_cents,
    holding_cents = EXCLUDED.holding_cents, owed_since = EXCLUDED.owed_since,
    first_entry_at = EXCLUDED.first_entry_at, last_entry_at = EXCLUDED.last_entry_at,
    last_payout_entry_id = EXCLUDED.last_payout_entry_id, updated_at = EXCLUDED.updated_at;
END
$$;

-- Removes every F9 ledger row of one partner (seed fixtures only). Never granted to the app.
CREATE OR REPLACE FUNCTION app_clear_partner_ledger(target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  DELETE FROM partner_earnings WHERE partner_id = target;
  DELETE FROM partner_ledger_days WHERE partner_id = target;
  DELETE FROM partner_ledgers WHERE partner_id = target;
END
$$;

-- ---------------------------------------------------------------- delivery endings (E2, E3)

-- Stamps who held the delivery when it ended; runs after F7's guard (triggers run by name).
CREATE OR REPLACE FUNCTION deliveries_track_holder() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.status IN ('DELIVERED', 'CANCELLED') AND OLD.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP') THEN
    NEW.ended_partner_id := coalesce(NEW.partner_id, OLD.partner_id);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER deliveries_track_holder
  BEFORE UPDATE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION deliveries_track_holder();

-- However a delivery ends, its courier's entries are written in the same transaction.
CREATE OR REPLACE FUNCTION deliveries_write_earnings() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  PERFORM app_write_delivery_entries(NEW.id);
  RETURN NULL;
END
$$;

CREATE TRIGGER deliveries_write_earnings
  AFTER UPDATE OF "status" ON "deliveries"
  FOR EACH ROW
  WHEN (OLD.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP') AND NEW.status IN ('DELIVERED', 'CANCELLED'))
  EXECUTE FUNCTION deliveries_write_earnings();

-- ---------------------------------------------------------------- staff entries (A60–A62, A67)

CREATE OR REPLACE FUNCTION app_record_staff_entry(
  target uuid, kind text, amount integer, direction text, reason text, message text,
  order_number text, method text, reference text, paid_on date, staff_note text,
  expected_version integer, idem_key text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_user_id();
  who text := app_role();
  partner_demo boolean;
  l partner_ledgers%ROWTYPE;
  prior partner_earnings%ROWTYPE;
  latest record;
  e partner_earnings%ROWTYPE;
  signed integer;
  entry_reason text;
  delivery uuid;
  today date := app_store_date(app_now());
BEGIN
  IF app_is_demo() OR me IS NULL OR NOT (
       (kind = 'CASH_HANDED_IN' AND who IN ('support', 'admin'))
    OR (kind IN ('BONUS', 'ADJUSTMENT', 'PAYOUT') AND who = 'admin')) THEN
    RAISE EXCEPTION 'permission denied: % may not record %', who, kind USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF amount IS NULL OR amount <= 0 OR coalesce(length(idem_key), 0) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'invalid entry' USING ERRCODE = 'check_violation';
  END IF;
  SELECT u.is_demo INTO partner_demo FROM delivery_partners p JOIN users u ON u.id = p.user_id WHERE p.id = target;
  IF NOT FOUND OR partner_demo THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;

  INSERT INTO partner_ledgers (partner_id, pool) VALUES (target, 'REAL') ON CONFLICT (partner_id) DO NOTHING;
  SELECT * INTO l FROM partner_ledgers WHERE partner_id = target FOR UPDATE;

  SELECT * INTO prior FROM partner_earnings WHERE idempotency_key = idem_key;
  IF FOUND THEN
    IF prior.partner_id <> target THEN
      RAISE EXCEPTION 'idempotency key reused' USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('outcome', 'replayed', 'entryId', prior.id, 'kind', prior.type,
      'amountCents', prior.amount_cents, 'version', l.version, 'balanceCents', l.balance_cents,
      'holdingCents', l.holding_cents);
  END IF;

  IF l.version <> expected_version THEN
    SELECT e2.type, e2.amount_cents, e2.reason, e2.occurred_at, o.number AS order_number,
           s.recorded_name, s.recorded_role
      INTO latest
    FROM partner_earnings e2
    LEFT JOIN partner_earning_staff s ON s.earning_id = e2.id
    LEFT JOIN deliveries d ON d.id = e2.delivery_id
    LEFT JOIN orders o ON o.id = d.order_id
    WHERE e2.partner_id = target
    ORDER BY e2.version_after DESC
    LIMIT 1;
    RETURN jsonb_build_object('outcome', 'changed', 'version', l.version, 'balanceCents', l.balance_cents,
      'holdingCents', l.holding_cents,
      'latest', CASE WHEN latest.type IS NULL THEN NULL ELSE jsonb_build_object(
        'kind', latest.type, 'amountCents', latest.amount_cents, 'reason', latest.reason,
        'at', latest.occurred_at, 'orderNumber', latest.order_number, 'byName', latest.recorded_name,
        'byRole', latest.recorded_role) END);
  END IF;

  IF kind = 'CASH_HANDED_IN' THEN
    IF l.holding_cents <= 0 THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'nothing-held',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    IF amount > l.holding_cents THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'holding',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    signed := amount;
  ELSIF kind = 'PAYOUT' THEN
    IF l.balance_cents <= 0 THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'nothing-owed',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    IF amount > l.balance_cents THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'balance',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    IF paid_on IS NULL OR paid_on > today OR paid_on < today - 366 THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'paid-on',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    signed := -amount;
  ELSE
    IF amount > 50000 THEN
      RETURN jsonb_build_object('outcome', 'over-limit', 'which', 'adjust-cap',
        'balanceCents', l.balance_cents, 'holdingCents', l.holding_cents, 'version', l.version);
    END IF;
    IF kind = 'BONUS' THEN
      signed := amount;
      entry_reason := 'bonus';
    ELSE
      IF direction NOT IN ('add', 'take-off') OR reason NOT IN ('cancelled-order-pay', 'correction', 'other') THEN
        RAISE EXCEPTION 'invalid adjustment' USING ERRCODE = 'check_violation';
      END IF;
      signed := CASE WHEN direction = 'take-off' THEN -amount ELSE amount END;
      entry_reason := reason;
    END IF;
    IF order_number IS NOT NULL THEN
      SELECT d.id INTO delivery
      FROM orders o JOIN deliveries d ON d.order_id = o.id
      WHERE o.number = order_number
        AND (d.partner_id = target OR d.ended_partner_id = target
             OR EXISTS (SELECT 1 FROM delivery_offers f WHERE f.delivery_id = d.id
                        AND f.partner_id = target AND f.status = 'ACCEPTED'));
      IF delivery IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not-his-order', 'version', l.version);
      END IF;
    END IF;
  END IF;

  e := app_append_entry(target, kind::"EarningType", signed, delivery, entry_reason,
    CASE WHEN kind IN ('BONUS', 'ADJUSTMENT') THEN message END,
    CASE WHEN kind = 'PAYOUT' THEN method END,
    CASE WHEN kind = 'PAYOUT' THEN nullif(btrim(reference), '') END,
    CASE WHEN kind = 'PAYOUT' THEN paid_on END,
    'REAL', idem_key, app_now(), 'staff');
  INSERT INTO partner_earning_staff (earning_id, recorded_by, recorded_name, recorded_role, staff_note)
  VALUES (e.id, me, coalesce((SELECT name FROM users WHERE id = me), 'Staff member'), who,
    nullif(btrim(staff_note), ''));
  RETURN jsonb_build_object('outcome', 'recorded', 'entryId', e.id, 'kind', e.type,
    'amountCents', e.amount_cents, 'version', e.version_after, 'balanceCents', e.balance_after_cents,
    'holdingCents', e.holding_after_cents);
END
$$;

-- ---------------------------------------------------------------- partner reads and the goal

-- P53: the partner's own goal (whole dollars); the partner row refuses his other writes.
CREATE OR REPLACE FUNCTION app_set_daily_goal(cents integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
BEGIN
  IF me IS NULL OR app_is_demo() THEN
    RAISE EXCEPTION 'permission denied: only a partner sets his goal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE delivery_partners SET daily_goal_cents = cents WHERE id = me AND status = 'APPROVED';
  RETURN FOUND;
END
$$;

-- The facts of deliveries the caller was paid for, and nothing about the customer (P55.2). F7
-- lets a partner read a delivery only while it's active.
CREATE OR REPLACE FUNCTION app_partner_delivery_facts(ids uuid[])
  RETURNS TABLE (
    delivery_id uuid, order_number text, address_city text, distance_km double precision,
    accepted_at timestamp(3), picked_up_at timestamp(3), delivered_at timestamp(3),
    ended_at timestamp(3), status text, handover_how text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT d.id, o.number, o.address_city, o.distance_km,
           coalesce(d.assigned_at, (SELECT max(f.responded_at) FROM delivery_offers f
                                    WHERE f.delivery_id = d.id AND f.status = 'ACCEPTED'
                                      AND f.partner_id = app_partner_id())),
           d.picked_up_at, d.delivered_at, d.ended_at, d.status::text, d.handover_how
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    WHERE d.id = ANY (ids)
      AND app_partner_id() IS NOT NULL
      AND EXISTS (SELECT 1 FROM partner_earnings e WHERE e.delivery_id = d.id AND e.partner_id = app_partner_id())
  $$;

-- ---------------------------------------------------------------- ratings: who may rate (V1)

CREATE OR REPLACE FUNCTION app_rating_open(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = target AND o.user_id = app_user_id() AND o.status <> 'CANCELLED'
        AND o.delivered_at IS NOT NULL AND app_now() <= o.delivered_at + interval '7 days'
    )
  $$;

CREATE OR REPLACE FUNCTION app_order_has_dish(target uuid, item uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = target AND i.menu_item_id = item) $$;

-- The courier a customer may rate: he was at the door, isn't the customer and still has an
-- account (U18, U21, S7.6).
CREATE OR REPLACE FUNCTION app_rateable_courier(target uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT p.id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN delivery_partners p ON p.id = coalesce(d.partner_id, d.ended_partner_id)
    JOIN users u ON u.id = p.user_id
    WHERE d.order_id = target AND d.status = 'DELIVERED'
      AND p.user_id <> o.user_id AND u.deleted_at IS NULL
  $$;

-- ---------------------------------------------------------------- ratings: averages (V3, U17)

-- Recalculated from the rows on every change, under the row lock, on top of the baseline.
CREATE OR REPLACE FUNCTION app_recalc_dish_rating(target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  m record;
  n integer;
  s bigint;
BEGIN
  -- NO KEY UPDATE: a rating's insert holds a key-share lock on the dish through its foreign key,
  -- which this must not wait on (it would deadlock with another rating of the same dish).
  SELECT rating_base_avg, rating_base_count INTO m FROM menu_items WHERE id = target FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), coalesce(sum(rating), 0) INTO n, s
  FROM reviews WHERE menu_item_id = target AND status = 'PUBLISHED' AND pool = 'REAL';
  UPDATE menu_items
  SET rating_count = m.rating_base_count + n,
      rating_avg = CASE WHEN m.rating_base_count + n = 0 THEN 0
        ELSE ((m.rating_base_avg * m.rating_base_count + s) / (m.rating_base_count + n))::double precision END
  WHERE id = target;
END
$$;

CREATE OR REPLACE FUNCTION app_recalc_partner_rating(target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  p record;
  n integer;
  s bigint;
BEGIN
  SELECT dp.rating_base_avg, dp.rating_base_count, CASE WHEN u.is_demo THEN 'DEMO' ELSE 'REAL' END AS pool
    INTO p
  FROM delivery_partners dp JOIN users u ON u.id = dp.user_id
  WHERE dp.id = target
  FOR NO KEY UPDATE OF dp;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), coalesce(sum(rating), 0) INTO n, s
  FROM partner_ratings WHERE partner_id = target AND status = 'PUBLISHED' AND pool = p.pool;
  UPDATE delivery_partners
  SET rating_count = p.rating_base_count + n,
      rating_avg = CASE WHEN p.rating_base_count + n = 0 THEN 0
        ELSE ((p.rating_base_avg * p.rating_base_count + s) / (p.rating_base_count + n))::double precision END
  WHERE id = target;
END
$$;

-- Ratings and their baselines change only through the recalculation above (or the platform).
CREATE OR REPLACE FUNCTION menu_items_guard_rating() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF (NEW.rating_avg, NEW.rating_count, NEW.rating_base_avg, NEW.rating_base_count)
       IS DISTINCT FROM (OLD.rating_avg, OLD.rating_count, OLD.rating_base_avg, OLD.rating_base_count)
    AND app_role() <> 'system'
    AND NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RAISE EXCEPTION 'permission denied: ratings are recalculated, never set' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER menu_items_guard_rating
  BEFORE UPDATE ON "menu_items"
  FOR EACH ROW EXECUTE FUNCTION menu_items_guard_rating();

-- ---------------------------------------------------------------- ratings: skip, privacy (V2, V8, V9)

CREATE OR REPLACE FUNCTION app_skip_rating(target uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = target AND user_id = app_user_id() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not-found');
  END IF;
  IF o.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('outcome', 'cancelled');
  END IF;
  IF o.delivered_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not-delivered');
  END IF;
  IF app_now() > o.delivered_at + interval '7 days' THEN
    RETURN jsonb_build_object('outcome', 'closed', 'deliveredAt', o.delivered_at);
  END IF;
  UPDATE orders SET rating_skipped_at = coalesce(rating_skipped_at, app_now()) WHERE id = target;
  RETURN jsonb_build_object('outcome', 'skipped', 'replayed', o.rating_skipped_at IS NOT NULL);
END
$$;

-- What a partner may know about his ratings: the average and count before `before`, and tag
-- counts only when at least 5 counted ratings fall in [tags_since, before) (U14, lead Q5).
CREATE OR REPLACE FUNCTION app_my_rating_summary(before timestamp(3), tags_since timestamp(3)) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  p record;
  n integer;
  s bigint;
  in_window integer;
  tag_counts jsonb := '[]'::jsonb;
  cut timestamp(3) := least(before, app_now());
BEGIN
  IF me IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT dp.rating_base_avg, dp.rating_base_count, CASE WHEN u.is_demo THEN 'DEMO' ELSE 'REAL' END AS pool
    INTO p
  FROM delivery_partners dp JOIN users u ON u.id = dp.user_id WHERE dp.id = me;
  SELECT count(*), coalesce(sum(rating), 0) INTO n, s
  FROM partner_ratings
  WHERE partner_id = me AND status = 'PUBLISHED' AND pool = p.pool AND created_at < cut;
  SELECT count(*) INTO in_window
  FROM partner_ratings
  WHERE partner_id = me AND status = 'PUBLISHED' AND pool = p.pool
    AND created_at >= tags_since AND created_at < cut;
  IF in_window >= 5 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'count', t.c) ORDER BY t.c DESC, t.tag), '[]'::jsonb)
      INTO tag_counts
    FROM (
      SELECT x.tag, count(*)::int AS c
      FROM partner_ratings r CROSS JOIN LATERAL unnest(r.tags) AS x(tag)
      WHERE r.partner_id = me AND r.status = 'PUBLISHED' AND r.pool = p.pool
        AND r.created_at >= tags_since AND r.created_at < cut
      GROUP BY x.tag
    ) t;
  END IF;
  RETURN jsonb_build_object(
    'count', p.rating_base_count + n,
    'average', CASE WHEN p.rating_base_count + n = 0 THEN NULL
      ELSE ((p.rating_base_avg * p.rating_base_count + s) / (p.rating_base_count + n))::double precision END,
    'tagsShown', in_window >= 5,
    'tags', tag_counts,
    'through', cut);
END
$$;

-- Account deletion (V9.2): the stars stay, unlinked; the comments go.
CREATE OR REPLACE FUNCTION app_unlink_own_ratings() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_user_id();
  a integer;
  b integer;
BEGIN
  IF me IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE reviews SET user_id = NULL, comment = NULL WHERE user_id = me;
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE partner_ratings SET user_id = NULL, comment = NULL WHERE user_id = me;
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN a + b;
END
$$;

-- Account deletion for a partner (U22): refused while his balance isn't zero, under the ledger
-- row lock so a payout can't slip in; once settled his online sessions go (not accounting data).
CREATE OR REPLACE FUNCTION app_settle_own_partner_for_deletion() RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  me uuid := app_partner_id();
  bal bigint;
BEGIN
  IF me IS NULL THEN
    RETURN true;
  END IF;
  SELECT balance_cents INTO bal FROM partner_ledgers WHERE partner_id = me FOR UPDATE;
  IF coalesce(bal, 0) <> 0 THEN
    RETURN false;
  END IF;
  DELETE FROM partner_online_sessions WHERE partner_id = me;
  RETURN true;
END
$$;

-- Customers change their stars, tags and comment inside the window; moderators change only the
-- exclusion, as themselves. Everything else is the platform's.
CREATE OR REPLACE FUNCTION ratings_guard_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  actor text := app_role();
  changed text[];
  customer_cols constant text[] := ARRAY['rating', 'tags', 'comment', 'edited_at'];
  moderator_cols constant text[] := ARRAY['status', 'excluded_reason', 'excluded_note', 'moderated_by', 'moderated_at'];
BEGIN
  IF actor = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(n.key), '{}') INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
  IF cardinality(changed) = 0 THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id = app_user_id() AND actor IN ('customer', 'partner') AND changed <@ customer_cols
    AND app_rating_open(OLD.order_id) THEN
    RETURN NEW;
  END IF;
  IF actor IN ('support', 'admin') AND NOT app_is_demo() AND changed <@ moderator_cols
    AND NEW.moderated_by IS NOT DISTINCT FROM app_user_id() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'permission denied: % may not change %', actor, changed USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER ratings_guard_write
  BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION ratings_guard_write();
CREATE TRIGGER ratings_guard_write
  BEFORE UPDATE ON "partner_ratings"
  FOR EACH ROW EXECUTE FUNCTION ratings_guard_write();

-- ---------------------------------------------------------------- online sessions (E6)

-- Every way of going on or off line opens or closes a session in the same transaction. A
-- partner the server took offline for lost location stops counting 2 minutes after his last
-- accepted point (F6's stale rule).
CREATE OR REPLACE FUNCTION delivery_partners_track_sessions() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF NEW.is_online AND NOT OLD.is_online THEN
    UPDATE partner_online_sessions SET ended_at = greatest(started_at, app_now()), end_reason = 'replaced'
    WHERE partner_id = NEW.id AND ended_at IS NULL;
    INSERT INTO partner_online_sessions (partner_id, started_at, pool)
    VALUES (NEW.id, coalesce(NEW.online_since, app_now()),
      CASE WHEN coalesce((SELECT is_demo FROM users WHERE id = NEW.user_id), false) THEN 'DEMO' ELSE 'REAL' END);
  ELSIF OLD.is_online AND NOT NEW.is_online THEN
    UPDATE partner_online_sessions
    SET ended_at = CASE WHEN NEW.offline_reason = 'no-location'
          THEN least(greatest(started_at, app_now()),
                     greatest(started_at, coalesce(OLD.last_seen_at, started_at) + interval '2 minutes'))
          ELSE greatest(started_at, app_now()) END,
        end_reason = left(coalesce(NEW.offline_reason, 'self'), 40)
    WHERE partner_id = NEW.id AND ended_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER delivery_partners_track_sessions
  AFTER UPDATE OF "is_online" ON "delivery_partners"
  FOR EACH ROW EXECUTE FUNCTION delivery_partners_track_sessions();

-- ---------------------------------------------------------------- B10: never his own order

CREATE OR REPLACE FUNCTION delivery_offers_not_own_order() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN delivery_partners p ON p.id = NEW.partner_id
    WHERE d.id = NEW.delivery_id AND p.user_id = o.user_id
  ) THEN
    RAISE EXCEPTION 'a partner is never offered his own order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER delivery_offers_not_own_order
  BEFORE INSERT ON "delivery_offers"
  FOR EACH ROW EXECUTE FUNCTION delivery_offers_not_own_order();

-- ---------------------------------------------------------------- nightly check and demo reset

-- E7: every mismatch, by id; nothing is fixed.
CREATE OR REPLACE FUNCTION app_reconcile_earnings() RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  deliveries_off jsonb;
  ledgers_off jsonb;
  sessions_off jsonb;
  stuck jsonb;
BEGIN
  IF app_role() <> 'system' THEN
    RAISE EXCEPTION 'permission denied: the reconcile runs as the platform' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(jsonb_agg(DISTINCT id), '[]'::jsonb) INTO deliveries_off FROM (
    SELECT x.delivery_id AS id
    FROM ledger_expected_entries x
    LEFT JOIN partner_earnings e ON e.delivery_id = x.delivery_id AND e.type = x.type AND e.recorded_kind = 'system'
    WHERE e.id IS NULL OR e.amount_cents <> x.amount_cents OR e.partner_id <> x.partner_id
       OR e.reason IS DISTINCT FROM x.reason
    UNION
    SELECT e.delivery_id
    FROM partner_earnings e
    LEFT JOIN ledger_expected_entries x ON x.delivery_id = e.delivery_id AND x.type = e.type
    WHERE e.recorded_kind = 'system' AND x.delivery_id IS NULL
    LIMIT 200
  ) q;

  SELECT coalesce(jsonb_agg(DISTINCT id), '[]'::jsonb) INTO ledgers_off FROM (
    SELECT coalesce(l.partner_id, s.partner_id) AS id
    FROM partner_ledgers l
    FULL JOIN (
      SELECT partner_id, sum(amount_cents) AS bal, count(*) AS n,
             -sum(CASE WHEN type IN ('CASH_COLLECTED', 'CASH_HANDED_IN') THEN amount_cents ELSE 0 END) AS hold
      FROM partner_earnings GROUP BY partner_id
    ) s ON s.partner_id = l.partner_id
    WHERE l.partner_id IS NULL OR s.partner_id IS NULL OR l.balance_cents <> s.bal
       OR l.version <> s.n OR l.holding_cents <> s.hold
    UNION
    SELECT partner_id FROM (
      SELECT partner_id, balance_after_cents,
             sum(amount_cents) OVER (PARTITION BY partner_id ORDER BY version_after) AS running
      FROM partner_earnings
    ) c WHERE balance_after_cents <> running
    UNION
    SELECT coalesce(dd.partner_id, ee.partner_id)
    FROM (SELECT partner_id, sum(net_cents) AS net, sum(deliveries) AS n FROM partner_ledger_days GROUP BY partner_id) dd
    FULL JOIN (
      SELECT partner_id, sum(amount_cents) AS net,
             count(*) FILTER (WHERE type = 'DELIVERY_FEE' AND reason IS NULL) AS n
      FROM partner_earnings GROUP BY partner_id
    ) ee ON ee.partner_id = dd.partner_id
    WHERE dd.partner_id IS NULL OR ee.partner_id IS NULL OR dd.net <> ee.net OR dd.n <> ee.n
    LIMIT 200
  ) q;

  SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO sessions_off FROM (
    SELECT p.id FROM delivery_partners p
    WHERE p.is_online <> EXISTS (SELECT 1 FROM partner_online_sessions s WHERE s.partner_id = p.id AND s.ended_at IS NULL)
    LIMIT 200
  ) q;

  SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO stuck FROM (
    SELECT d.id FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE o.status IN ('DELIVERED', 'CANCELLED') AND d.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')
    LIMIT 200
  ) q;

  RETURN jsonb_build_object('deliveries', deliveries_off, 'ledgers', ledgers_off,
    'sessions', sessions_off, 'stuckDeliveries', stuck);
END
$$;

-- The nightly demo reset's database part (U20, lead Q7): demo ratings and ledger rows, finished
-- demo sessions, then the demo orders under them. Real rows are never touched.
CREATE OR REPLACE FUNCTION app_reset_demo_f9() RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  entries integer;
  ratings integer;
  dish_ratings integer;
  orders_gone integer := 0;
  dishes uuid[];
BEGIN
  IF app_role() <> 'system' THEN
    RAISE EXCEPTION 'permission denied: the demo reset runs as the platform' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM partner_earnings WHERE pool = 'DEMO';
  GET DIAGNOSTICS entries = ROW_COUNT;
  DELETE FROM partner_ledger_days WHERE pool = 'DEMO';
  DELETE FROM partner_ledgers WHERE pool = 'DEMO';
  SELECT coalesce(array_agg(DISTINCT menu_item_id), '{}') INTO dishes FROM reviews WHERE pool = 'DEMO';
  DELETE FROM reviews WHERE pool = 'DEMO';
  GET DIAGNOSTICS dish_ratings = ROW_COUNT;
  DELETE FROM partner_ratings WHERE pool = 'DEMO';
  GET DIAGNOSTICS ratings = ROW_COUNT;
  DELETE FROM partner_online_sessions
  WHERE pool = 'DEMO' AND ended_at IS NOT NULL AND ended_at < app_store_day_start(app_store_date(app_now()));
  PERFORM app_recalc_partner_rating(p.id)
  FROM delivery_partners p JOIN users u ON u.id = p.user_id WHERE u.is_demo;
  PERFORM app_recalc_dish_rating(x) FROM unnest(dishes) AS x;
  BEGIN
    DELETE FROM demo_runs WHERE status <> 'running' OR ends_at < app_now() - interval '1 hour';
    DELETE FROM orders o USING users u
    WHERE u.id = o.user_id AND u.is_demo
      AND o.status IN ('DELIVERED', 'CANCELLED', 'FAILED')
      AND o.updated_at < app_now() - interval '1 hour';
    GET DIAGNOSTICS orders_gone = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    orders_gone := -1;
  END;
  RETURN jsonb_build_object('entries', entries, 'ratings', ratings + dish_ratings, 'orders', orders_gone);
END
$$;

-- ---------------------------------------------------------------- row-level security (E9, V9)

-- The request's settings are read once per query (scalar subqueries become init plans), so a
-- report over a year of day rows doesn't look the caller up again for every row (A63.6).

DROP POLICY partner_earnings_access ON "partner_earnings";
CREATE POLICY partner_earnings_read ON "partner_earnings" FOR SELECT
  USING (
    (SELECT app_role()) = 'system'
    OR partner_id = (SELECT app_partner_id())
    OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo()) AND pool = 'REAL')
    OR ((SELECT app_role()) = 'admin' AND (SELECT app_is_demo()) AND pool = 'DEMO')
  );

ALTER TABLE "partner_earning_staff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_earning_staff_read ON "partner_earning_staff" FOR SELECT
  USING ((SELECT app_role()) = 'system' OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo())));

ALTER TABLE "partner_ledgers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_ledgers_read ON "partner_ledgers" FOR SELECT
  USING (
    (SELECT app_role()) = 'system'
    OR partner_id = (SELECT app_partner_id())
    OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo()) AND pool = 'REAL')
    OR ((SELECT app_role()) = 'admin' AND (SELECT app_is_demo()) AND pool = 'DEMO')
  );

ALTER TABLE "partner_ledger_days" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_ledger_days_read ON "partner_ledger_days" FOR SELECT
  USING (
    (SELECT app_role()) = 'system'
    OR partner_id = (SELECT app_partner_id())
    OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo()) AND pool = 'REAL')
    OR ((SELECT app_role()) = 'admin' AND (SELECT app_is_demo()) AND pool = 'DEMO')
  );

ALTER TABLE "partner_online_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_online_sessions_read ON "partner_online_sessions" FOR SELECT
  USING ((SELECT app_role()) = 'system' OR partner_id = (SELECT app_partner_id()));

ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON "reviews" FOR SELECT
  USING (
    (SELECT app_role()) = 'system'
    OR (user_id IS NOT NULL AND user_id = (SELECT app_user_id()))
    OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo()) AND pool = 'REAL')
    OR ((SELECT app_role()) = 'admin' AND (SELECT app_is_demo()) AND pool = 'DEMO')
  );
CREATE POLICY reviews_insert ON "reviews" FOR INSERT
  WITH CHECK (
    app_role() = 'system' OR (
      user_id = app_user_id() AND app_role() IN ('customer', 'partner')
      AND pool = CASE WHEN app_is_demo() THEN 'DEMO' ELSE 'REAL' END
      AND status = 'PUBLISHED' AND excluded_reason IS NULL AND moderated_by IS NULL
      AND app_rating_open(order_id) AND app_order_has_dish(order_id, menu_item_id)
    )
  );
CREATE POLICY reviews_update ON "reviews" FOR UPDATE
  USING (
    app_role() = 'system' OR user_id = app_user_id()
    OR (app_role() IN ('support', 'admin') AND NOT app_is_demo() AND pool = 'REAL')
  )
  WITH CHECK (
    app_role() = 'system' OR user_id = app_user_id()
    OR (app_role() IN ('support', 'admin') AND NOT app_is_demo() AND pool = 'REAL')
  );

ALTER TABLE "partner_ratings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_ratings_read ON "partner_ratings" FOR SELECT
  USING (
    (SELECT app_role()) = 'system'
    OR (user_id IS NOT NULL AND user_id = (SELECT app_user_id()))
    OR ((SELECT app_role()) IN ('support', 'admin') AND NOT (SELECT app_is_demo()) AND pool = 'REAL')
    OR ((SELECT app_role()) = 'admin' AND (SELECT app_is_demo()) AND pool = 'DEMO')
  );
CREATE POLICY partner_ratings_insert ON "partner_ratings" FOR INSERT
  WITH CHECK (
    app_role() = 'system' OR (
      user_id = app_user_id() AND app_role() IN ('customer', 'partner')
      AND pool = CASE WHEN app_is_demo() THEN 'DEMO' ELSE 'REAL' END
      AND status = 'PUBLISHED' AND excluded_reason IS NULL AND moderated_by IS NULL
      AND app_rating_open(order_id) AND partner_id = app_rateable_courier(order_id)
    )
  );
CREATE POLICY partner_ratings_update ON "partner_ratings" FOR UPDATE
  USING (
    app_role() = 'system' OR user_id = app_user_id()
    OR (app_role() IN ('support', 'admin') AND NOT app_is_demo() AND pool = 'REAL')
  )
  WITH CHECK (
    app_role() = 'system' OR user_id = app_user_id()
    OR (app_role() IN ('support', 'admin') AND NOT app_is_demo() AND pool = 'REAL')
  );

-- ---------------------------------------------------------------- grants (three roles)

REVOKE ALL ON FUNCTION app_store_zone(), app_append_entry(uuid, "EarningType", integer, uuid, text, text, text, text, date, text, text, timestamp(3), text),
  app_write_delivery_entries(uuid), app_rebuild_partner_ledger(uuid), app_clear_partner_ledger(uuid),
  app_record_staff_entry(uuid, text, integer, text, text, text, text, text, text, date, text, integer, text),
  app_set_daily_goal(integer), app_partner_delivery_facts(uuid[]), app_rating_open(uuid),
  app_order_has_dish(uuid, uuid), app_rateable_courier(uuid), app_recalc_dish_rating(uuid),
  app_recalc_partner_rating(uuid), app_skip_rating(uuid), app_my_rating_summary(timestamp(3), timestamp(3)),
  app_unlink_own_ratings(), app_reconcile_earnings(), app_reset_demo_f9(),
  app_store_date(timestamp(3)), app_store_day_start(date), app_settle_own_partner_for_deletion()
  FROM PUBLIC;
REVOKE ALL ON ledger_expected_entries FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_store_zone(), app_store_date(timestamp(3)), app_store_day_start(date),
      app_record_staff_entry(uuid, text, integer, text, text, text, text, text, text, date, text, integer, text),
      app_set_daily_goal(integer), app_partner_delivery_facts(uuid[]), app_rating_open(uuid),
      app_order_has_dish(uuid, uuid), app_rateable_courier(uuid), app_recalc_dish_rating(uuid),
      app_recalc_partner_rating(uuid), app_skip_rating(uuid),
      app_my_rating_summary(timestamp(3), timestamp(3)), app_unlink_own_ratings(),
      app_reconcile_earnings(), app_reset_demo_f9(), app_settle_own_partner_for_deletion()
      TO foodz_app;
    -- The ledger is append-only and written only by the definer functions (E1.1).
    REVOKE ALL ON "partner_earnings", "partner_earning_staff", "partner_ledgers", "partner_ledger_days",
      "partner_online_sessions", ledger_expected_entries FROM foodz_app;
    GRANT SELECT ON "partner_earnings", "partner_earning_staff", "partner_ledgers", "partner_ledger_days",
      "partner_online_sessions" TO foodz_app;
    -- Ratings are changed, never deleted (S5.3).
    REVOKE DELETE, TRUNCATE ON "reviews", "partner_ratings" FROM foodz_app;
    GRANT SELECT, INSERT, UPDATE ON "reviews", "partner_ratings" TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    -- Money, comments and working hours stay out of the analytics role until F16 curates views.
    REVOKE ALL ON "partner_earnings", "partner_earning_staff", "partner_ledgers", "partner_ledger_days",
      "partner_online_sessions", "reviews", "partner_ratings", ledger_expected_entries FROM foodz_readonly;
  END IF;
END
$$;

-- ---------------------------------------------------------------- backfill (E8, U17)

-- Today's seeded figures become the baselines real ratings add to.
UPDATE "menu_items" SET rating_base_avg = round(rating_avg::numeric, 2), rating_base_count = rating_count;
UPDATE "delivery_partners" SET rating_base_avg = round(rating_avg::numeric, 2), rating_base_count = rating_count;

-- Who held each delivery that already ended, then its entries, once.
UPDATE "deliveries" d
SET ended_partner_id = coalesce(d.partner_id, (
  SELECT f.partner_id FROM delivery_offers f
  WHERE f.delivery_id = d.id AND f.status = 'ACCEPTED'
  ORDER BY f.responded_at DESC NULLS LAST
  LIMIT 1))
WHERE d.status IN ('DELIVERED', 'CANCELLED') AND d.ended_partner_id IS NULL;

DO $$
DECLARE
  x record;
BEGIN
  FOR x IN SELECT id FROM deliveries
           WHERE status IN ('DELIVERED', 'CANCELLED') AND ended_partner_id IS NOT NULL
           ORDER BY coalesce(delivered_at, ended_at, updated_at), id LOOP
    PERFORM app_write_delivery_entries(x.id);
  END LOOP;
END
$$;

-- Partners online now start their session now.
INSERT INTO "partner_online_sessions" (partner_id, started_at, pool)
SELECT p.id, coalesce(p.online_since, app_now()), CASE WHEN u.is_demo THEN 'DEMO' ELSE 'REAL' END
FROM delivery_partners p JOIN users u ON u.id = p.user_id
WHERE p.is_online;
