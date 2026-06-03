const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function readData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8'); }

const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function calcDebt(apt, data) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  let monthlyDebt = 0;
  for (const year of (data.years || [])) {
    const months = year < cy ? 12 : year === cy ? cm : 0;
    for (let m = 1; m <= months; m++) {
      const raw = apt.payments[`${year}-${m}`];
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
      const raw = apt.payments[`${year}-${m}`];
      const paidAmt = typeof raw === 'boolean' ? (raw ? (data.monthlyFee||0) : 0) : (Number(raw)||0);
      const state = paidAmt <= 0 ? 'unpaid' : paidAmt >= (data.monthlyFee||0) ? 'full' : 'partial';
      res.push({ year, month: m, label: MONTHS[m-1]+' '+year, state, paidAmount: paidAmt, fullAmount: data.monthlyFee });
    }
  }
  return res;
}

// ── TENANT ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const data = readData();
  const now  = new Date();

  // Financial summary (income - expense)
  const transactions = data.transactions || [];
  const openingBalance = data.openingBalance || 0;
  const totalIncome  = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+(t.amount||0),0);
  const totalExpense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+(t.amount||0),0);
  const balance      = openingBalance + totalIncome - totalExpense;

  // Recent transactions (last 10) for public display
  const recentTx = [...transactions]
    .sort((a,b)=>new Date(b.date)-new Date(a.date))
    .slice(0, 10);

  res.render('index', {
    buildingName:        data.buildingName,
    buildingAddress:     data.buildingAddress||'',
    bankDetails:         data.bankDetails,
    payboxLink:          data.payboxLink,
    showPublicDebts:     data.showPublicDebts !== false,
    showFinancialReport: data.showFinancialReport !== false,
    announcements:       (data.announcements||[]).filter(a=>a.active),
    publicApartments:    data.apartments.map(a => { const d=calcDebt(a,data); return {id:a.id,debt:d.total}; }),
    specialCharges:      data.specialCharges||[],
    totalIncome, totalExpense, balance, openingBalance, recentTx,
    currentYear: now.getFullYear(), currentMonth: now.getMonth()+1, MONTHS
  });
});

app.post('/api/login', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = readData();
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt)                      return res.json({ success: false, message: 'דירה לא נמצאה' });
  if (apt.password !== password) return res.json({ success: false, message: 'סיסמה שגויה' });
  const debt = calcDebt(apt, data);
  res.json({ success: true, apartment: {
    id: apt.id, ownerName: apt.ownerName||'',
    ownerType: apt.ownerType||'owner', tenantName: apt.tenantName||'',
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
  const data = readData();
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.json({ success: false });
  const debt = calcDebt(apt, data);
  res.json({ success: true, apartment: {
    id: apt.id, ownerName: apt.ownerName||'',
    ownerType: apt.ownerType||'owner', tenantName: apt.tenantName||'',
    debt: debt.total, monthlyDebt: debt.monthlyDebt, specialDebt: debt.specialDebt,
    note: apt.note, monthlyStatus: buildMonthlyStatus(apt, data),
    specialCharges: (data.specialCharges||[]).map(sc => {
      const e=(sc.apartments||[]).find(a=>a.id===apt.id);
      return { name:sc.name, description:sc.description, costPerApartment:sc.costPerApartment, paid:e?e.paid:false };
    })
  }});
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const data = readData();
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
    currentYear:         now.getFullYear(),
    currentMonth:        now.getMonth()+1,
    MONTHS
  });
});

app.post('/api/admin/verify', (req, res) => {
  const data = readData();
  res.json({ success: req.body.password === data.adminPassword });
});

app.post('/api/admin/save', (req, res) => {
  const { adminPassword, apartments, specialCharges, settings, announcements, transactions } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false, message: 'אין הרשאה' });

  if (settings) {
    if (settings.buildingName  !== undefined) data.buildingName  = settings.buildingName;
    if (settings.buildingAddress !== undefined) data.buildingAddress = settings.buildingAddress;
    if (settings.monthlyFee)    data.monthlyFee    = parseInt(settings.monthlyFee);
    if (settings.openingBalance !== undefined) data.openingBalance = parseInt(settings.openingBalance) || 0;
    if (settings.showPublicDebts !== undefined) data.showPublicDebts = settings.showPublicDebts;
    if (settings.showFinancialReport !== undefined) data.showFinancialReport = settings.showFinancialReport;
    if (settings.newAdminPassword && settings.newAdminPassword.length >= 4)
      data.adminPassword = settings.newAdminPassword;
    if (settings.bankDetails)   data.bankDetails = { ...data.bankDetails, ...settings.bankDetails };
    if (settings.payboxLink !== undefined) data.payboxLink = settings.payboxLink;
    if (settings.years)         data.years = settings.years;
  }

  if (apartments && Array.isArray(apartments)) {
    apartments.forEach(inc => {
      const ex = data.apartments.find(a => a.id === inc.id);
      if (!ex) return;
      ex.ownerName  = inc.ownerName  !== undefined ? inc.ownerName  : ex.ownerName;
      ex.ownerType  = inc.ownerType  !== undefined ? inc.ownerType  : (ex.ownerType||'owner');
      ex.tenantName = inc.tenantName !== undefined ? inc.tenantName : (ex.tenantName||'');
      ex.note       = inc.note       !== undefined ? inc.note       : ex.note;
      if (inc.password && inc.password.length >= 4) ex.password = inc.password;
      if (inc.payments !== undefined) ex.payments = inc.payments;
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
      id:          t.id,
      type:        t.type === 'income' ? 'income' : 'expense',
      category:    t.category||'',
      description: t.description||'',
      amount:      Math.abs(parseInt(t.amount)||0),
      date:        t.date||'',
      note:        t.note||''
    }));
  }

  writeData(data);
  res.json({ success: true, message: 'נשמר בהצלחה!' });
});

app.post('/api/admin/add-year', (req, res) => {
  const { adminPassword, year } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  if (!data.years.includes(year)) { data.years.push(year); data.years.sort((a,b)=>a-b); }
  writeData(data);
  res.json({ success: true, years: data.years });
});

app.post('/api/admin/add-special', (req, res) => {
  const { adminPassword, name, description, costPerApartment, date } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  const sc = {
    id: 'sc_'+Date.now(), name: name||'גבייה מיוחדת', description: description||'',
    costPerApartment: parseInt(costPerApartment)||0, date: date||'',
    apartments: data.apartments.map(a => ({ id: a.id, paid: false }))
  };
  data.specialCharges.push(sc);
  writeData(data);
  res.json({ success: true, charge: sc });
});

app.delete('/api/admin/special/:id', (req, res) => {
  const { adminPassword } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword) return res.status(403).json({ success: false });
  data.specialCharges = data.specialCharges.filter(sc => sc.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n✅  http://localhost:${PORT}  |  /admin\n`);
});
