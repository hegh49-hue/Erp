-- An invoice made up entirely of service items has no warehouse to deduct stock from.
ALTER TABLE pos_invoices ALTER COLUMN warehouse_id DROP NOT NULL;
