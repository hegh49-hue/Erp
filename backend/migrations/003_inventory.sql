-- Inventory module (roadmap #1): multi-warehouse stock, transfers, physical counts, BOM recipes.
-- Warehouses are modelled as subledger_entities under the 1200 "المخزون" control account —
-- this reuses the same analytical-element engine already built for accounting (section 3),
-- so "sum of warehouse balances == inventory control account balance" is enforced for free.

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'عام',
  item_type text NOT NULL DEFAULT 'finished' CHECK (item_type IN ('raw','semi_finished','finished','packaging','consumable')),
  unit text NOT NULL DEFAULT 'قطعة',
  price numeric(18,2) NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  is_sellable boolean NOT NULL DEFAULT true,
  is_stock_tracked boolean NOT NULL DEFAULT true,
  reorder_point numeric(18,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES subledger_entities(id) ON DELETE RESTRICT,
  qty numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (item_id, warehouse_id)
);

CREATE TABLE stock_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES subledger_entities(id) ON DELETE RESTRICT,
  move_type text NOT NULL CHECK (move_type IN ('receipt','issue','transfer_out','transfer_in','adjustment_in','adjustment_out','count_adjustment')),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  ref_type text NOT NULL DEFAULT 'manual',
  ref_id uuid,
  move_date date NOT NULL,
  note text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_moves_item_wh ON stock_moves(item_id, warehouse_id);
CREATE INDEX idx_stock_moves_ref ON stock_moves(ref_type, ref_id);

CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_date date NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES subledger_entities(id),
  to_warehouse_id uuid NOT NULL REFERENCES subledger_entities(id),
  note text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0
);

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES subledger_entities(id),
  count_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  note text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);

CREATE TABLE stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  system_qty numeric(18,4) NOT NULL DEFAULT 0,
  counted_qty numeric(18,4),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (count_id, item_id)
);

CREATE TABLE boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'وصفة قياسية',
  output_qty numeric(18,4) NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0)
);
