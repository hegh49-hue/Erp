CREATE TABLE cash_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id uuid NOT NULL REFERENCES subledger_entities(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  receipt_attachment text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  expense_account_id uuid REFERENCES accounts(id),
  rejection_reason text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  requested_by uuid REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE INDEX idx_cash_disbursements_cashier ON cash_disbursements(cashier_id);
CREATE INDEX idx_cash_disbursements_status ON cash_disbursements(status);
