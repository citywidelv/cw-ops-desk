// ============================================================
// Books.gs - the workbook registry. Sep 24 2026.
//
// RULE: one subject per Google Sheet. A workbook holds tabs about one
// thing only (postings and their responses, invoices, COI requests, ...).
//
// HOW CODE REACHES A BOOK
//   Every module goes through a family accessor: cwSS_() (was the
//   Solicitations book), vdSS_() (vendor family), vioSS_() / insSS_()
//   (compliance family), supSS_() (supplies family), niSS_() (night ops
//   family), staffSS_() (team family). Each accessor returns a ROUTER that
//   behaves like a Spreadsheet: getSheetByName(tab) and insertSheet(tab)
//   send that tab name to the workbook that owns it (CW_TAB_BOOK). A tab
//   name that is not listed stays on the family's default book.
//
//   So a module never needs to know which file a tab lives in. To move a
//   tab to another workbook: copy the tab, set that book's script property,
//   add one line to CW_TAB_BOOK. No other code changes.
//
// WHERE THE IDS LIVE
//   Script properties (Project Settings). One property per workbook, named
//   in CW_BOOKS below. When a property is missing the router falls back to
//   the family's default book, so the code can be deployed before the tabs
//   are moved and nothing breaks in between.
//
// DRIVE
//   All of these live under My Drive > Team Portal, in subject folders.
// ============================================================

var CW_BOOKS = {
  // -------- opportunities family (default: the old CW Solicitations book, SHEET_ID in Code.gs)
  opportunities: { prop: 'OPP_SHEET_ID',      name: 'CW Open Opportunities',        family: 'sol' },
  invoices:      { prop: 'INVOICES_SHEET_ID', name: 'CW Vendor Invoices',           family: 'sol' },
  documents:     { prop: 'DOCS_SHEET_ID',     name: 'CW Vendor Document Uploads',   family: 'sol' },
  coi:           { prop: 'COI_SHEET_ID',      name: 'CW COI Requests',              family: 'sol' },
  wall:          { prop: 'WALL_SHEET_ID',     name: 'CW Team Wall Announcements',   family: 'sol' },
  vendormsg:     { prop: 'VM_SHEET_ID',       name: 'CW Vendor Messages Log',       family: 'sol' },
  digest:        { prop: 'DIGEST_SHEET_ID',   name: 'CW Email Digest',              family: 'sol' },
  siteadmin:     { prop: 'SA_SHEET_ID',       name: 'CW Site Admin',                family: 'sol' },
  alerts:        { prop: 'ALERTS_SHEET_ID',   name: 'CW Hub Alerts',                family: 'sol' },
  accountfsm:    { prop: 'AF_SHEET_ID',       name: 'CW Account FSM Assignments',   family: 'sol' },
  buildingsheets:{ prop: 'BS_SHEET_ID',       name: 'CW Building Information Sheets', family: 'sol' },   // written by the CW Building Sheets satellite script
  // -------- vendor family (default: CW Vendor Directory, VD_SHEET_ID)
  vendors:       { prop: 'VD_SHEET_ID',       name: 'CW Vendor Directory',          family: 'vd' },
  onboarding:    { prop: 'OB_SHEET_ID',       name: 'CW Vendor Onboarding',         family: 'vd' },
  bgchecks:      { prop: 'BC_SHEET_ID',       name: 'CW Background Checks',         family: 'vd' },
  dne:           { prop: 'DNE_SHEET_ID',      name: 'CW Vendor Do Not Email',       family: 'vd' },
  audits:        { prop: 'AUDIT_SHEET_ID',    name: 'CW Vendor Audits',             family: 'vd' },
  // -------- compliance family (default: CW Violation Notices, VIO_SHEET_ID)
  violations:    { prop: 'VIO_SHEET_ID',      name: 'CW Violation Notices',         family: 'vio' },
  insurance:     { prop: 'INS_SHEET_ID',      name: 'CW Insurance Requests',        family: 'vio' },
  // -------- supplies family (default: CW Building Supplies Reports, SUPPLY_SHEET_ID)
  supplies:      { prop: 'SUPPLY_SHEET_ID',   name: 'CW Building Supplies Reports', family: 'sup' },
  envirox:       { prop: 'ENVIROX_SHEET_ID',  name: 'CW EnvirOx Orders',            family: 'sup' },
  // -------- night ops family (default: CW Night Inspections, NI_SHEET_ID)
  nightinsp:     { prop: 'NI_SHEET_ID',       name: 'CW Night Inspections',         family: 'ni' },
  nightroute:    { prop: 'NR_SHEET_ID',       name: 'CW Night Route Out',           family: 'ni' },
  // -------- team family (default: CW Team Directory, STAFF_SHEET_ID)
  staff:         { prop: 'STAFF_SHEET_ID',    name: 'CW Team Directory',            family: 'staff' },
  exhibita:      { prop: 'EXA_SHEET_ID',      name: 'CW Exhibit A Options',         family: 'staff' }
};

