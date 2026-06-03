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

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// Calculate debt for one apartment
function calcDebt(apt, data) {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let monthlyDebt = 0;
  const startYear = Math.min(...(data.years || [2025]));

  for (const year of (data.years || [])) {
    const monthsToCheck = (year < currentYear)
      ? 12
      : (year === currentYear ? currentMonth : 0);
    for (let m = 1; m <= monthsToCheck; m++) {
      const key = `${year}-${m}`;
      if (!apt.payments[key]) {
        monthlyDebt += data.monthlyFee || 0;
      }
    }
  }

  // Special charges unpaid
  let specialDebt = 0;
  for (const sc of (data.specialCharges || [])) {
    const entry = (sc.apartments || []).find(a => a.id === apt.id);
    if (entry && !entry.paid) {
      specialDebt += sc.costPerApartment || 0;
    }
  }

  return { monthlyDebt, specialDebt, total: monthlyDebt + specialDebt };
}

// ── TENANT ROUTES ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const data = readData();
  const now  = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const publicApartments = data.apartments.map(a => {
    const d = calcDebt(a, data);
    return { id: a.id, debt: d.total };
  });

  res.render('index', {
    buildingName:    data.buildingName,
    buildingAddress: data.buildingAddress || '',
    bankDetails:     data.bankDetails,
    payboxLink:      data.payboxLink,
    publicApartments,
    specialCharges:  data.specialCharges || [],
    currentYear,
    currentMonth,
    MONTHS
  });
});

app.post('/api/login', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = readData();
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt)                  return res.json({ success: false, message: 'דירה לא נמצאה' });
  if (apt.password !== password) return res.json({ success: false, message: 'סיסמה שגויה' });

  const debt = calcDebt(apt, data);
  const now  = new Date();

  // Build monthly status for display
  const monthlyStatus = [];
  for (const year of (data.years || [])) {
    const monthsToShow = (year < now.getFullYear()) ? 12
      : (year === now.getFullYear() ? now.getMonth() + 1 : 0);
    for (let m = 1; m <= monthsToShow; m++) {
      monthlyStatus.push({
        year, month: m,
        label: MONTHS[m-1] + ' ' + year,
        paid: !!apt.payments[`${year}-${m}`]
      });
    }
  }

  // Special charges
  const mySpecial = (data.specialCharges || []).map(sc => {
    const entry = (sc.apartments || []).find(a => a.id === apt.id);
    return {
      name: sc.name,
      description: sc.description,
      costPerApartment: sc.costPerApartment,
      paid: entry ? entry.paid : false
    };
  });

  res.json({
    success: true,
    apartment: {
      id:            apt.id,
      ownerName:     apt.ownerName || '',
      debt:          debt.total,
      monthlyDebt:   debt.monthlyDebt,
      specialDebt:   debt.specialDebt,
      note:          apt.note,
      monthlyStatus,
      specialCharges: mySpecial
    }
  });
});

app.post('/api/apartment-status', (req, res) => {
  const { apartmentId, password } = req.body;
  const data = readData();
  const apt  = data.apartments.find(a => a.id === parseInt(apartmentId));
  if (!apt || apt.password !== password) return res.json({ success: false });

  const debt = calcDebt(apt, data);
  const now  = new Date();

  const monthlyStatus = [];
  for (const year of (data.years || [])) {
    const monthsToShow = (year < now.getFullYear()) ? 12
      : (year === now.getFullYear() ? now.getMonth() + 1 : 0);
    for (let m = 1; m <= monthsToShow; m++) {
      monthlyStatus.push({
        year, month: m,
        label: MONTHS[m-1] + ' ' + year,
        paid: !!apt.payments[`${year}-${m}`]
      });
    }
  }

  const mySpecial = (data.specialCharges || []).map(sc => {
    const entry = (sc.apartments || []).find(a => a.id === apt.id);
    return {
      name: sc.name,
      description: sc.description,
      costPerApartment: sc.costPerApartment,
      paid: entry ? entry.paid : false
    };
  });

  res.json({
    success: true,
    apartment: {
      id:            apt.id,
      ownerName:     apt.ownerName || '',
      debt:          debt.total,
      monthlyDebt:   debt.monthlyDebt,
      specialDebt:   debt.specialDebt,
      note:          apt.note,
      monthlyStatus,
      specialCharges: mySpecial
    }
  });
});

