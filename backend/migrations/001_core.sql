-- Core: auth, company, chart of accounts, analytical (subledger) elements, double-entry journal.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','user')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'منشأتي',
  vat_number text,
  phone text,
  address text,
  logo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  has_subledger boolean NOT NULL DEFAULT false,
  subledger_type text CHECK (subledger_type IN ('customer','supplier','warehouse','cashbox','asset','employee','channel')),
  cash_flow_category text NOT NULL DEFAULT 'operating' CHECK (cash_flow_category IN ('operating','investing','financing','excluded')),
  equity_move_type text CHECK (equity_move_type IN ('capital','retainedEarnings','dividends','reserves')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((has_subledger AND subledger_type IS NOT NULL) OR (NOT has_subledger))
);

CREATE TABLE subledger_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (control_account_id, code)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  description text NOT NULL,
  reference text,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_source ON journal_entries(source_type, source_id);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entity_id uuid REFERENCES subledger_entities(id) ON DELETE RESTRICT,
  debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_entity ON journal_lines(entity_id);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
