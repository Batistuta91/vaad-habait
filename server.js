const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cron    = require('node-cron');
const { z }   = require('zod');

const app  = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════════════
// DATA PERSISTENCE STRATEGY
// LIVE_FILE  = /data/live-data.json  (Railway Volume — persistent)
// SEED_FILE  = data.json             (Git seed — never overwritten)
// BACKUP_DIR = /data/backups/        (auto-backups, keep last 5)
// ═══════════════════════════════════════════════════════════════════════════

const VOLUME_DIR = '/data';
const SEED_FILE  = path.join(__dirname, 'data.json');
const LIVE_FILE  = fs.existsSync(VOLUME_DIR)
  ? path.join(VOLUME_DIR, 'live-data.json')
  : path.join(__dirname, 'live-data.json');
const BACKUP_DIR = fs.existsSync(VOLUME_DIR)
  ? path.join(VOLUME_DIR, 'backups')
  : path.join(__dirname, 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(LIVE_FILE))  { fs.copyFileSync(SEED_FILE, LIVE_FILE); console.log('✅ First boot: seeded live-data.json'); }
console.log(`💾 Live data: ${LIVE_FILE}`);

// ── FILE LOCKING (atomic write) ────────────────────────────────────────────
let writeLock = false;
const writeQueue = [];

function atomicWrite(data) {
  return new Promise((resolve, reject) => {
    const doWrite = () => {
      writeLock = true;
      const tmp = LIVE_FILE + '.tmp';
      try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, LIVE_FILE);
        resolve();
      } catch (err) {
        try { fs.unlinkSync(tmp); } catch {}
        reject(err);
      } finally {
        writeLock = false;
        if (writeQueue.length > 0) writeQueue.shift()();
      }
    };
    if (writeLock) writeQueue.push(doWrite);
    else doWrite();
  });
}

function readData()  { return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')); }
async function writeData(d) { await atomicWrite(d); }

// ── ZOD SCHEMA VALIDATION ─────────────────────────────────────────────────
const ApartmentSchema = z.object({
  id:         z.number().int().min(1).max(50),
  ownerName:  z.string().default(''),
  password:   z.string().min(1).default('1234'),
  payments:   z.record(z.number()).default({}),
  note:       z.string().default(''),
  ownerType:  z.enum(['owner','tenant']).default('owner'),
  tenantName: z.string().default(''),
  phone:      z.string().default(''),
  credit:     z.number().default(0),   // ← יתרת זכות
});

const DataSchema = z.object({
  buildingName:        z.string().default('ועד בית'),
  buildingAddress:     z.string().default(''),
  monthlyFee:          z.number().int().min(0).default(350),
  showPublicDebts:     z.boolean().default(true),
  showFinancialReport: z.boolean().default(true),
  bankDetails:         z.object({ bank: z.string(), branch: z.string(), account: z.string(), beneficiary: z.string() }).passthrough(),
  payboxLink:          z.string().default(''),
  adminPassword:       z.string().min(4),
  years:               z.array(z.number().int()).default([2025]),
  announcements:       z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), icon: z.string(), active: z.boolean() })).default([]),
  transactions:        z.array(z.object({ id: z.string(), type: z.enum(['income','expense']), category: z.string(), description: z.string(), amount: z.number(), date: z.string(), note: z.string().optional() })).default([]),
  apartments:          z.array(ApartmentSchema).default([]),
  specialCharges:      z.array(z.any()).default([]),
  openingBalance:      z.number().default(0),
  tickets:             z.array(z.any()).default([]),    // ← תקלות
  polls:               z.array(z.any()).default([]),    // ← סקרים
  bulletin:            z.array(z.any()).default([]),    // ← לוח מודעות
});

function validateData(data) {
  const result = DataSchema.safeParse(data);
  if (!result.success) {
    console.error('Schema validation errors:', result.error.flatten());
    return data; // return as-is — don't block on schema error
  }
  return result.data;
}

