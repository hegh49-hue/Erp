-- Loyalty program rates and configurable cash-denomination list for shift closing.
ALTER TABLE companies ADD COLUMN loyalty_riyal_per_point numeric(10,2) NOT NULL DEFAULT 10;
ALTER TABLE companies ADD COLUMN loyalty_point_value numeric(10,4) NOT NULL DEFAULT 0.5;
ALTER TABLE companies ADD COLUMN currency_denominations jsonb NOT NULL DEFAULT '[500,200,100,50,20,10,5,1,0.5,0.25]';
