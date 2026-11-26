-- F9 (contract §13): the ledger's three new kinds. A value added to an enum can't be used in
-- the transaction that adds it, so the rest of F9 follows in the next migration.
ALTER TYPE "EarningType" ADD VALUE IF NOT EXISTS 'CASH_COLLECTED';
ALTER TYPE "EarningType" ADD VALUE IF NOT EXISTS 'CASH_HANDED_IN';
ALTER TYPE "EarningType" ADD VALUE IF NOT EXISTS 'PAYOUT';