// ── AUTO BACKUP (weekly, keep last 5) ─────────────────────────────────────
function doBackup() {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest  = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    fs.copyFileSync(LIVE_FILE, dest);
    console.log(`✅ Auto-backup: ${dest}`);
    // Keep only the 5 most recent backups
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse();
    files.slice(5).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    });
  } catch (err) { console.error('Backup error:', err); }
}
// Every Sunday at 03:00
cron.schedule('0 3 * * 0', doBackup);

// ── SERVER SETUP ───────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// ── CREDIT CARRY-FORWARD ──────────────────────────────────────────────────
// When a payment exceeds monthlyFee, excess is stored as credit and applied to next unpaid months.
function applyCredit(apt, data) {
  const fee = data.monthlyFee || 350;
  const now = new Date();
  const cy  = now.getFullYear(), cm = now.getMonth() + 1;

  // collect all month keys in order
  const keys = [];
  for (const year of (data.years || [])) {
    const months = year < cy ? 12 : year === cy ? cm : 0;
    for (let m = 1; m <= months; m++) keys.push(`${year}-${m}`);
  }

  let credit = apt.credit || 0;
  // roll over excess from each payment into credit
  for (const key of keys) {
    const raw = apt.payments[key];
    const paid = typeof raw === 'boolean' ? (raw ? fee : 0) : (Number(raw) || 0);
    if (paid > fee) {
      credit += paid - fee;
      apt.payments[key] = fee;
    }
  }
  // apply credit to unpaid months
  for (const key of keys) {
    if (credit <= 0) break;
    const raw  = apt.payments[key];
    const paid = typeof raw === 'boolean' ? (raw ? fee : 0) : (Number(raw) || 0);
    if (paid < fee) {
      const needed = fee - paid;
      const use    = Math.min(needed, credit);
      apt.payments[key] = paid + use;
      credit -= use;
    }
  }
  apt.credit = credit;
  return apt;
}

// ── DEBT CALC ─────────────────────────────────────────────────────────────
function calcDebt(apt, data) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  let monthlyDebt = 0;
  for (const year of (data.years || [])) {
    const months = year < cy ? 12 : year === cy ? cm : 0;
    for (let m = 1; m <= months; m++) {
      const raw  = apt.payments[`${year}-${m}`];
      const paid = typeof raw === 'boolean' ? (raw ? (data.monthlyFee||0) : 0) : (Number(raw)||0);
      monthlyDebt += Math.max(0, (data.monthlyFee||0) - paid);
    }
  }
  let specialDebt = 0;
  for (const sc of (data.specialCharges||[])) {
    const e = (sc.apartments||[]).find(a => a.id === apt.id);
    if (e && !e.paid) specialDebt += sc.costPerApartment||0;
  }
  return { monthlyDebt, specialDebt, total: monthlyDebt + specialDebt };
}

function buildMonthlyStatus(apt, data) {
  const now = new Date();
  const res = [];
  for (const year of (data.years||[])) {
    const months = year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth()+1 : 0;
    for (let m = 1; m <= months; m++) {
      const raw     = apt.payments[`${year}-${m}`];
      const paidAmt = typeof raw === 'boolean' ? (raw ? (data.monthlyFee||0) : 0) : (Number(raw)||0);
      const state   = paidAmt <= 0 ? 'unpaid' : paidAmt >= (data.monthlyFee||0) ? 'full' : 'partial';
      res.push({ year, month: m, label: MONTHS[m-1]+' '+year, state, paidAmount: paidAmt, fullAmount: data.monthlyFee });
    }
  }
  return res;
}

function aptPublicInfo(apt, data) {
  const d = calcDebt(apt, data);
  const phone = apt.phone ? apt.phone.replace(/\D/g,'') : '';
  const waName = apt.ownerType==='tenant' && apt.tenantName ? apt.tenantName : (apt.ownerName||'');
  return { id: apt.id, debt: d.total, phone, waName };
}

