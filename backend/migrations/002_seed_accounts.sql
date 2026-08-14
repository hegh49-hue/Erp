-- Default chart of accounts per the spec (section 2), same numbering as the erp-shell.html prototype,
-- plus two accounts needed by the inventory module (section 5-item-1 / 10-item-1):
--   3900 opening-balance equity (used to load initial stock before a Purchases module exists)
--   5900 inventory adjustments & count variances
INSERT INTO accounts (code, name, type, has_subledger, subledger_type, cash_flow_category, equity_move_type) VALUES
  ('1000', 'النقدية', 'asset', true, 'cashbox', 'excluded', NULL),
  ('1010', 'البنك', 'asset', false, NULL, 'excluded', NULL),
  ('1100', 'الذمم المدينة (عملاء)', 'asset', true, 'customer', 'operating', NULL),
  ('1150', 'ذمم مدينة - قنوات ووسطاء خارجيون', 'asset', true, 'channel', 'operating', NULL),
  ('1200', 'المخزون', 'asset', true, 'warehouse', 'operating', NULL),
  ('1300', 'ضريبة القيمة المضافة - مدينة', 'asset', false, NULL, 'operating', NULL),
  ('1400', 'الأصول الثابتة - سيارات', 'asset', true, 'asset', 'investing', NULL),
  ('1410', 'الأصول الثابتة - أجهزة ومعدات', 'asset', true, 'asset', 'investing', NULL),
  ('1500', 'سلف وأمانات موظفين', 'asset', true, 'employee', 'operating', NULL),
  ('2000', 'الذمم الدائنة (موردين)', 'liability', true, 'supplier', 'operating', NULL),
  ('2100', 'ضريبة القيمة المضافة - دائنة', 'liability', false, NULL, 'operating', NULL),
  ('3000', 'رأس المال', 'equity', false, NULL, 'financing', 'capital'),
  ('3100', 'الأرباح المرحلة', 'equity', false, NULL, 'excluded', 'retainedEarnings'),
  ('3900', 'رصيد افتتاحي', 'equity', false, NULL, 'excluded', 'capital'),
  ('4000', 'إيرادات المبيعات', 'revenue', false, NULL, 'operating', NULL),
  ('5000', 'تكلفة البضاعة المباعة', 'expense', false, NULL, 'operating', NULL),
  ('5100', 'مصروفات تشغيلية', 'expense', false, NULL, 'operating', NULL),
  ('5150', 'مصروفات عمولات القنوات الخارجية', 'expense', false, NULL, 'operating', NULL),
  ('5200', 'رواتب وأجور', 'expense', false, NULL, 'operating', NULL),
  ('5300', 'إيجارات', 'expense', false, NULL, 'operating', NULL),
  ('5900', 'فروقات وتسويات المخزون', 'expense', false, NULL, 'operating', NULL);

INSERT INTO companies (name) VALUES ('منشأتي');
