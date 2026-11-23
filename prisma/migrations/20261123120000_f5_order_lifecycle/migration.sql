-- F5: the order lifecycle, the staff order board and "86 it".
--   * each kitchen step's time, the longest prep of the dishes as ordered (for ready-by), the
--     version at which the status last changed (the board's conflict check), staff
--     cancellation codes and the dishes they name, and which customer notices went out
--   * when and by whom a dish was marked sold out; when a staff session last passed a step-up
--     code
--   * a guard on orders: operations staff may change only the status, its step times and the
--     cancellation, along their role's transitions (settles F4 security S9 b)
--   * a guard on menu_items: the kitchen may only mark dishes sold out or back on
--   * code release for staff cancellations, which run as the staff member
--   * staff read orders, lines and timelines through masked views (settles F4 security S9 a);
--     account anonymisation is refused while an order is in progress (F4 security S9 c)

-- ---------------------------------------------------------------- columns

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "cancel_code" TEXT,
ADD COLUMN     "cancel_line_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "notified_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "picked_up_at" TIMESTAMP(3),
ADD COLUMN     "prep_minutes" INTEGER,
ADD COLUMN     "preparing_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "status_changed_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "sold_out_at" TIMESTAMP(3),
ADD COLUMN     "sold_out_by" UUID;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "step_up_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_sold_out_by_fkey" FOREIGN KEY ("sold_out_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lists are never null, whatever writes them.
UPDATE "orders" SET "cancel_line_ids" = ARRAY[]::UUID[] WHERE "cancel_line_ids" IS NULL;
UPDATE "orders" SET "notified_steps" = ARRAY[]::TEXT[] WHERE "notified_steps" IS NULL;
ALTER TABLE "orders" ALTER COLUMN "cancel_line_ids" SET NOT NULL,
  ALTER COLUMN "notified_steps" SET NOT NULL;

-- ---------------------------------------------------------------- rules

ALTER TABLE "orders" DROP CONSTRAINT "orders_cancel_reason",
  ADD CONSTRAINT "orders_cancel_reason" CHECK (
    "cancel_reason" IS NULL
    OR "cancel_reason" IN ('customer', 'payment-expired', 'account-deleted', 'staff', 'kitchen-refused')
  );

ALTER TABLE "orders" DROP CONSTRAINT "orders_auto_refund_reason",
  ADD CONSTRAINT "orders_auto_refund_reason" CHECK (
    "auto_refund_reason" IS NULL
    OR "auto_refund_reason" IN ('customer-cancel', 'late-payment', 'mismatch', 'staff-cancel')
  );

-- A staff cancellation always says why, with one of the board's reasons; the kitchen refuses
-- only with its own four. Nothing else carries a code.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancel_code" CHECK (
    ("cancel_code" IS NOT NULL) = ("cancel_reason" IS NOT NULL AND "cancel_reason" IN ('staff', 'kitchen-refused'))
    AND (
      "cancel_code" IS NULL
      OR "cancel_code" IN ('customer-asked', 'dish-unavailable', 'too-busy', 'closing', 'cant-deliver', 'fraud', 'other')
    )
    AND (
      "cancel_reason" IS DISTINCT FROM 'kitchen-refused'
      OR "cancel_code" IN ('dish-unavailable', 'too-busy', 'closing', 'other')
    )
  ),
  ADD CONSTRAINT "orders_cancel_line_ids" CHECK (cardinality("cancel_line_ids") <= 25),
  ADD CONSTRAINT "orders_notified_steps" CHECK (
    "notified_steps" <@ ARRAY['accepted', 'ready', 'picked-up', 'delivered', 'cancelled']::TEXT[]
  ),
  ADD CONSTRAINT "orders_prep_minutes" CHECK ("prep_minutes" IS NULL OR "prep_minutes" BETWEEN 1 AND 240);

-- ---------------------------------------------------------------- backfill

-- Ready-by for orders placed before F5: the longest prep of their dishes as they are now.
UPDATE "orders" o
SET "prep_minutes" = sub.minutes
FROM (
  SELECT oi.order_id, LEAST(240, GREATEST(1, max(mi.prep_minutes))) AS minutes
  FROM "order_items" oi
  JOIN "menu_items" mi ON mi.id = oi.menu_item_id
  GROUP BY oi.order_id
) sub
WHERE o.id = sub.order_id;

UPDATE "orders" SET "status_changed_version" = "version";

-- ---------------------------------------------------------------- indexes

-- The board reads only orders in progress, oldest first. Prisma can't describe a partial index,
-- so it lives only here.
CREATE INDEX "orders_board_idx" ON "orders" ("status", "placed_at")
  WHERE "status" IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP');

-- ---------------------------------------------------------------- the status's version

-- Every status change bumps the version (if the statement didn't) and records it, so the board
-- can tell a status change from a money change (a refund, a dispute) since a person looked.
-- F4's writes are covered without touching F4's code. Nothing else sets the column.
CREATE OR REPLACE FUNCTION orders_track_status() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_version := NEW.version;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    END IF;
    NEW.status_changed_version := NEW.version;
  ELSE
    NEW.status_changed_version := OLD.status_changed_version;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER orders_track_status
  BEFORE INSERT OR UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_track_status();

-- ---------------------------------------------------------------- ready-by snapshot

-- The longest prep of an order's dishes when its lines are written (checkout and the seed
-- alike). Runs as its owner: customers and staff never update orders for this.
CREATE OR REPLACE FUNCTION order_items_snapshot_prep() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  UPDATE orders o
  SET prep_minutes = sub.minutes
  FROM (
    SELECT n.order_id, LEAST(240, GREATEST(1, max(mi.prep_minutes))) AS minutes
    FROM inserted_items n
    JOIN menu_items mi ON mi.id = n.menu_item_id
    GROUP BY n.order_id
  ) sub
  WHERE o.id = sub.order_id
    AND (o.prep_minutes IS NULL OR o.prep_minutes < sub.minutes);
  RETURN NULL;
END
$$;

CREATE TRIGGER order_items_snapshot_prep
  AFTER INSERT ON "order_items"
  REFERENCING NEW TABLE AS inserted_items
  FOR EACH STATEMENT EXECUTE FUNCTION order_items_snapshot_prep();

-- ---------------------------------------------------------------- what staff may change

-- orders_update lets non-demo operations staff update orders (F4). This narrows it: staff may
-- change only the status, its step times and the cancellation, and only along their role's
-- transitions (server/modules/board/state.ts keeps the same table). Money stays the platform's,
-- except a cash order marked delivered by an admin turning PAID. The table owner and the
-- platform ('system') pass.
CREATE OR REPLACE FUNCTION orders_guard_staff_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  actor text := app_role();
  move text := OLD.status::text || '>' || NEW.status::text;
  free constant text[] := ARRAY[
    'status', 'accepted_at', 'preparing_at', 'ready_at', 'picked_up_at', 'delivered_at',
    'cancelled_at', 'cancel_reason', 'cancel_code', 'cancel_line_ids', 'auto_refund_reason',
    'payment_status', 'version', 'status_changed_version', 'updated_at'
  ];
  bookkeeping constant text[] := ARRAY['version', 'status_changed_version', 'updated_at'];
BEGIN
  IF actor = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN NEW;
  END IF;
  IF actor NOT IN ('kitchen', 'support', 'admin') OR app_is_demo() THEN
    RAISE EXCEPTION 'permission denied: % may not change orders', actor
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RAISE EXCEPTION 'permission denied: staff change only an order''s status and its step times'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = OLD.status THEN
    IF (to_jsonb(NEW) - bookkeeping) IS DISTINCT FROM (to_jsonb(OLD) - bookkeeping) THEN
      RAISE EXCEPTION 'permission denied: staff change an order only by changing its status'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (actor = 'kitchen' AND move IN (
      'PLACED>ACCEPTED', 'ACCEPTED>PREPARING', 'PREPARING>READY',
      'ACCEPTED>PLACED', 'PREPARING>ACCEPTED', 'READY>PREPARING',
      'PLACED>CANCELLED'))
    OR (actor = 'support' AND move IN (
      'PLACED>CANCELLED', 'ACCEPTED>CANCELLED', 'PREPARING>CANCELLED', 'READY>CANCELLED'))
    OR (actor = 'admin' AND move IN (
      'PLACED>ACCEPTED', 'ACCEPTED>PREPARING', 'PREPARING>READY', 'READY>PICKED_UP',
      'PICKED_UP>DELIVERED', 'ACCEPTED>PLACED', 'PREPARING>ACCEPTED', 'READY>PREPARING',
      'PICKED_UP>READY', 'PLACED>CANCELLED', 'ACCEPTED>CANCELLED', 'PREPARING>CANCELLED',
      'READY>CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'permission denied: % may not move an order from % to %', actor, OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'CANCELLED' THEN
    -- The kitchen refuses; support and admin cancel. Only a staff-cancel refund may be decided.
    IF NEW.cancel_reason IS DISTINCT FROM (CASE WHEN actor = 'kitchen' THEN 'kitchen-refused' ELSE 'staff' END) THEN
      RAISE EXCEPTION 'permission denied: a staff cancellation is recorded as the role''s own'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.auto_refund_reason IS DISTINCT FROM OLD.auto_refund_reason
      AND NEW.auto_refund_reason IS DISTINCT FROM 'staff-cancel' THEN
      RAISE EXCEPTION 'permission denied: staff decide only a staff-cancel refund'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
    OR NEW.cancel_code IS DISTINCT FROM OLD.cancel_code
    OR NEW.cancel_line_ids IS DISTINCT FROM OLD.cancel_line_ids
    OR NEW.auto_refund_reason IS DISTINCT FROM OLD.auto_refund_reason THEN
    RAISE EXCEPTION 'permission denied: cancellation fields change only with a cancellation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NOT (
    actor = 'admin' AND NEW.status = 'DELIVERED' AND OLD.payment_method = 'CASH'
    AND OLD.payment_status = 'UNPAID' AND NEW.payment_status = 'PAID'
  ) THEN
    RAISE EXCEPTION 'permission denied: staff mark only collected cash as paid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at AND NEW.status <> 'DELIVERED' THEN
    RAISE EXCEPTION 'permission denied: the delivery time is set by marking an order delivered'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER orders_guard_staff_write
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_guard_staff_write();

-- ---------------------------------------------------------------- what may change a dish

-- menu_items has no row-level security (the catalog is public), so writes are limited here.
-- Admins and content editors edit the menu; the kitchen may only mark a dish sold out or back
-- on ("86 it"); demo logins and everyone else change nothing. The search vector is generated
-- from the compared columns.
CREATE OR REPLACE FUNCTION menu_items_guard_write() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
DECLARE
  actor text := app_role();
  free constant text[] := ARRAY['is_available', 'sold_out_at', 'sold_out_by', 'updated_at', 'search_vector'];
BEGIN
  IF actor = 'system'
    OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT app_is_demo() THEN
    IF actor IN ('admin', 'content_editor') THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF actor = 'kitchen' AND TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - free) IS NOT DISTINCT FROM (to_jsonb(OLD) - free) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'permission denied: % may not change the menu', actor
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER menu_items_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON "menu_items"
  FOR EACH ROW EXECUTE FUNCTION menu_items_guard_write();

-- ---------------------------------------------------------------- code release

-- Code uses are written by the platform only (F4). A staff cancellation runs as the staff
-- member, so it gives the code back through this: operations staff (not demo) or the platform,
-- for a cancelled order only, once. Returns the code given back, or null when there was none.
CREATE OR REPLACE FUNCTION app_release_order_code(target uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  released uuid;
BEGIN
  IF NOT app_is_operations() OR app_is_demo() THEN
    RAISE EXCEPTION 'permission denied: only operations staff release codes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = target AND status = 'CANCELLED') THEN
    RAISE EXCEPTION 'a code is released only for a cancelled order'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE coupon_redemptions
  SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP
  WHERE order_id = target AND status <> 'RELEASED'
  RETURNING coupon_id INTO released;
  IF released IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE coupons
  SET used_count = used_count - 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = released AND used_count > 0;
  RETURN (SELECT code FROM coupons WHERE id = released);
END
$$;

-- ---------------------------------------------------------------- account deletion

-- F4 security S9 c: the deletion flow never calls this while an order is in progress, and now
-- the database refuses it too.
CREATE OR REPLACE FUNCTION app_anonymize_own_orders() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  target uuid := app_user_id();
  changed integer;
BEGIN
  IF target IS NULL OR app_is_demo() THEN
    RETURN 0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM orders
    WHERE user_id = target
      AND status IN ('PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP')
  ) THEN
    RAISE EXCEPTION 'orders in progress can''t be anonymised'
      USING ERRCODE = 'object_in_use';
  END IF;
  UPDATE orders
  SET contact_name = 'Deleted customer',
      contact_phone = '',
      address_text = 'Address removed',
      address_label = NULL,
      address_line1 = NULL,
      address_line2 = NULL,
      address_city = NULL,
      courier_instructions = NULL,
      note = NULL,
      -- Coordinates kept only to about 1 km, for delivery statistics.
      address_lat = round(address_lat::numeric, 2),
      address_lng = round(address_lng::numeric, 2),
      location = NULL,
      attempt_key = NULL,
      cart_fingerprint = NULL,
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE user_id = target;
  GET DIAGNOSTICS changed = ROW_COUNT;
  UPDATE order_items SET note = NULL
  WHERE order_id IN (SELECT id FROM orders WHERE user_id = target);
  RETURN changed;
END
$$;

-- ---------------------------------------------------------------- masked views for staff reads

-- Owned by the migrator, so they read orders without the demo restriction and apply their own
-- row filter. A demo staff login sees a real person's contact, address, notes, own promo code
-- (personal or store credit) and card digits masked; dishes and amounts never are.
DROP VIEW order_directory;

CREATE VIEW order_directory WITH (security_barrier = true) AS
SELECT
  o.id,
  o.number,
  o.user_id,
  o.status,
  o.payment_method,
  o.payment_status,
  CASE WHEN m.masked THEN mask_name(o.contact_name) ELSE o.contact_name END AS contact_name,
  CASE WHEN m.masked THEN mask_phone(o.contact_phone) ELSE o.contact_phone END AS contact_phone,
  CASE WHEN m.masked THEN mask_text(o.address_text) ELSE o.address_text END AS address_text,
  CASE WHEN m.masked THEN mask_text(o.address_label) ELSE o.address_label END AS address_label,
  CASE WHEN m.masked THEN mask_text(o.address_line1) ELSE o.address_line1 END AS address_line1,
  CASE WHEN m.masked THEN mask_text(o.address_line2) ELSE o.address_line2 END AS address_line2,
  CASE WHEN m.masked THEN mask_text(o.address_city) ELSE o.address_city END AS address_city,
  CASE WHEN m.masked THEN mask_text(o.courier_instructions) ELSE o.courier_instructions END AS courier_instructions,
  CASE WHEN m.masked THEN mask_text(o.note) ELSE o.note END AS note,
  CASE WHEN m.masked THEN round(o.address_lat::numeric, 2)::double precision ELSE o.address_lat END AS address_lat,
  CASE WHEN m.masked THEN round(o.address_lng::numeric, 2)::double precision ELSE o.address_lng END AS address_lng,
  o.distance_km,
  o.subtotal_cents,
  o.discount_cents,
  o.delivery_fee_cents,
  o.delivery_discount_cents,
  o.tax_cents,
  o.tax_rate_bps,
  o.tip_cents,
  o.tip_choice,
  o.total_cents,
  o.refunded_cents,
  CASE
    WHEN m.masked AND o.promo_code IS NOT NULL AND (c.id IS NULL OR c.owner_user_id IS NOT NULL) THEN NULL
    ELSE o.promo_code
  END AS promo_code,
  o.card_brand,
  CASE WHEN m.masked THEN NULL ELSE o.card_last4 END AS card_last4,
  o.dispute_status,
  o.dispute_opened_at,
  o.dispute_closed_at,
  o.arrival_from_minutes,
  o.arrival_to_minutes,
  o.auto_refund_reason,
  (o.stripe_payment_intent_id IS NOT NULL) AS has_payment_intent,
  o.expires_at,
  o.placed_at,
  o.accepted_at,
  o.preparing_at,
  o.ready_at,
  o.picked_up_at,
  o.delivered_at,
  o.cancelled_at,
  o.cancel_reason,
  o.cancel_code,
  o.cancel_line_ids,
  o.prep_minutes,
  o.version,
  o.status_changed_version,
  o.created_at,
  o.updated_at,
  m.masked
FROM orders o
LEFT JOIN coupons c ON c.id = o.coupon_id
CROSS JOIN LATERAL (SELECT app_masks_owner(o.user_id) AS masked) m
WHERE app_is_operations() OR o.user_id = app_user_id();

-- An order's lines for staff. The demo admin can't read a real customer's order_items, yet sees
-- the dishes (they aren't personal); only a line's note is masked.
CREATE VIEW order_item_directory WITH (security_barrier = true) AS
SELECT
  i.id,
  i.order_id,
  i.menu_item_id,
  i.title,
  i.unit_price_cents,
  i.quantity,
  i.flavors,
  CASE WHEN m.masked THEN mask_text(i.note) ELSE i.note END AS note,
  m.masked
FROM order_items i
JOIN orders o ON o.id = i.order_id
CROSS JOIN LATERAL (SELECT app_masks_owner(o.user_id) AS masked) m
WHERE app_is_operations() OR o.user_id = app_user_id();

-- An order's timeline for staff. A real customer's order loses its staff notes for the demo
-- admin, and the demo admin never reads the name of a real (not demo or sample) staff member.
CREATE VIEW order_event_directory WITH (security_barrier = true) AS
SELECT
  e.id,
  e.order_id,
  e.type,
  e.from_status,
  e.to_status,
  e.actor_id,
  CASE
    WHEN jsonb_typeof(d.base) = 'object' AND app_is_demo() AND d.base ? 'by'
      AND NOT app_shown_to_demo(e.actor_id)
      THEN jsonb_set(d.base, '{by,name}', 'null'::jsonb, false)
    ELSE d.base
  END AS data,
  e.created_at,
  m.masked
FROM order_events e
JOIN orders o ON o.id = e.order_id
CROSS JOIN LATERAL (SELECT app_masks_owner(o.user_id) AS masked) m
CROSS JOIN LATERAL (
  SELECT CASE WHEN m.masked AND jsonb_typeof(e.data) = 'object' THEN e.data - 'note' ELSE e.data END AS base
) d
WHERE app_is_operations() OR o.user_id = app_user_id();

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app_release_order_code(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_release_order_code(uuid) TO foodz_app;
    REVOKE ALL ON order_directory, order_item_directory, order_event_directory FROM foodz_app;
    GRANT SELECT ON order_directory, order_item_directory, order_event_directory TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    REVOKE ALL ON order_item_directory, order_event_directory FROM foodz_readonly;
    GRANT SELECT ON order_directory TO foodz_readonly;
  END IF;
END
$$;
