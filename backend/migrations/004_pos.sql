-- POS module, re-pointed at the real items/warehouses catalog instead of an in-memory qty field.
CREATE TABLE pos_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text UNIQUE NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  warehouse_id uuid NOT NULL REFERENCES subledger_entities(id),
  cashier_id uuid NOT NULL REFERENCES subledger_entities(id),
  order_type text NOT NULL DEFAULT 'محلي',
  order_source text NOT NULL DEFAULT 'محلي',
  pay_method_label text NOT NULL,
  pay_account_id uuid NOT NULL REFERENCES accounts(id),
  pay_entity_id uuid REFERENCES subledger_entities(id),
  subtotal numeric(18,2) NOT NULL,
  vat numeric(18,2) NOT NULL,
  total numeric(18,2) NOT NULL,
  cogs_total numeric(18,2) NOT NULL DEFAULT 0,
  qr_base64 text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  cogs_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pos_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES pos_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price numeric(18,2) NOT NULL,
  taxable boolean NOT NULL DEFAULT true,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0
);

CREATE SEQUENCE pos_invoice_seq START 1;
