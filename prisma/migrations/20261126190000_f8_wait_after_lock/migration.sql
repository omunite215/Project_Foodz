-- F8 acceptance (A50.1, design 3.10): after a code lock, support may also ask the courier to wait
-- 5 more minutes, not only after "isn't answering". The wait starts then, as it does after a
-- no-answer report.

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
  IF d.version <> expected_version OR d.status <> 'PICKED_UP'
    OR (d.no_answer_since IS NULL AND d.otp_locked_at IS NULL) THEN
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
