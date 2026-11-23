-- F3: promo codes in the cart.
--   * row-level security on coupons: a personal or store-credit code (owner_user_id set) is
--     visible only to its owner and to support and admin, so the database itself answers "not
--     found" to everyone else (story B7). Public codes stay readable by every visitor.
--   * codes are stored in the form the cart normalises to (capitals, digits, hyphens)
--   * the store's tax rate defaults to 7 % (U1); the seed corrects the seeded row

-- ---------------------------------------------------------------- coupon codes

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,31}$');

-- ---------------------------------------------------------------- row-level security

ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;

-- Demo staff never see real people's personal codes (U4), only demo and sample people's.
CREATE POLICY coupons_read ON "coupons" FOR SELECT
  USING (
    owner_user_id IS NULL
    OR owner_user_id = app_user_id()
    OR (app_is_support() AND (NOT app_is_demo() OR app_shown_to_demo(owner_user_id)))
  );

-- Codes are issued by support (store credit, F10), admin (F12) and background jobs.
CREATE POLICY coupons_insert ON "coupons" FOR INSERT
  WITH CHECK (app_is_support() AND NOT app_is_demo());

-- Only staff and background jobs change a code. Customers never do, not even their own store
-- credit: checkout (F4) counts uses as the system actor.
CREATE POLICY coupons_update ON "coupons" FOR UPDATE
  USING (app_is_support() AND NOT app_is_demo())
  WITH CHECK (app_is_support() AND NOT app_is_demo());

CREATE POLICY coupons_delete ON "coupons" FOR DELETE
  USING (app_role() IN ('admin', 'system') AND NOT app_is_demo());

-- ---------------------------------------------------------------- store settings

ALTER TABLE "site_settings" ALTER COLUMN "tax_rate_bps" SET DEFAULT 700;
