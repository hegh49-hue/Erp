require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { requireAuth, requireRole } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const accountsRoutes = require('./routes/accounts');
const subledgerRoutes = require('./routes/subledger');
const journalRoutes = require('./routes/journal');
const reportsRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const channelsRoutes = require('./routes/channels');
const inventoryRoutes = require('./routes/inventory');
const posRoutes = require('./routes/pos');
const usersRoutes = require('./routes/users');
const customersRoutes = require('./routes/customers');
const disbursementsRoutes = require('./routes/disbursements');
const purchaseRequestsRoutes = require('./routes/purchaseRequests');
const exportRoutes = require('./routes/export');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, requireRole('admin', 'accountant'), accountsRoutes);
app.use('/api/subledger', requireAuth, requireRole('admin', 'accountant'), subledgerRoutes);
app.use('/api/journal', requireAuth, requireRole('admin', 'accountant'), journalRoutes);
app.use('/api/reports', requireAuth, requireRole('admin', 'accountant'), reportsRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/channels', requireAuth, channelsRoutes);
app.use('/api/inventory', requireAuth, inventoryRoutes);
app.use('/api/pos', requireAuth, posRoutes);
app.use('/api/users', requireAuth, requireRole('admin'), usersRoutes);
app.use('/api/customers', requireAuth, customersRoutes);
app.use('/api/disbursements', requireAuth, disbursementsRoutes);
app.use('/api/purchase-requests', requireAuth, purchaseRequestsRoutes);
app.use('/api/export', requireAuth, exportRoutes);

const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'خطأ في الخادم' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`ERP API listening on :${port}`));
