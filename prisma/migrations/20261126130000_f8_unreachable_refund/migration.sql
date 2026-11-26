-- F8 U6: "Cancel and bring it back" refunds a card payment in full. The cancellation now
-- decides the refund the way F5's staff cancellation does (`auto_refund_reason = 'staff-cancel'`
-- for a card payment Stripe still holds money for), so the refund job and its sweep pick it up,
-- and the timeline says the cancellation email already announced the refund (no second email).
CREATE OR REPLACE FUNCTION app_staff_cancel_unreachable(target uuid, expected_version integer, note text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
  refundable boolean;
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
  refundable := o.payment_method = 'CARD'
    AND o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
    AND o.stripe_payment_intent_id IS NOT NULL
    AND o.total_cents > o.refunded_cents;
  UPDATE deliveries
  SET status = 'CANCELLED', no_answer_since = NULL, version = d.version + 1, updated_at = app_now()
  WHERE id = d.id;
  IF d.partner_id IS NOT NULL THEN
    UPDATE delivery_partners SET waiting_since = app_now() WHERE id = d.partner_id;
  END IF;
  UPDATE orders
  SET status = 'CANCELLED', cancelled_at = app_now(), cancel_reason = 'staff',
      cancel_code = 'customer-unreachable',
      auto_refund_reason = CASE WHEN refundable THEN 'staff-cancel' ELSE auto_refund_reason END,
      version = o.version + 1, updated_at = app_now()
  WHERE id = o.id;
  INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'cancelled', 'PICKED_UP', 'CANCELLED', app_user_id(),
    jsonb_build_object('actor', 'staff', 'reason', 'customer-unreachable', 'note', note,
      'refundAnnounced', refundable),
    app_now());
  RETURN jsonb_build_object('outcome', 'cancelled', 'deliveryId', d.id, 'orderId', o.id, 'orderNumber', o.number,
    'partnerId', d.partner_id, 'version', d.version + 1, 'paidByCard', refundable);
END
$$;
