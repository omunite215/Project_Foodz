-- F4: checkout, orders and card payments.
--   * order numbers from a sequence (1001, 1002, ...); the seed's sample order keeps S1001
--   * order columns the story's B3 lists: the address and courier instructions as they were,
--     the free-delivery discount apart from the fee, the tax rate, the tip choice, the code as
--     applied, the card label, the dispute state, the checkout attempt key, the cart fingerprint
--     for the duplicate check, the arrival window and the reason for an automatic refund
--   * a random tag for this database, carried by every PaymentIntent (B6)
--   * row-level security: only the platform (checkout, webhooks, jobs) creates orders and their
--     lines, events and code uses; customers read their own; demo staff read real people's
--     orders only through order_directory, masked (F2 U4)
--   * account deletion anonymises the caller's own orders through one narrow function

-- ---------------------------------------------------------------- order numbers

CREATE SEQUENCE "order_number_seq" START WITH 1001;

ALTER TABLE "orders" ALTER COLUMN "number" SET DEFAULT (nextval('order_number_seq'::regclass))::text;

-- ---------------------------------------------------------------- columns

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('NONE', 'OPEN', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "address_city" TEXT,
ADD COLUMN     "address_label" TEXT,
ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "arrival_from_minutes" INTEGER,
ADD COLUMN     "arrival_to_minutes" INTEGER,
ADD COLUMN     "attempt_key" TEXT,
ADD COLUMN     "auto_refund_reason" TEXT,
ADD COLUMN     "card_brand" TEXT,
ADD COLUMN     "card_last4" TEXT,
ADD COLUMN     "cart_fingerprint" TEXT,
ADD COLUMN     "courier_instructions" TEXT,
ADD COLUMN     "delivery_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispute_closed_at" TIMESTAMP(3),
ADD COLUMN     "dispute_opened_at" TIMESTAMP(3),
ADD COLUMN     "dispute_status" "DisputeStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "promo_code" TEXT,
ADD COLUMN     "stripe_payment_method_id" TEXT,
ADD COLUMN     "tax_rate_bps" INTEGER,
ADD COLUMN     "tip_choice" TEXT NOT NULL DEFAULT 'none';

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_money_non_negative" CHECK (
    "subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "delivery_fee_cents" >= 0
    AND "delivery_discount_cents" >= 0 AND "tax_cents" >= 0 AND "tip_cents" >= 0
    AND "total_cents" >= 0 AND "refunded_cents" >= 0
  ),
  ADD CONSTRAINT "orders_tip_limit" CHECK ("tip_cents" <= 10000),
  ADD CONSTRAINT "orders_tip_choice" CHECK ("tip_choice" IN ('none', '10', '15', '20', 'amount')),
  ADD CONSTRAINT "orders_card_last4" CHECK ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "orders_cancel_reason" CHECK (
    "cancel_reason" IS NULL OR "cancel_reason" IN ('customer', 'payment-expired', 'account-deleted')
  ),
  ADD CONSTRAINT "orders_auto_refund_reason" CHECK (
    "auto_refund_reason" IS NULL OR "auto_refund_reason" IN ('customer-cancel', 'late-payment', 'mismatch')
  ),
  ADD CONSTRAINT "orders_note_length" CHECK ("note" IS NULL OR char_length("note") <= 200),
  ADD CONSTRAINT "orders_arrival_window" CHECK (
    ("arrival_from_minutes" IS NULL) = ("arrival_to_minutes" IS NULL)
    AND ("arrival_from_minutes" IS NULL OR ("arrival_from_minutes" >= 0 AND "arrival_to_minutes" > "arrival_from_minutes"))
  );

-- ---------------------------------------------------------------- indexes

-- One live order per checkout press and customer. A new attempt with the key of a failed or
-- cancelled order takes the key over (the service clears it from the old one first).
CREATE UNIQUE INDEX "orders_user_id_attempt_key_key" ON "orders"("user_id", "attempt_key");

-- The orders list pages by (created_at, id), newest first.
DROP INDEX "orders_user_id_created_at_idx";
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX "orders_user_id_cart_fingerprint_idx" ON "orders"("user_id", "cart_fingerprint");

-- The sweep for unpaid orders whose expiry job was lost.
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- ---------------------------------------------------------------- this database's tag

CREATE TABLE "app_instance" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "tag" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_instance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "app_instance" ADD CONSTRAINT "app_instance_single_row" CHECK ("id" = 1);

