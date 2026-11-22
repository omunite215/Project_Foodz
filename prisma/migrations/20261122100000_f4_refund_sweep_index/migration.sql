-- The refund sweep (every 5 minutes) looks for card payments Foodz decided to give back that
-- aren't refunded yet. Only a handful of orders are ever in that state, so a partial index keeps
-- the sweep from reading the whole table. Prisma can't describe a partial index, so it lives
-- only here.
CREATE INDEX "orders_unsettled_refunds_idx" ON "orders" ("updated_at" DESC)
  WHERE "auto_refund_reason" IS NOT NULL
    AND "payment_status" IN ('PAID', 'PARTIALLY_REFUNDED')
    AND "stripe_payment_intent_id" IS NOT NULL;
