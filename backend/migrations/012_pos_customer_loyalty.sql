-- Links an invoice to a customer (subledger entity under 1100) for credit sales and
-- loyalty point tracking. Customers themselves need no new table — see extra jsonb
-- on subledger_entities, same pattern already used for channels/warehouses.
ALTER TABLE pos_invoices ADD COLUMN customer_id uuid REFERENCES subledger_entities(id);
ALTER TABLE pos_invoices ADD COLUMN loyalty_points_earned int NOT NULL DEFAULT 0;
ALTER TABLE pos_invoices ADD COLUMN loyalty_points_redeemed int NOT NULL DEFAULT 0;
ALTER TABLE pos_invoices ADD COLUMN loyalty_discount numeric(18,2) NOT NULL DEFAULT 0;
