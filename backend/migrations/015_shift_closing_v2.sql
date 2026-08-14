-- Full till reconciliation: denomination-counted cash, manual network terminal
-- amount reconciled against system-recorded card sales, and approved cash
-- disbursements during the shift auto-deducted from expected cash.
ALTER TABLE cashier_shifts ADD COLUMN denominations jsonb;
ALTER TABLE cashier_shifts ADD COLUMN network_counted numeric(18,2);
ALTER TABLE cashier_shifts ADD COLUMN network_expected numeric(18,2);
ALTER TABLE cashier_shifts ADD COLUMN network_variance numeric(18,2);
ALTER TABLE cashier_shifts ADD COLUMN disbursements_total numeric(18,2) NOT NULL DEFAULT 0;