// ═══════════════════════════════════════════════════════════════════════════
// TENANT ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  const data = validateData(readData());
  const now  = new Date();
  const transactions   = data.transactions || [];
  const openingBalance = data.openingBalance || 0;
  const totalIncome    = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+(t.amount||0),0);
  const totalExpense   = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+(t.amount||0),0);
  const balance        = openingBalance + totalIncome - totalExpense;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentTx = [...transactions]
    .filter(t => !t.date || t.date >= cutoffStr)
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  // Active polls for tenant view
  const activePolls = (data.polls||[]).filter(p => p.active);

  res.render('index', {
    buildingName:        data.buildingName,
    buildingAddress:     data.buildingAddress||'',
    bankDetails:         data.bankDetails,
    payboxLink:          data.payboxLink,
    showPublicDebts:     data.showPublicDebts !== false,
    showFinancialReport: data.showFinancialReport !== false,
    announcements:       (data.announcements||[]).filter(a=>a.active),
    publicApartments:    data.apartments.map(a => aptPublicInfo(a, data)),
    specialCharges:      data.specialCharges||[],
    totalIncome, totalExpense, balance, openingBalance, recentTx,
    currentYear: now.getFullYear(), currentMonth: now.getMonth()+1, MONTHS,
    activePolls,
    bulletinItems:       (data.bulletin||[]).filter(b=>b.active).slice(0,20),
    cssVersion: Date.now()
  });
});

app.post('/api/login', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt)                      return res.json({ success: false, message: 'דירה לא נמצאה' });
  if (apt.password !== password) return res.json({ success: false, message: 'סיסמה שגויה' });
  const debt = calcDebt(apt, data);
  res.json({ success: true, apartment: {
    id: apt.id, ownerName: apt.ownerName||'', ownerType: apt.ownerType||'owner',
    tenantName: apt.tenantName||'', phone: apt.phone||'', credit: apt.credit||0,
    debt: debt.total, monthlyDebt: debt.monthlyDebt, specialDebt: debt.specialDebt,
    note: apt.note, monthlyStatus: buildMonthlyStatus(apt, data),
    specialCharges: (data.specialCharges||[]).map(sc => {
      const e=(sc.apartments||[]).find(a=>a.id===apt.id);
      return { name:sc.name, description:sc.description, costPerApartment:sc.costPerApartment, paid:e?e.paid:false };
    })
  }});
});

app.post('/api/apartment-status', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.json({ success: false });
  const debt = calcDebt(apt, data);
  res.json({ success: true, apartment: {
    id: apt.id, ownerName: apt.ownerName||'', ownerType: apt.ownerType||'owner',
    tenantName: apt.tenantName||'', phone: apt.phone||'', credit: apt.credit||0,
    debt: debt.total, monthlyDebt: debt.monthlyDebt, specialDebt: debt.specialDebt,
    note: apt.note, monthlyStatus: buildMonthlyStatus(apt, data),
    specialCharges: (data.specialCharges||[]).map(sc => {
      const e=(sc.apartments||[]).find(a=>a.id===apt.id);
      return { name:sc.name, description:sc.description, costPerApartment:sc.costPerApartment, paid:e?e.paid:false };
    })
  }});
});

// ── PHONEBOOK ─────────────────────────────────────────────────────────────
app.post('/api/phonebook', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.status(403).json({ success: false });
  const phonebook = data.apartments
    .filter(a => a.ownerName || a.phone)
    .map(a => ({
      id: a.id, ownerName: a.ownerName||'', tenantName: a.tenantName||'',
      ownerType: a.ownerType||'owner', phone: a.phone||''
    }));
  res.json({ success: true, phonebook, buildingName: data.buildingName, buildingAddress: data.buildingAddress||'' });
});

// ── TICKETS (tenant: submit) ───────────────────────────────────────────────
app.post('/api/ticket/submit', async (req, res) => {
  const { apartmentId, password, title, description } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.status(403).json({ success: false, message: 'אין הרשאה' });
  if (!title) return res.status(400).json({ success: false, message: 'נדרשת כותרת' });

  const ticket = {
    id:          'tkt_' + Date.now(),
    aptId:       apt.id,
    ownerName:   apt.ownerType==='tenant' ? (apt.tenantName||apt.ownerName) : (apt.ownerName||''),
    title:       String(title).slice(0, 120),
    description: String(description||'').slice(0, 500),
    status:      'open',        // open | in-progress | closed
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    adminNote:   '',
  };
  if (!data.tickets) data.tickets = [];
  data.tickets.unshift(ticket);
  await writeData(data);
  res.json({ success: true, ticket });
});

