require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const accountsRoutes = require('./routes/accounts');
const subledgerRoutes = require('./routes/subledger');
const journalRoutes = require('./routes/journal');
const reportsRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const channelsRoutes = require('./routes/channels');
const inventoryRoutes = require('./routes/inventory');
const posRoutes = require('./routes/pos');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, accountsRoutes);
app.use('/api/subledger', requireAuth, subledgerRoutes);
app.use('/api/journal', requireAuth, journalRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/channels', requireAuth, channelsRoutes);
app.use('/api/inventory', requireAuth, inventoryRoutes);
app.use('/api/pos', requireAuth, posRoutes);

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
