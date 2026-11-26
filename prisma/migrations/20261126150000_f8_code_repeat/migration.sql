-- F8 frontend gate S8 (docs/features/F8/security-fe.md): a phone that re-sends the same typed
-- code after a slow answer or a server error must not use up the courier's five tries. The same
-- wrong code again within 10 seconds is answered with the current count and not counted; it
-- tells nothing new about the code, so the lock still comes at the fifth different wrong try.
-- The last wrong try's hash lives with the code (read only by the platform and the order's
-- customer, deleted with the code when the delivery ends).

ALTER TABLE "delivery_codes"
  ADD COLUMN "last_wrong_hash" TEXT,
  ADD COLUMN "last_wrong_at" TIMESTAMP(3),
  ADD CONSTRAINT "delivery_codes_last_wrong_hash"
    CHECK ("last_wrong_hash" IS NULL OR "last_wrong_hash" ~ '^[0-9a-f]{64}$');

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
  last_hash text;
  last_at timestamp(3);
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
  SELECT c.code_hash, c.last_wrong_hash, c.last_wrong_at INTO stored, last_hash, last_at
  FROM delivery_codes c WHERE c.delivery_id = d.id;
  IF stored IS NULL OR typed_hash IS NULL OR typed_hash <> stored THEN
    -- A re-send of the same wrong code: the same answer, nothing counted.
    IF typed_hash IS NOT NULL AND last_hash = typed_hash
       AND last_at IS NOT NULL AND last_at > app_now() - interval '10 seconds' THEN
      RETURN jsonb_build_object('outcome', 'wrong', 'triesLeft', 5 - d.otp_wrong_tries, 'repeat', true);
    END IF;
    tries := d.otp_wrong_tries + 1;
    UPDATE deliveries
    SET otp_wrong_tries = tries,
        otp_locked_at = CASE WHEN tries >= 5 THEN app_now() ELSE NULL END,
        version = d.version + 1, updated_at = app_now()
    WHERE id = d.id;
    UPDATE delivery_codes
    SET last_wrong_hash = typed_hash, last_wrong_at = app_now()
    WHERE delivery_id = d.id AND typed_hash ~ '^[0-9a-f]{64}$';
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
