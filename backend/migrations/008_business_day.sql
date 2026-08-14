-- "Business day" lets a restaurant close a late-night shift after midnight without
-- splitting one night's sales across two calendar dates in reports.
ALTER TABLE companies ADD COLUMN business_day_start_hour int NOT NULL DEFAULT 6 CHECK (business_day_start_hour BETWEEN 0 AND 23);

-- Snapshotted at write time (not recomputed later) so changing the cutoff later never
-- retroactively reclassifies already-posted invoices.
ALTER TABLE pos_invoices ADD COLUMN business_date date;
UPDATE pos_invoices SET business_date = (
  (issued_at AT TIME ZONE 'UTC') - make_interval(hours => (SELECT business_day_start_hour FROM companies ORDER BY created_at LIMIT 1))
)::date;
ALTER TABLE pos_invoices ALTER COLUMN business_date SET NOT NULL;
CREATE INDEX idx_pos_invoices_business_date ON pos_invoices(business_date);
