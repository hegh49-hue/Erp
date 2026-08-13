-- Three roles: admin (everything), accountant (accounting + reports only),
-- cashier (POS + their own shift only, via cashier_entity_id linking them to
-- the cashbox analytical element they operate).
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'accountant', 'cashier'));
ALTER TABLE users ADD COLUMN cashier_entity_id uuid REFERENCES subledger_entities(id);
