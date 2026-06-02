const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// ─── Helper ────────────────────────────────────────────────────────────────
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Views ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const data = readData();
  res.render('index', { data });
});

app.get('/admin', (req, res) => {
  const data = readData();
  res.render('admin', { data });
});

// ─── AUTH ──────────────────────────────────────────────────────────────────
app.post('/api/auth/resident', (req, res) => {
  const { aptNumber, password } = req.body;
  const data = readData();
  const resident = data.residents.find(r => r.number == aptNumber && r.password === password);
  if (!resident) return res.status(401).json({ error: 'מספר דירה או סיסמה שגויים' });
  res.json({ success: true, resident });
});

app.post('/api/auth/admin', (req, res) => {
  const { password } = req.body;
  const data = readData();
  if (password !== data.settings.adminPassword) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
  res.json({ success: true });
});

// ─── SETTINGS ──────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(readData().settings);
});

app.put('/api/settings', (req, res) => {
  const data = readData();
  data.settings = { ...data.settings, ...req.body };
  writeData(data);
  res.json({ success: true });
});

// Apartment types
app.post('/api/settings/aptTypes', (req, res) => {
  const data = readData();
  const item = { id: uid(), ...req.body };
  data.settings.apartmentTypes.push(item);
  writeData(data);
  res.json(item);
});

app.put('/api/settings/aptTypes/:id', (req, res) => {
  const data = readData();
  const idx = data.settings.apartmentTypes.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.settings.apartmentTypes[idx] = { ...data.settings.apartmentTypes[idx], ...req.body };
  writeData(data);
  res.json(data.settings.apartmentTypes[idx]);
});