// ── BULLETIN (tenant: submit) ──────────────────────────────────────────────
app.post('/api/bulletin/submit', async (req, res) => {
  const { apartmentId, password, title, body, category } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.status(403).json({ success: false, message: 'אין הרשאה' });
  if (!title) return res.status(400).json({ success: false, message: 'נדרשת כותרת' });

  const item = {
    id:        'blt_' + Date.now(),
    aptId:     apt.id,
    ownerName: apt.ownerType==='tenant' ? (apt.tenantName||apt.ownerName) : (apt.ownerName||''),
    title:     String(title).slice(0, 100),
    body:      String(body||'').slice(0, 400),
    category:  ['sale','service','wanted','other'].includes(category) ? category : 'other',
    active:    true,
    createdAt: new Date().toISOString(),
  };
  if (!data.bulletin) data.bulletin = [];
  data.bulletin.unshift(item);
  await writeData(data);
  res.json({ success: true, item });
});

// ── POLLS (tenant: vote) ───────────────────────────────────────────────────
app.post('/api/poll/vote', async (req, res) => {
  const { apartmentId, password, pollId, optionIndex } = req.body;
  const data = validateData(readData());
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.status(403).json({ success: false, message: 'אין הרשאה' });

  const poll = (data.polls||[]).find(p => p.id === pollId);
  if (!poll || !poll.active) return res.status(404).json({ success: false, message: 'סקר לא נמצא' });

  const idx = parseInt(optionIndex);
  if (isNaN(idx) || idx < 0 || idx >= poll.options.length)
    return res.status(400).json({ success: false, message: 'אפשרות לא תקינה' });

  if (!poll.votes) poll.votes = {};
  // Remove old vote if exists
  poll.votes[apt.id] = idx;
  await writeData(data);

  // Build results
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter(v => v === i).length);
  res.json({ success: true, counts, total: Object.keys(poll.votes).length });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/admin', (req, res) => {
  const data = validateData(readData());
  const now  = new Date();
  res.render('admin', {
    buildingName:        data.buildingName,
    buildingAddress:     data.buildingAddress||'',
    monthlyFee:          data.monthlyFee||350,
    openingBalance:      data.openingBalance||0,
    showPublicDebts:     data.showPublicDebts !== false,
    showFinancialReport: data.showFinancialReport !== false,
    bankDetails:         data.bankDetails,
    payboxLink:          data.payboxLink,
    apartments:          data.apartments,
    specialCharges:      data.specialCharges||[],
    announcements:       data.announcements||[],
    transactions:        data.transactions||[],
    years:               data.years||[2025],
    tickets:             data.tickets||[],
    polls:               data.polls||[],
    bulletin:            data.bulletin||[],
    currentYear:         now.getFullYear(),
    currentMonth:        now.getMonth()+1,
    MONTHS,
    cssVersion:          Date.now()
  });
});

app.post('/api/admin/verify', (req, res) => {
  const data = readData();
  res.json({ success: req.body.password === data.adminPassword });
});