INSERT INTO "app_instance" ("id") VALUES (1);

-- ---------------------------------------------------------------- row-level security

-- Items, events and deliveries follow their order. Demo staff see only demo and sample people's
-- orders here; real people's come through order_directory, masked.
CREATE OR REPLACE FUNCTION app_can_see_order(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = target
        AND (
          o.user_id = app_user_id()
          OR (app_is_operations() AND (NOT app_is_demo() OR app_shown_to_demo(o.user_id)))
        )
    )
    OR app_partner_delivers(target)
  $$;

DROP POLICY orders_access ON "orders";

CREATE POLICY orders_read ON "orders" FOR SELECT
  USING (
    user_id = app_user_id()
    OR app_partner_delivers(id)
    OR (app_is_operations() AND (NOT app_is_demo() OR app_shown_to_demo(user_id)))
  );

-- Checkout runs as the platform: it prices the order itself and reserves codes, which only the
-- platform may count. Nobody else creates orders.
CREATE POLICY orders_insert ON "orders" FOR INSERT
  WITH CHECK (app_role() = 'system');

-- Payments, expiry and cancellation run as the platform; the kitchen (F5) as operations staff.
-- Orders are never deleted: they are kept for accounting.
CREATE POLICY orders_update ON "orders" FOR UPDATE
  USING (app_role() = 'system' OR (app_is_operations() AND NOT app_is_demo()))
  WITH CHECK (app_role() = 'system' OR (app_is_operations() AND NOT app_is_demo()));

-- Lines are a price snapshot: written once by checkout, never changed.
DROP POLICY order_items_access ON "order_items";

CREATE POLICY order_items_read ON "order_items" FOR SELECT
  USING (app_can_see_order(order_id));

CREATE POLICY order_items_insert ON "order_items" FOR INSERT
  WITH CHECK (app_role() = 'system');

-- The timeline is append-only.
DROP POLICY order_events_access ON "order_events";

CREATE POLICY order_events_read ON "order_events" FOR SELECT
  USING (app_can_see_order(order_id));

CREATE POLICY order_events_insert ON "order_events" FOR INSERT
  WITH CHECK (
    app_role() = 'system'
    OR (app_is_operations() AND NOT app_is_demo() AND app_can_see_order(order_id))
  );

-- Code uses are held, used and released by the platform only, in the same transaction that
-- counts them on the coupon.
DROP POLICY coupon_redemptions_access ON "coupon_redemptions";

CREATE POLICY coupon_redemptions_read ON "coupon_redemptions" FOR SELECT
  USING (
    user_id = app_user_id()
    OR (app_is_support() AND (NOT app_is_demo() OR app_shown_to_demo(user_id)))
  );

CREATE POLICY coupon_redemptions_insert ON "coupon_redemptions" FOR INSERT
  WITH CHECK (app_role() = 'system');

CREATE POLICY coupon_redemptions_update ON "coupon_redemptions" FOR UPDATE
  USING (app_role() = 'system')
  WITH CHECK (app_role() = 'system');

-- ---------------------------------------------------------------- account deletion

-- Deleting an account keeps its orders for accounting without the person's details (F2 B10).
-- Customers can't update orders, so this does it for the caller's own orders only.
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

-- ---------------------------------------------------------------- masked view for staff reads

-- Owned by the migrator, so it reads orders without the demo restriction above and applies its
-- own row filter. A demo staff login sees a real person's contact and address masked.
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
  o.tip_cents,
  o.total_cents,
  o.refunded_cents,
  o.promo_code,
  o.card_brand,
  o.card_last4,
  o.dispute_status,
  o.arrival_from_minutes,
  o.arrival_to_minutes,
  o.placed_at,
  o.cancelled_at,
  o.cancel_reason,
  o.created_at,
  m.masked
FROM orders o
CROSS JOIN LATERAL (SELECT app_masks_owner(o.user_id) AS masked) m
WHERE app_is_operations() OR o.user_id = app_user_id();

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION app_anonymize_own_orders() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE "order_number_seq" TO foodz_app;
    GRANT EXECUTE ON FUNCTION app_anonymize_own_orders() TO foodz_app;
    REVOKE ALL ON order_directory FROM foodz_app;
    GRANT SELECT ON order_directory TO foodz_app;
    -- The tag is made here and never changes.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "app_instance" FROM foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT SELECT ON order_directory TO foodz_readonly;
  END IF;
END
$$;