// Which book owns each tab. Anything not listed stays on the family default.
var CW_TAB_BOOK = {
  'Open Opportunities': 'opportunities', 'Responses': 'opportunities',
  'Invoices': 'invoices',
  'Documents': 'documents',
  'COI Requests': 'coi',
  'Announcements': 'wall',
  'Vendor Messages': 'vendormsg',
  'SendConfig': 'digest', 'Digest': 'digest',
  'Site Nav': 'siteadmin', 'Site Admin Log': 'siteadmin',
  'Alert Status': 'alerts',
  'Account FSM': 'accountfsm', 'Account FSM Log': 'accountfsm', 'Alert Assign': 'accountfsm',
  'Building Sheets': 'buildingsheets', 'Building Sheets History': 'buildingsheets',
  'Onboarding': 'onboarding', 'Onboarding Checklist': 'onboarding', 'Onboarding Log': 'onboarding', 'BC Requests': 'onboarding',
  'Background checks Las Vegas': 'bgchecks', 'Background checks Northern Nevada': 'bgchecks', 'BC Notices': 'bgchecks',
  'Do Not Email': 'dne',
  'Audits': 'audits', 'Audit Accounts': 'audits',
  'Insurance': 'insurance', 'InsConfig': 'insurance',
  'EnvirOx Catalog': 'envirox', 'EnvirOx Orders': 'envirox',
  'Routes': 'nightroute', 'AccountChecks': 'nightroute', 'RouteConfig': 'nightroute',
  'Exhibit A Options': 'exhibita'
};

// Old names a tab used to carry. Lets new code run before the tab is renamed.
var CW_TAB_ALIAS = { 'Open Opportunities': ['Solicitations'] };

// Family default book and where its id comes from when nothing else is set.
var CW_FAMILY = {
  sol:   { book: 'opportunities', fallback: function () { return SHEET_ID; } },
  vd:    { book: 'vendors',       fallback: function () { return PropertiesService.getScriptProperties().getProperty('VD_SHEET_ID'); } },
  vio:   { book: 'violations',    fallback: function () { return PropertiesService.getScriptProperties().getProperty('VIO_SHEET_ID'); } },
  sup:   { book: 'supplies',      fallback: function () { return PropertiesService.getScriptProperties().getProperty('SUPPLY_SHEET_ID'); } },
  ni:    { book: 'nightinsp',     fallback: function () { return PropertiesService.getScriptProperties().getProperty('NI_SHEET_ID'); } },
  staff: { book: 'staff',         fallback: function () { return PropertiesService.getScriptProperties().getProperty('STAFF_SHEET_ID'); } }
};

var cwBookCache_ = {};

function cwBookId_(key) {
  var b = CW_BOOKS[key];
  if (!b) throw new Error('Books.gs: unknown workbook key ' + key);
  var id = '';
  try { id = PropertiesService.getScriptProperties().getProperty(b.prop) || ''; } catch (e) { id = ''; }
  if (!id) id = CW_FAMILY[b.family].fallback() || '';
  if (!id) throw new Error('Books.gs: no id for ' + b.name + ' (script property ' + b.prop + ')');
  return id;
}

function cwBook_(key) {
  var id = cwBookId_(key);
  if (!cwBookCache_[id]) cwBookCache_[id] = SpreadsheetApp.openById(id);
  return cwBookCache_[id];
}

