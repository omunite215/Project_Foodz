-- Store credit always belongs to someone. The coupons read policy treats a code without an owner
-- as public, so an ownerless store-credit code would be readable by every visitor.
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_store_credit_owner" CHECK (NOT "is_store_credit" OR "owner_user_id" IS NOT NULL);
