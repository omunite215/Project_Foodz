-- Access control: role grants and row-level security.
--
-- The application connects as foodz_app, which does not own any table, so the policies below
-- apply to every query it makes. Each request runs inside a transaction that sets:
--   app.user_id  the signed-in user's id (empty for anonymous requests)
--   app.role     customer | partner | kitchen | support | content_editor | admin | system
-- "system" is used only by webhooks and background jobs.

-- ---------------------------------------------------------------- grants

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT USAGE ON SCHEMA public TO foodz_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO foodz_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO foodz_app;
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foodz_app',
      current_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO foodz_app',
      current_user
    );
    -- append-only tables
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM foodz_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "webhook_events" FROM foodz_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "delivery_locations" FROM foodz_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_readonly') THEN
    GRANT USAGE ON SCHEMA public TO foodz_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO foodz_readonly;
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO foodz_readonly',
      current_user
    );
    -- secrets never leave the auth tables through the analytics role
    REVOKE SELECT ON "accounts", "sessions", "verifications", "two_factors" FROM foodz_readonly;
  END IF;
END
$$;

-- ---------------------------------------------------------------- request context helpers

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;

CREATE OR REPLACE FUNCTION app_is_support() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_role() IN ('admin', 'support', 'system') $$;

CREATE OR REPLACE FUNCTION app_is_operations() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_role() IN ('admin', 'support', 'kitchen', 'system') $$;

-- The functions below read across tables that have their own policies. They run with the
-- privileges of their owner (the migrator role, which owns the tables and is therefore not
-- subject to RLS) so the policies do not recurse into each other.

CREATE OR REPLACE FUNCTION app_partner_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM delivery_partners WHERE user_id = app_user_id() $$;

CREATE OR REPLACE FUNCTION app_partner_delivers(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.order_id = target
        AND d.partner_id IS NOT NULL
        AND d.partner_id = app_partner_id()
    )
  $$;

CREATE OR REPLACE FUNCTION app_can_see_order(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_is_operations()
      OR EXISTS (SELECT 1 FROM orders o WHERE o.id = target AND o.user_id = app_user_id())
      OR EXISTS (
        SELECT 1 FROM deliveries d
        WHERE d.order_id = target
          AND d.partner_id IS NOT NULL
          AND d.partner_id = app_partner_id()
      )
  $$;

CREATE OR REPLACE FUNCTION app_can_see_delivery(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (SELECT 1 FROM deliveries d WHERE d.id = target AND app_can_see_order(d.order_id))
  $$;

REVOKE ALL ON FUNCTION app_partner_id(), app_partner_delivers(uuid), app_can_see_order(uuid),
  app_can_see_delivery(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_user_id(), app_role(), app_is_support(), app_is_operations(),
      app_partner_id(), app_partner_delivers(uuid), app_can_see_order(uuid),
      app_can_see_delivery(uuid) TO foodz_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------- row-level security

-- Ownership is checked on the row itself (not through a subquery) so that INSERT ... RETURNING
-- can see the row it just created.
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_access ON "orders"
  USING (user_id = app_user_id() OR app_is_operations() OR app_partner_delivers(id))
  WITH CHECK (user_id = app_user_id() OR app_is_operations());

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_access ON "order_items"
  USING (app_can_see_order(order_id))
  WITH CHECK (app_can_see_order(order_id));

ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_events_access ON "order_events"
  USING (app_can_see_order(order_id))
  WITH CHECK (app_can_see_order(order_id));

ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deliveries_access ON "deliveries"
  USING (app_can_see_order(order_id))
  WITH CHECK (app_is_operations() OR partner_id = app_partner_id());

ALTER TABLE "delivery_offers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_offers_access ON "delivery_offers"
  USING (partner_id = app_partner_id() OR app_is_operations())
  WITH CHECK (partner_id = app_partner_id() OR app_is_operations());

ALTER TABLE "delivery_locations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_locations_access ON "delivery_locations"
  USING (app_can_see_delivery(delivery_id))
  WITH CHECK (
    app_role() = 'system'
    OR EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_id AND d.partner_id = app_partner_id()
    )
  );

ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY addresses_access ON "addresses"
  USING (user_id = app_user_id() OR app_is_support())
  WITH CHECK (user_id = app_user_id() OR app_is_support());

ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorites_access ON "favorites"
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_access ON "notifications"
  USING (user_id = app_user_id() OR app_is_support())
  WITH CHECK (user_id = app_user_id() OR app_is_support());

ALTER TABLE "coupon_redemptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY coupon_redemptions_access ON "coupon_redemptions"
  USING (user_id = app_user_id() OR app_is_support())
  WITH CHECK (user_id = app_user_id() OR app_is_support());

ALTER TABLE "refund_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY refund_requests_access ON "refund_requests"
  USING (user_id = app_user_id() OR app_is_support())
  WITH CHECK (user_id = app_user_id() OR app_is_support());

ALTER TABLE "partner_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_reports_access ON "partner_reports"
  USING (reporter_id = app_user_id() OR app_is_support())
  WITH CHECK (reporter_id = app_user_id() OR app_is_support());

ALTER TABLE "partner_earnings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_earnings_access ON "partner_earnings"
  USING (partner_id = app_partner_id() OR app_is_support())
  WITH CHECK (app_is_support());

ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY uploads_access ON "uploads"
  USING (
    owner_id = app_user_id()
    OR app_is_support()
    OR (bucket = 'PUBLIC' AND app_role() IN ('content_editor', 'kitchen'))
  )
  WITH CHECK (owner_id = app_user_id() OR app_role() = 'system');