app.delete('/api/settings/aptTypes/:id', (req, res) => {
  const data = readData();
  data.settings.apartmentTypes = data.settings.apartmentTypes.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Professions
app.post('/api/settings/professions', (req, res) => {
  const data = readData();
  const item = { id: uid(), ...req.body };
  data.settings.professions.push(item);
  writeData(data);
  res.json(item);
});

app.put('/api/settings/professions/:id', (req, res) => {
  const data = readData();
  const idx = data.settings.professions.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.settings.professions[idx] = { ...data.settings.professions[idx], ...req.body };
  writeData(data);
  res.json(data.settings.professions[idx]);
});

app.delete('/api/settings/professions/:id', (req, res) => {
  const data = readData();
  data.settings.professions = data.settings.professions.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Fees
app.post('/api/settings/fees', (req, res) => {
  const data = readData();
  const item = { id: uid(), ...req.body };
  data.settings.fees.push(item);
  writeData(data);
  res.json(item);
});

app.put('/api/settings/fees/:id', (req, res) => {
  const data = readData();
  const idx = data.settings.fees.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.settings.fees[idx] = { ...data.settings.fees[idx], ...req.body };
  writeData(data);
  res.json(data.settings.fees[idx]);
});

app.delete('/api/settings/fees/:id', (req, res) => {
  const data = readData();
  data.settings.fees = data.settings.fees.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// ─── RESIDENTS ─────────────────────────────────────────────────────────────
app.get('/api/residents', (req, res) => res.json(readData().residents));

app.post('/api/residents', (req, res) => {
  const data = readData();
  const resident = { id: uid(), ...req.body };
  data.residents.push(resident);
  writeData(data);
  res.json(resident);
});

app.put('/api/residents/:id', (req, res) => {
  const data = readData();
  const idx = data.residents.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'דייר לא נמצא' });
  data.residents[idx] = { ...data.residents[idx], ...req.body };
  writeData(data);
  res.json(data.residents[idx]);
});

app.delete('/api/residents/:id', (req, res) => {
  const data = readData();
  data.residents = data.residents.filter(r => r.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// ─── SERVICE TRANSACTIONS ──────────────────────────────────────────────────
app.get('/api/services', (req, res) => res.json(readData().serviceTransactions));

app.post('/api/services', (req, res) => {
  const data = readData();
  const item = { id: uid(), payments: [], ...req.body };
  data.serviceTransactions.push(item);
  writeData(data);
  res.json(item);
});

app.put('/api/services/:id', (req, res) => {
  const data = readData();
  const idx = data.serviceTransactions.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.serviceTransactions[idx] = { ...data.serviceTransactions[idx], ...req.body };
  writeData(data);
  res.json(data.serviceTransactions[idx]);
});

app.delete('/api/services/:id', (req, res) => {
  const data = readData();
  data.serviceTransactions = data.serviceTransactions.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Add payment to service
app.post('/api/services/:id/payments', (req, res) => {
  const data = readData();
  const idx = data.serviceTransactions.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  const payment = { id: uid(), ...req.body };
  if (!data.serviceTransactions[idx].payments) data.serviceTransactions[idx].payments = [];
  data.serviceTransactions[idx].payments.push(payment);
  writeData(data);
  res.json(payment);
});

// ─── FINANCIAL TRANSACTIONS ────────────────────────────────────────────────
app.get('/api/transactions', (req, res) => res.json(readData().transactions));

app.post('/api/transactions', (req, res) => {
  const data = readData();
  // Support multiple months
  const { months, ...base } = req.body;
  const created = [];
  if (months && months.length > 1) {
    for (const m of months) {
      const t = { id: uid(), ...base, month: m.month, year: m.year, amount: m.amount || base.amount };
      data.transactions.push(t);
      created.push(t);
    }
  } else {
    const t = { id: uid(), ...base, canceled: false };
    data.transactions.push(t);
    created.push(t);
  }
  writeData(data);
  res.json(created);
});

app.put('/api/transactions/:id', (req, res) => {
  const data = readData();
  const idx = data.transactions.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.transactions[idx] = { ...data.transactions[idx], ...req.body };
  writeData(data);
  res.json(data.transactions[idx]);
});

app.delete('/api/transactions/:id', (req, res) => {
  const data = readData();
  data.transactions = data.transactions.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Cancel transaction (returned check etc)
app.put('/api/transactions/:id/cancel', (req, res) => {
  const data = readData();
  const idx = data.transactions.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.transactions[idx].canceled = true;
  data.transactions[idx].cancelReason = req.body.reason || 'צ׳ק חזר';
  writeData(data);
  res.json(data.transactions[idx]);
});

// ─── DEFERRED CHECKS ───────────────────────────────────────────────────────
app.get('/api/deferred', (req, res) => res.json(readData().deferredChecks));

app.post('/api/deferred', (req, res) => {
  const data = readData();
  // Support bulk: array of checks
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const created = items.map(item => ({ id: uid(), cashed: false, ...item }));
  data.deferredChecks.push(...created);
  writeData(data);
  res.json(created);
});

app.put('/api/deferred/:id', (req, res) => {
  const data = readData();
  const idx = data.deferredChecks.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.deferredChecks[idx] = { ...data.deferredChecks[idx], ...req.body };
  writeData(data);
  res.json(data.deferredChecks[idx]);
});

app.delete('/api/deferred/:id', (req, res) => {
  const data = readData();
  data.deferredChecks = data.deferredChecks.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// ─── ONE TIME PROJECTS ─────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => res.json(readData().oneTimeProjects));

app.post('/api/projects', (req, res) => {
  const data = readData();
  // Initialize paid status for all residents
  const residents = data.residents;
  const paidStatus = {};
  residents.forEach(r => { paidStatus[r.id] = false; });
  const item = { id: uid(), paidStatus, ...req.body };
  data.oneTimeProjects.push(item);
  writeData(data);
  res.json(item);
});

app.put('/api/projects/:id', (req, res) => {
  const data = readData();
  const idx = data.oneTimeProjects.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  data.oneTimeProjects[idx] = { ...data.oneTimeProjects[idx], ...req.body };
  writeData(data);
  res.json(data.oneTimeProjects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  const data = readData();
  data.oneTimeProjects = data.oneTimeProjects.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Toggle payment status for resident in project
app.put('/api/projects/:id/pay/:residentId', (req, res) => {
  const data = readData();
  const idx = data.oneTimeProjects.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
  if (!data.oneTimeProjects[idx].paidStatus) data.oneTimeProjects[idx].paidStatus = {};
  const current = data.oneTimeProjects[idx].paidStatus[req.params.residentId];
  data.oneTimeProjects[idx].paidStatus[req.params.residentId] = !current;
  writeData(data);
  res.json({ paid: !current });
});

// ─── OPENING BALANCE & EXTERNAL INCOME ────────────────────────────────────
app.get('/api/balance', (req, res) => {
  const data = readData();
  res.json({ openingBalance: data.openingBalance, externalIncome: data.externalIncome });
});

app.put('/api/balance/opening', (req, res) => {
  const data = readData();
  data.openingBalance = req.body;
  writeData(data);
  res.json({ success: true });
});

app.post('/api/balance/external', (req, res) => {
  const data = readData();
  const item = { id: uid(), ...req.body };
  data.externalIncome.push(item);
  writeData(data);
  res.json(item);
});

app.delete('/api/balance/external/:id', (req, res) => {
  const data = readData();
  data.externalIncome = data.externalIncome.filter(x => x.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// ─── FULL DATA (for admin) ─────────────────────────────────────────────────
app.get('/api/data', (req, res) => res.json(readData()));

// ─── CSV Export ────────────────────────────────────────────────────────────
app.get('/api/export/transactions', (req, res) => {
  const data = readData();
  const header = 'מזהה,דירה,חודש,שנה,סכום,סוג,אמצעי תשלום,מבוטל\n';
  const rows = data.transactions.map(t =>
    `${t.id},${t.aptNumber || ''},${t.month || ''},${t.year || ''},${t.amount || ''},${t.type || ''},${t.method || ''},${t.canceled ? 'כן' : 'לא'}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send('\uFEFF' + header + rows);
});

app.get('/api/export/residents', (req, res) => {
  const data = readData();
  const header = 'דירה,שם משפחה,שם פרטי,טלפון,סוג דירה,שכירות\n';
  const rows = data.residents.sort((a,b) => a.number - b.number).map(r => {
    const type = data.settings.apartmentTypes.find(t => t.id === r.typeId);
    return `${r.number},${r.lastName},${r.firstName},${r.phone},${type ? type.name : ''},${r.isRental ? 'כן' : 'לא'}`;
  }).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="residents.csv"');
  res.send('\uFEFF' + header + rows);
});

app.listen(PORT, () => {
  console.log(`\n🏠 מערכת ועד בית רצה על http://localhost:${PORT}`);
  console.log(`👤 ממשק דיירים: http://localhost:${PORT}`);
  console.log(`🔧 ממשק מנהל:  http://localhost:${PORT}/admin\n`);
});