app.post('/api/admin/save', async (req, res) => {
  const { adminPassword, apartments, specialCharges, settings, announcements, transactions } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false, message: 'אין הרשאה' });

  if (settings) {
    if (settings.buildingName    !== undefined) data.buildingName    = settings.buildingName;
    if (settings.buildingAddress !== undefined) data.buildingAddress = settings.buildingAddress;
    if (settings.monthlyFee)      data.monthlyFee      = parseInt(settings.monthlyFee);
    if (settings.openingBalance   !== undefined) data.openingBalance = parseInt(settings.openingBalance)||0;
    if (settings.showPublicDebts  !== undefined) data.showPublicDebts  = settings.showPublicDebts;
    if (settings.showFinancialReport !== undefined) data.showFinancialReport = settings.showFinancialReport;
    if (settings.newAdminPassword && settings.newAdminPassword.length >= 4)
      data.adminPassword = settings.newAdminPassword;
    if (settings.bankDetails)     data.bankDetails = { ...data.bankDetails, ...settings.bankDetails };
    if (settings.payboxLink       !== undefined) data.payboxLink = settings.payboxLink;
    if (settings.years)           data.years = settings.years;
  }

  if (apartments && Array.isArray(apartments)) {
    apartments.forEach(inc => {
      const ex = data.apartments.find(a => a.id === inc.id);
      if (!ex) return;
      ex.phone      = inc.phone      !== undefined ? inc.phone      : (ex.phone||'');
      ex.ownerName  = inc.ownerName  !== undefined ? inc.ownerName  : ex.ownerName;
      ex.ownerType  = inc.ownerType  !== undefined ? inc.ownerType  : (ex.ownerType||'owner');
      ex.tenantName = inc.tenantName !== undefined ? inc.tenantName : (ex.tenantName||'');
      ex.note       = inc.note       !== undefined ? inc.note       : ex.note;
      if (inc.password && inc.password.length >= 4) ex.password = inc.password;
      if (inc.payments !== undefined) {
        ex.payments = inc.payments;
        applyCredit(ex, data); // auto-apply credit after payment update
      }
    });
  }

  if (specialCharges !== undefined) {
    data.specialCharges = specialCharges.map(sc => ({
      id: sc.id, name: sc.name||'', description: sc.description||'',
      costPerApartment: parseInt(sc.costPerApartment)||0, date: sc.date||'',
      apartments: (sc.apartments||[]).map(a => ({ id: a.id, paid: !!a.paid }))
    }));
  }

  if (announcements !== undefined) {
    data.announcements = announcements.map(a => ({
      id: a.id, title: a.title||'', body: a.body||'', icon: a.icon||'📢', active: !!a.active
    }));
  }

  if (transactions !== undefined) {
    data.transactions = transactions.map(t => ({
      id: t.id, type: t.type==='income'?'income':'expense',
      category: t.category||'', description: t.description||'',
      amount: Math.abs(parseInt(t.amount)||0), date: t.date||'', note: t.note||''
    }));
  }

  await writeData(data);
  res.json({ success: true, message: 'נשמר בהצלחה!' });
});

app.post('/api/admin/add-year', async (req, res) => {
  const { adminPassword, year } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  if (!data.years.includes(year)) { data.years.push(year); data.years.sort((a,b)=>a-b); }
  await writeData(data);
  res.json({ success: true, years: data.years });
});

app.post('/api/admin/add-special', async (req, res) => {
  const { adminPassword, name, description, costPerApartment, date } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  const sc = {
    id: 'sc_'+Date.now(), name: name||'גבייה מיוחדת', description: description||'',
    costPerApartment: parseInt(costPerApartment)||0, date: date||'',
    apartments: data.apartments.map(a => ({ id: a.id, paid: false }))
  };
  data.specialCharges.push(sc);
  await writeData(data);
  res.json({ success: true, charge: sc });
});

app.delete('/api/admin/special/:id', async (req, res) => {
  const { adminPassword } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  data.specialCharges = data.specialCharges.filter(sc => sc.id !== req.params.id);
  await writeData(data);
  res.json({ success: true });
});

// ── TICKETS ADMIN ─────────────────────────────────────────────────────────
app.post('/api/admin/ticket/update', async (req, res) => {
  const { adminPassword, ticketId, status, adminNote } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  const ticket = (data.tickets||[]).find(t => t.id === ticketId);
  if (!ticket) return res.status(404).json({ success: false });
  if (status)    ticket.status    = ['open','in-progress','closed'].includes(status) ? status : ticket.status;
  if (adminNote !== undefined) ticket.adminNote = String(adminNote).slice(0, 300);
  ticket.updatedAt = new Date().toISOString();
  await writeData(data);
  res.json({ success: true, ticket });
});