// ── ADMIN ROUTES ─────────────────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  const data = readData();
  const now  = new Date();
  res.render('admin', {
    buildingName:    data.buildingName,
    buildingAddress: data.buildingAddress || '',
    monthlyFee:      data.monthlyFee || 350,
    bankDetails:     data.bankDetails,
    payboxLink:      data.payboxLink,
    apartments:      data.apartments,
    specialCharges:  data.specialCharges || [],
    years:           data.years || [2025],
    currentYear:     now.getFullYear(),
    currentMonth:    now.getMonth() + 1,
    MONTHS
  });
});

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  const data = readData();
  res.json({ success: password === data.adminPassword });
});

// Save everything
app.post('/api/admin/save', (req, res) => {
  const { adminPassword, apartments, specialCharges, settings } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false, message: 'אין הרשאה' });

  if (settings) {
    if (settings.buildingName)    data.buildingName    = settings.buildingName;
    if (settings.buildingAddress !== undefined) data.buildingAddress = settings.buildingAddress;
    if (settings.monthlyFee)      data.monthlyFee      = parseInt(settings.monthlyFee);
    if (settings.newAdminPassword && settings.newAdminPassword.length >= 4)
      data.adminPassword = settings.newAdminPassword;
    if (settings.bankDetails)     data.bankDetails     = { ...data.bankDetails, ...settings.bankDetails };
    if (settings.payboxLink !== undefined) data.payboxLink = settings.payboxLink;
    if (settings.years)           data.years           = settings.years;
  }

  if (apartments && Array.isArray(apartments)) {
    apartments.forEach(inc => {
      const ex = data.apartments.find(a => a.id === inc.id);
      if (!ex) return;
      ex.ownerName = inc.ownerName || ex.ownerName;
      ex.note      = inc.note !== undefined ? inc.note : ex.note;
      if (inc.password && inc.password.length >= 4) ex.password = inc.password;
      if (inc.payments) ex.payments = inc.payments;
    });
  }

  if (specialCharges !== undefined) {
    data.specialCharges = specialCharges.map(sc => ({
      id:               sc.id,
      name:             sc.name || '',
      description:      sc.description || '',
      costPerApartment: parseInt(sc.costPerApartment) || 0,
      date:             sc.date || '',
      apartments:       (sc.apartments || []).map(a => ({ id: a.id, paid: !!a.paid }))
    }));
  }

  writeData(data);
  res.json({ success: true, message: 'נשמר בהצלחה!', newPassword: data.adminPassword });
});

// Add year
app.post('/api/admin/add-year', (req, res) => {
  const { adminPassword, year } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false });
  if (!data.years.includes(year)) {
    data.years.push(year);
    data.years.sort((a,b)=>a-b);
  }
  writeData(data);
  res.json({ success: true, years: data.years });
});

// Add special charge
app.post('/api/admin/add-special', (req, res) => {
  const { adminPassword, name, description, costPerApartment, date } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false });

  const sc = {
    id:               'sc_' + Date.now(),
    name:             name || 'גבייה מיוחדת',
    description:      description || '',
    costPerApartment: parseInt(costPerApartment) || 0,
    date:             date || '',
    apartments:       data.apartments.map(a => ({ id: a.id, paid: false }))
  };
  data.specialCharges.push(sc);
  writeData(data);
  res.json({ success: true, charge: sc });
});

// Delete special charge
app.delete('/api/admin/special/:id', (req, res) => {
  const { adminPassword } = req.body;
  const data = readData();
  if (adminPassword !== data.adminPassword)
    return res.status(403).json({ success: false });
  data.specialCharges = data.specialCharges.filter(sc => sc.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n✅ ועד בית — http://localhost:${PORT}`);
  console.log(`   מנהל: http://localhost:${PORT}/admin  (סיסמה: vaad2024)\n`);
});
