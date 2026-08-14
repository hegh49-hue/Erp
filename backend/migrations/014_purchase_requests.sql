CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  approx_qty text,
  note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'fulfilled', 'cancelled')),
  requested_by uuid REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz
);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
