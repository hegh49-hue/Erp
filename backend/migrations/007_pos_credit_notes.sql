-- Sales returns (credit notes): reuses pos_invoices/pos_invoice_lines so returns
-- appear in the same invoice log the spec asks for, distinguished by doc_type.
ALTER TABLE pos_invoices ADD COLUMN doc_type text NOT NULL DEFAULT 'sale' CHECK (doc_type IN ('sale', 'credit_note'));
ALTER TABLE pos_invoices ADD COLUMN original_invoice_id uuid REFERENCES pos_invoices(id);
CREATE INDEX idx_pos_invoices_original ON pos_invoices(original_invoice_id);
CREATE SEQUENCE pos_credit_note_seq START 1;
