-- F9 design review P12: the partner's delivery sheet needs to know whether the order had a tip,
-- so a cancellation after pickup says "the tip went back to the customer" only when there was
-- one. `app_partner_delivery_facts` gains the delivery's frozen tip (`deliveries.tip_cents`, the
-- offer's figure). A function's result columns can't change in place, so it's dropped and made
-- again, with the same body, rules and grants.

DROP FUNCTION IF EXISTS app_partner_delivery_facts(uuid[]);

CREATE FUNCTION app_partner_delivery_facts(ids uuid[])
  RETURNS TABLE (
    delivery_id uuid, order_number text, address_city text, distance_km double precision,
    accepted_at timestamp(3), picked_up_at timestamp(3), delivered_at timestamp(3),
    ended_at timestamp(3), status text, handover_how text, tip_cents integer
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT d.id, o.number, o.address_city, o.distance_km,
           coalesce(d.assigned_at, (SELECT max(f.responded_at) FROM delivery_offers f
                                    WHERE f.delivery_id = d.id AND f.status = 'ACCEPTED'
                                      AND f.partner_id = app_partner_id())),
           d.picked_up_at, d.delivered_at, d.ended_at, d.status::text, d.handover_how, d.tip_cents
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    WHERE d.id = ANY (ids)
      AND app_partner_id() IS NOT NULL
      AND EXISTS (SELECT 1 FROM partner_earnings e WHERE e.delivery_id = d.id AND e.partner_id = app_partner_id())
  $$;

REVOKE ALL ON FUNCTION app_partner_delivery_facts(uuid[]) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foodz_app') THEN
    GRANT EXECUTE ON FUNCTION app_partner_delivery_facts(uuid[]) TO foodz_app;
  END IF;
END
$$;
