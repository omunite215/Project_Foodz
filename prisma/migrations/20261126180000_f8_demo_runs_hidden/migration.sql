-- F8 acceptance (A54.2, L10.4): a demo run's order never reaches real staff. Real SUPPORT, ADMIN
-- and KITCHEN read orders through order_directory (the board, its cards, Find and the detail), so
-- the view leaves demo runs to the demo admin, the platform and the order's own customer (Dana).
-- demo_runs itself is readable only by demo staff, so the check is a definer function.

CREATE OR REPLACE FUNCTION app_is_demo_run_order(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM demo_runs r WHERE r.order_id = target) $$;

REVOKE ALL ON FUNCTION app_is_demo_run_order(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_is_demo_run_order(uuid) TO foodz_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT EXECUTE ON FUNCTION app_is_demo_run_order(uuid) TO foodz_readonly;
  END IF;
END
$$;

CREATE OR REPLACE VIEW order_directory WITH (security_barrier = true) AS
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
WHERE (app_is_operations() AND (app_role() = 'system' OR app_is_demo() OR NOT app_is_demo_run_order(o.id)))
  OR o.user_id = app_user_id();
