-- Distinguishes service items (no stock, no warehouse) from physical goods.
ALTER TABLE items ADD COLUMN nature text NOT NULL DEFAULT 'goods' CHECK (nature IN ('goods', 'service'));
ALTER TABLE items ADD CONSTRAINT items_service_not_tracked CHECK (nature <> 'service' OR is_stock_tracked = false);
