-- Redesigned shift closing: the cashier enters expense/purchase line items directly at
-- closing time (no pre-approval gate), plus a bank-transfer collections amount. The
-- accountant's later classification (real expense/purchase account, or charged to a
-- supervisor's advances account) never blocks the close and never changes the frozen
-- closing figures already saved on cashier_shifts.
ALTER TABLE cashier_shifts ADD COLUMN transfers_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE cashier_shifts ADD COLUMN expense_items jsonb NOT NULL DEFAULT '[]';

ALTER TABLE cash_disbursements ADD COLUMN shift_id uuid REFERENCES cashier_shifts(id);
ALTER TABLE cash_disbursements ADD COLUMN item_type text NOT NULL DEFAULT 'expense' CHECK (item_type IN ('expense', 'purchase'));
ALTER TABLE cash_disbursements ADD COLUMN supervisor_entity_id uuid REFERENCES subledger_entities(id);
ALTER TABLE cash_disbursements DROP CONSTRAINT cash_disbursements_status_check;
ALTER TABLE cash_disbursements ADD CONSTRAINT cash_disbursements_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'awaiting_classification', 'classified'));