// A Spreadsheet look-alike that sends each tab name to its own workbook.
// getUrl / getId / getSheets and friends answer for the anchor book.
function cwRouter_(family, anchorKey) {
  var fam = CW_FAMILY[family];
  var pick = function (tab) {
    var k = CW_TAB_BOOK[String(tab)];
    if (k && CW_BOOKS[k].family !== family) k = null;   // a tab name only routes inside its own family
    return cwBook_(k || fam.book);   // unmapped tabs stay on the family default; the anchor only answers getUrl/getId
  };
  var base = function () { return cwBook_(anchorKey || fam.book); };
  return {
    getSheetByName: function (n) {
      var book = pick(n), sh = book.getSheetByName(n);
      if (!sh && CW_TAB_ALIAS[n]) CW_TAB_ALIAS[n].some(function (old) { sh = book.getSheetByName(old); return !!sh; });
      return sh;
    },
    insertSheet: function (n, idx) { return (idx === undefined) ? pick(n).insertSheet(n) : pick(n).insertSheet(n, idx); },
    getUrl: function () { return base().getUrl(); },
    getId: function () { return base().getId(); },
    getName: function () { return base().getName(); },
    getSheets: function () { return base().getSheets(); },
    deleteSheet: function (s) { return base().deleteSheet(s); },
    rename: function (n) { return base().rename(n); },
    getSpreadsheetTimeZone: function () { return base().getSpreadsheetTimeZone(); },
    addEditor: function (e) { return base().addEditor(e); },
    getBook: base
  };
}

// The old "open the Solicitations book" door. Pass a tab name to anchor
// getUrl() on that tab's book (used in emails that link to a sheet).
function cwSS_(tab) {
  var k = tab ? CW_TAB_BOOK[String(tab)] : '';
  return cwRouter_('sol', (k && CW_BOOKS[k].family === 'sol') ? k : '');
}

// ------------------------------------------------------------ migration
// cwBooksMigrate(): creates every workbook that does not have an id yet,
// copies its tabs over from the family default book, verifies the copy,
// files it in the right Drive folder, then sets the script property.
// Source tabs are left in place; cwBooksArchiveOld() moves them out later.
// Idempotent: a book whose property is already set is skipped.
var CW_BOOK_FOLDERS = {
  opportunities: '1n0l2x944lY8MsMZ9K__w_wMXyERg0mAl',
  invoices: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', documents: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', coi: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47',
  vendormsg: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', vendors: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', onboarding: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47',
  bgchecks: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', dne: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47', audits: '1yzJ1YZoagLN13NJCu9oDOr-wfJxn9T47',
  wall: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH', digest: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH', siteadmin: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH',
  alerts: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH', accountfsm: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH', staff: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH', exhibita: '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH',
  violations: '1Xj1AYoE4Je-Ov8fgnhrIDFwobIohPHJp', insurance: '1Xj1AYoE4Je-Ov8fgnhrIDFwobIohPHJp',
  supplies: '128BpsJS7i6Qm6Nje9QxPJ68FFO-TWUlH', envirox: '128BpsJS7i6Qm6Nje9QxPJ68FFO-TWUlH',
  nightinsp: '1IzeOC_3M7VNB2UKlLjScMeBavuxrfeia', nightroute: '1IzeOC_3M7VNB2UKlLjScMeBavuxrfeia'
};
var CW_ARCHIVE_FOLDER = '1F5SE18kg0Orbwo85N688Oi4HCFp3KVxC';

function cwBookTabs_(key) {
  var out = [];
  Object.keys(CW_TAB_BOOK).forEach(function (t) { if (CW_TAB_BOOK[t] === key) out.push(t); });
  return out;
}

