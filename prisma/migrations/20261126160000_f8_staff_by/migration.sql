-- F8 design review S10: the staff steps of A50 (ask to wait, confirm a hand-over, cancel and
-- bring it back) name the person on the timeline, as every other staff action does (design
-- 3.13). The events carry F5's `by` snapshot ({name, role}); order_event_directory still hides a
-- real staff member's name from the demo admin.

CREATE OR REPLACE FUNCTION app_staff_by() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
  SELECT CASE WHEN app_role() IN ('kitchen', 'support', 'admin') THEN (
    SELECT jsonb_build_object('name', left(coalesce(u.name, 'Staff member'), 120), 'role', app_role())
    FROM users u WHERE u.id = app_user_id()
  ) END
$$;

REVOKE ALL ON FUNCTION app_staff_by() FROM PUBLIC;

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
    jsonb_build_object('partnerId', d.partner_id, 'by', app_staff_by()), app_now());
  RETURN jsonb_build_object('outcome', 'waiting', 'deliveryId', d.id, 'orderId', d.order_id,
    'partnerId', d.partner_id, 'since', app_now(), 'version', d.version + 1);
END
$$;

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
  -- The support wait is the story's 5 minutes whatever the caller passes (the parameter stays
  -- for the signature only).
  wait_seconds := 300;
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
    jsonb_build_object('actor', 'staff', 'by', app_staff_by(), 'reason', reason, 'cashCollectedCents', CASE WHEN cash > 0 THEN cash END,
      'note', note),
    app_now());
  INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
  VALUES (gen_random_uuid(), o.id, 'handover-confirmed', app_user_id(),
    jsonb_build_object('partnerId', d.partner_id, 'reason', reason, 'by', app_staff_by()), app_now());
  RETURN jsonb_build_object('outcome', 'delivered', 'deliveryId', d.id, 'orderId', o.id, 'orderNumber', o.number,
    'partnerId', d.partner_id, 'payCents', d.partner_fee_cents, 'tipCents', d.tip_cents, 'cashCents', cash,
    'version', d.version + 1, 'how', CASE WHEN stuck THEN 'staff-confirmed' ELSE 'admin-override' END);
END
$$;

CREATE OR REPLACE FUNCTION app_staff_cancel_unreachable(target uuid, expected_version integer, note text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  d deliveries%ROWTYPE;
  o orders%ROWTYPE;
  refundable boolean;
  stuck boolean;
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
  -- Support cancels only a delivery that is stuck: the code locked, a problem reported, or no
  -- answer for the full 5 minutes (as for a confirmed hand-over); admin may always.
  stuck := d.otp_locked_at IS NOT NULL OR d.problem_kind IS NOT NULL
    OR (d.no_answer_since IS NOT NULL AND app_now() >= d.no_answer_since + interval '300 seconds');
  IF app_role() = 'support' AND NOT stuck THEN
    RETURN jsonb_build_object('outcome', 'not-stuck');
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
    jsonb_build_object('actor', 'staff', 'by', app_staff_by(), 'reason', 'customer-unreachable', 'note', note,
      'refundAnnounced', refundable),
    app_now());
  RETURN jsonb_build_object('outcome', 'cancelled', 'deliveryId', d.id, 'orderId', o.id, 'orderNumber', o.number,
    'partnerId', d.partner_id, 'version', d.version + 1, 'paidByCard', refundable);
END
$$;
