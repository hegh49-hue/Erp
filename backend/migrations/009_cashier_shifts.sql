-- Till reconciliation: a cashier opens a shift with a starting cash float, sells during
-- the shift, then closes it by entering the physically counted cash. Expected cash is
-- computed from actual cash-only pos_invoices in the shift window (see routes/shifts.js),
-- not from the general ledger, since account 1000 also carries card/transfer payments.
CREATE TABLE cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id uuid NOT NULL REFERENCES subledger_entities(id),
  business_date date NOT NULL,
  opening_float numeric(18,2) NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  counted_amount numeric(18,2),
  expected_amount numeric(18,2),
  variance numeric(18,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_one_open_shift_per_cashier ON cashier_shifts(cashier_id) WHERE status = 'open';
CREATE INDEX idx_cashier_shifts_cashier ON cashier_shifts(cashier_id);