app.delete('/api/admin/ticket/:id', async (req, res) => {
  const { adminPassword } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  data.tickets = (data.tickets||[]).filter(t => t.id !== req.params.id);
  await writeData(data);
  res.json({ success: true });
});

// ── POLLS ADMIN ───────────────────────────────────────────────────────────
app.post('/api/admin/poll/add', async (req, res) => {
  const { adminPassword, question, options } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  if (!question || !Array.isArray(options) || options.length < 2)
    return res.status(400).json({ success: false, message: 'שאלה ו-2 אפשרויות נדרשות' });
  const poll = {
    id:        'poll_' + Date.now(),
    question:  String(question).slice(0, 200),
    options:   options.map(o => String(o).slice(0, 100)).slice(0, 6),
    active:    true,
    votes:     {},
    createdAt: new Date().toISOString(),
  };
  if (!data.polls) data.polls = [];
  data.polls.unshift(poll);
  await writeData(data);
  res.json({ success: true, poll });
});

app.post('/api/admin/poll/toggle', async (req, res) => {
  const { adminPassword, pollId } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  const poll = (data.polls||[]).find(p => p.id === pollId);
  if (!poll) return res.status(404).json({ success: false });
  poll.active = !poll.active;
  await writeData(data);
  res.json({ success: true, active: poll.active });
});

app.delete('/api/admin/poll/:id', async (req, res) => {
  const { adminPassword } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  data.polls = (data.polls||[]).filter(p => p.id !== req.params.id);
  await writeData(data);
  res.json({ success: true });
});

// ── BULLETIN ADMIN ────────────────────────────────────────────────────────
app.post('/api/admin/bulletin/toggle', async (req, res) => {
  const { adminPassword, itemId } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  const item = (data.bulletin||[]).find(b => b.id === itemId);
  if (!item) return res.status(404).json({ success: false });
  item.active = !item.active;
  await writeData(data);
  res.json({ success: true, active: item.active });
});

app.delete('/api/admin/bulletin/:id', async (req, res) => {
  const { adminPassword } = req.body;
  const data = validateData(readData());
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  data.bulletin = (data.bulletin||[]).filter(b => b.id !== req.params.id);
  await writeData(data);
  res.json({ success: true });
});

// ── BACKUPS ADMIN ─────────────────────────────────────────────────────────
app.get('/api/admin/backups/:password', (req, res) => {
  const data = readData();
  if (req.params.password !== data.adminPassword) return res.status(403).json({ error: 'אין הרשאה' });
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .sort().reverse()
      .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
    res.json({ success: true, files });
  } catch { res.json({ success: true, files: [] }); }
});

app.get('/api/admin/backup/download/:password/:filename', (req, res) => {
  const data = readData();
  if (req.params.password !== data.adminPassword) return res.status(403).json({ error: 'אין הרשאה' });
  const filePath = path.join(BACKUP_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'לא נמצא' });
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.sendFile(filePath);
});

app.post('/api/admin/backup/now', async (req, res) => {
  const { adminPassword } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  doBackup();
  res.json({ success: true, message: 'גיבוי בוצע!' });
});

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────
app.get('/api/admin/export/:password', (req, res) => {
  const data = readData();
  if (req.params.password !== data.adminPassword) return res.status(403).json({ error: 'אין הרשאה' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="vaad-backup.json"');
  res.send(JSON.stringify(data, null, 2));
});

app.post('/api/admin/import', async (req, res) => {
  const { adminPassword, data: importedData } = req.body;
  const current = readData();
  if (adminPassword !== current.adminPassword) return res.status(403).json({ success: false, message: 'אין הרשאה' });
  if (!importedData || !importedData.apartments) return res.status(400).json({ success: false, message: 'קובץ לא תקין' });
  await writeData(importedData);
  res.json({ success: true, message: 'הנתונים שוחזרו בהצלחה!' });
});

app.listen(PORT, () => {
  console.log(`\n✅ ועד בית — http://localhost:${PORT}\n   מנהל: http://localhost:${PORT}/admin\n`);
});