function cwBooksMigrate() {
  var props = PropertiesService.getScriptProperties();
  var report = [];
  Object.keys(CW_BOOKS).forEach(function (key) {
    var b = CW_BOOKS[key];
    if (key === CW_FAMILY[b.family].book) return;          // family defaults keep their file
    if (props.getProperty(b.prop)) { report.push(key + ' :: already set'); return; }
    var srcId = CW_FAMILY[b.family].fallback();
    var src = SpreadsheetApp.openById(srcId);
    var tabs = cwBookTabs_(key);
    var dest = SpreadsheetApp.create(b.name);
    var allOk = true;
    tabs.forEach(function (name) {
      var s = src.getSheetByName(name);
      if (!s) { report.push(key + ' :: ' + name + ' MISSING in source, created empty'); dest.insertSheet(name); return; }
      var c = s.copyTo(dest); c.setName(name);
      var a = s.getDataRange(), d = c.getDataRange();
      var ok = a.getNumRows() === d.getNumRows() && a.getNumColumns() === d.getNumColumns();
      if (!ok) allOk = false;
      report.push(key + ' :: ' + name + ' ' + a.getNumRows() + 'x' + a.getNumColumns() + ' -> ' + d.getNumRows() + 'x' + d.getNumColumns() + (ok ? ' ok' : ' MISMATCH'));
    });
    var def = dest.getSheetByName('Sheet1');
    if (def && dest.getSheets().length > 1) dest.deleteSheet(def);
    try {
      var file = DriveApp.getFileById(dest.getId());
      var folderId = CW_BOOK_FOLDERS[key];
      if (folderId) file.moveTo(DriveApp.getFolderById(folderId));
    } catch (e) { report.push(key + ' :: folder move failed ' + e); }
    if (allOk) { props.setProperty(b.prop, dest.getId()); report.push(key + ' :: LIVE ' + dest.getId()); }
    else report.push(key + ' :: NOT SWITCHED (copy mismatch) ' + dest.getId());
  });
  var text = report.join('\n');
  Logger.log(text);
  return text;
}

// Row-count check after the switch: source tab vs new tab, for every moved tab.
function cwBooksVerify() {
  var report = [];
  Object.keys(CW_TAB_BOOK).forEach(function (tab) {
    var key = CW_TAB_BOOK[tab], b = CW_BOOKS[key];
    if (key === CW_FAMILY[b.family].book) return;
    try {
      var src = SpreadsheetApp.openById(CW_FAMILY[b.family].fallback()).getSheetByName(tab);
      var dst = cwBook_(key).getSheetByName(tab);
      report.push(tab + ' :: old ' + (src ? src.getLastRow() : 'none') + ' new ' + (dst ? dst.getLastRow() : 'none'));
    } catch (e) { report.push(tab + ' :: ' + e); }
  });
  var text = report.join('\n'); Logger.log(text); return text;
}

// Moves the old copies out of the family default books into one archive
// workbook per family, so the live books hold only their own subject.
// Run only after cwBooksVerify() shows old == new for every tab.
function cwBooksArchiveOld() {
  var props = PropertiesService.getScriptProperties();
  var report = [];
  var extra = { sol: ['Supply Orders', 'ARCHIVE Supply Orders', 'ARCHIVE EnvirOx Catalog', 'ARCHIVE EnvirOx Orders', 'Calc Saves', 'Turn Quotes', 'Vendor Directory'],
                sup: ['Inventory Items', 'Inventory Counts', 'Inventory Lines'] };
  Object.keys(CW_FAMILY).forEach(function (family) {
    var srcId = CW_FAMILY[family].fallback();
    var src = SpreadsheetApp.openById(srcId);
    var tabs = [];
    Object.keys(CW_TAB_BOOK).forEach(function (t) {
      var k = CW_TAB_BOOK[t];
      if (CW_BOOKS[k].family === family && k !== CW_FAMILY[family].book && props.getProperty(CW_BOOKS[k].prop)) tabs.push(t);
    });
    (extra[family] || []).forEach(function (t) { tabs.push(t); });
    var present = tabs.filter(function (t) { return !!src.getSheetByName(t); });
    if (!present.length) { report.push(family + ' :: nothing to archive'); return; }
    var arch = SpreadsheetApp.create('ARCHIVE ' + src.getName() + ' old tabs (' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d yyyy') + ')');
    present.forEach(function (t) {
      var s = src.getSheetByName(t);
      var c = s.copyTo(arch); c.setName(t);
      var ok = s.getDataRange().getNumRows() === c.getDataRange().getNumRows() && s.getDataRange().getNumColumns() === c.getDataRange().getNumColumns();
      if (ok && src.getSheets().length > 1) { src.deleteSheet(s); report.push(family + ' :: ' + t + ' archived and removed'); }
      else report.push(family + ' :: ' + t + ' COPY MISMATCH, left in place');
    });
    var def = arch.getSheetByName('Sheet1');
    if (def && arch.getSheets().length > 1) arch.deleteSheet(def);
    try { DriveApp.getFileById(arch.getId()).moveTo(DriveApp.getFolderById(CW_ARCHIVE_FOLDER)); } catch (e) {}
    report.push(family + ' :: archive book ' + arch.getId());
  });
  var text = report.join('\n'); Logger.log(text); return text;
}
