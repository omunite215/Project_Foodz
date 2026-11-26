-- F8 design review S7 (the backend gate's S7, for dispatch): a phone that keeps sending one fix
-- stops counting as fresh for offers 2 minutes after it last moved, as the stored point does
-- (`pointClocks`). `last_point_at` is what dispatch, the assign list and the staff lines read;
-- `last_seen_at` moving still proves the phone is alive (the unseen count resets as before).
ALTER TABLE "delivery_partners" ADD COLUMN "last_moved_at" TIMESTAMP(3);
UPDATE "delivery_partners" SET "last_moved_at" = "last_point_at" WHERE "is_online";

CREATE OR REPLACE FUNCTION delivery_partners_track_online() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
BEGIN
  IF NEW.is_online AND NOT OLD.is_online THEN
    NEW.waiting_since := app_now();
    NEW.last_point_at := app_now();
    NEW.last_moved_at := app_now();
    NEW.missed_in_row := 0;
    NEW.unseen_in_row := 0;
  ELSIF OLD.is_online AND NOT NEW.is_online THEN
    NEW.last_point_at := NULL;
    NEW.last_moved_at := NULL;
    NEW.missed_in_row := 0;
    NEW.unseen_in_row := 0;
  ELSIF NEW.is_online AND NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    IF OLD.last_moved_at IS NULL
      OR NEW.last_location::text IS DISTINCT FROM OLD.last_location::text THEN
      NEW.last_moved_at := app_now();
      NEW.last_point_at := app_now();
    ELSE
      -- The same coordinates again: fresh for at most 2 minutes after the last move, never back.
      NEW.last_moved_at := OLD.last_moved_at;
      NEW.last_point_at := GREATEST(
        coalesce(OLD.last_point_at, OLD.last_moved_at),
        LEAST(app_now(), OLD.last_moved_at + interval '2 minutes')
      );
    END IF;
    NEW.unseen_in_row := 0;
  END IF;
  RETURN NEW;
END
$$;
