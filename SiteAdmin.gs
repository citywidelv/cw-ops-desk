// ============================================================
// SiteAdmin.gs - the Site Admin hub backend. Sep 13 2026.
// One place to edit the Sheet tabs that drive the hubs, and to edit and
// publish the hub menus, without opening Google Sheets or editing HTML.
//
// Wire-up in doPost (CW Solicitations Code.gs), before doPostBase:
//   if (d && String(d.kind||'').indexOf('sa_') === 0) return saDispatch(d);
//
// Script properties this module needs:
//   SA_PASSCODE  the Site Admin passcode. Only this passcode unlocks sa_ kinds.
//                The team passcode and the Admin (BOM) passcode are refused on
//                purpose: every FSM knows the team passcode, and this module can
//                repoint what every hub links to.
//   GH_TOKEN     a fine-grained GitHub token with Contents: read and write on the
//                five hub repos. Used only by sa_nav_publish to commit nav.js.
//
// Kinds:
//   sa_auth            passcode check
//   sa_surfaces        the whitelist of editable tabs with their headers
//   sa_rows            {surface}                     rows of one tab
//   sa_save            {surface,row,changes:{col:{old,new}}} update cells (optimistic)
//   sa_add             {surface,values:{col:val}}    append a row at getLastRow()+1
//   sa_clear           {surface,row}                 clear a row's contents (never deletes)
//   sa_switches        the three live switches
//   sa_switch_set      {which,value,confirm}         flip one; confirm must equal SA_CONFIRM
//   sa_log             {limit}                       recent changes
//   sa_undo            {log_id}                      put the previous value back
//   sa_nav_get         {hub}                         the draft manifest for a hub
//   sa_nav_save        {hub,nav}                     save a draft (logged)
//   sa_nav_publish     {hub}                         commit nav.js to the hub's repo
//   sa_nav_status                                    draft vs published per hub
//
// Rules this module enforces:
//   * Only whitelisted tabs. There is no "edit any sheet" path.
//   * Fields come from the tab's live header row, so a schema change shows up
//     as a new field instead of a silent mis-map.
//   * Every change writes who / what / when / previous value to the Site Admin
//     Log tab on the CW Solicitations book. Undo reads that row back.
//   * Appends always use getLastRow()+1 (the Service Types tab has spacer rows).
//   * Rows are cleared, never deleted, so nothing below them shifts.
//   * The three live switches are not editable through the generic path.
// ============================================================

var SA_LOG_TAB = 'Site Admin Log';
var SA_NAV_TAB = 'Site Nav';
var SA_LOG_HEADERS = ['log_id', 'when', 'who', 'action', 'surface', 'tab', 'row', 'field', 'old', 'new', 'undone'];
var SA_NAV_HEADERS = ['hub', 'json', 'updated', 'by', 'published', 'published_by', 'published_sha'];
var SA_CONFIRM = 'START EMAILING';
var SA_TZ = 'America/Los_Angeles';
var SA_GH_OWNER = 'citywidelv';
var SA_HUBS = {
  portal: { repo: 'citywidelv.github.io', label: 'Team Portal' },
  ops:    { repo: 'cw-ops-desk',          label: 'Ops Hub' },
  admin:  { repo: 'cw-admin-hub',         label: 'Admin Hub' },
  sales:  { repo: 'sales-hub',            label: 'Sales Hub' },
  vendor: { repo: 'cw-vendor-hub',        label: 'Vendor Hub' }
};

// ---------- the whitelist ----------
// ss: function returning the Spreadsheet. tab: the tab name. mode: 'table' (one
// record per row, header row 1) or 'kv' (key / value rows). locked: keys or
// columns the generic editor may not write. types: input hints per column.
function saSolSS_() { return SpreadsheetApp.openById(SHEET_ID); }
function saSurfaces_() {
  return [
    { key: 'vio_dropdowns', group: 'Violation Notices', label: 'Finding dropdowns', ss: vioSS_, tab: 'Dropdowns', mode: 'table',
      help: 'Each row is one bullet under a finding type. type_key groups them; type_label and hint are read from the first row of a group. Keep items to about ten words.',
      types: { type_key: 'text', type_label: 'text', hint: 'text', item: 'long' } },
    { key: 'vio_issuers', group: 'Violation Notices', label: 'Issuers', ss: vioSS_, tab: 'Issuers', mode: 'table',
      help: 'Who can issue a notice. Inactive issuers stay in the sheet and leave the picker.',
      types: { active: 'bool', email: 'email' } },
    { key: 'vio_config', group: 'Violation Notices', label: 'Settings', ss: vioSS_, tab: 'Config', mode: 'kv', locked: ['live'],
      help: 'Approver names, chargeback rate, links. The live switch is on the Safety Switches tab.' },
    { key: 'ins_config', group: 'Insurance Reminders', label: 'Settings', ss: insSS_, tab: 'InsConfig', mode: 'kv', locked: ['ins_live'],
      help: 'Sender name, batch size, duplicate window, form links. The ins_live switch is on the Safety Switches tab.' },
    { key: 'vd_types', group: 'Vendor Directory', label: 'Service types', ss: vdSS_, tab: 'Service Types', mode: 'table',
      help: 'The tiles on the vendors page. slug must be unique and never change once vendors carry it. Set active FALSE to hide a type.',
      types: { sort: 'number', active: 'bool', description: 'long' }, keyCol: 'slug' },
    { key: 'act_lists', group: 'Account Changes', label: 'Pick lists', ss: actSS_, tab: 'Lists', mode: 'table',
      help: 'fsm, contract_type, ledger_reason and key_ic lists behind the ACT entry form. Blank region means both markets. flag "yes" on a ledger_reason means it needs a new IC.',
      types: { active: 'bool', note: 'long' }, options: { list: ['fsm', 'contract_type', 'ledger_reason', 'key_ic'], region: ['', 'Las Vegas', 'Northern Nevada'] } },
    { key: 'act_config', group: 'Account Changes', label: 'Settings', ss: actSS_, tab: 'Config', mode: 'kv', locked: ['live'],
      help: 'Notification addresses per market. The live switch is on the Safety Switches tab.' },
    { key: 'staff', group: 'Team', label: 'Staff roster', ss: staffSS_, tab: 'Staff', mode: 'table', positional: true,
      help: 'Feeds the Exhibit A builder, COI requests and recognition. Columns are read by position, so never reorder them in the sheet.',
      types: { active: 'bool', email: 'email' },
      options: { role: ['Facility Solutions Manager', 'Night Manager', 'Director of Operations', 'General Manager', 'Business Operations Manager', 'Chief Operating Officer', 'Sales', 'Accounting', 'Other'],
                 market: ['Las Vegas', 'Northern Nevada', 'Both'], territory: ['', 'North', 'West', 'Southwest', 'Southeast', 'Citywide'] } },
    { key: 'staff_options', group: 'Team', label: 'Exhibit A options', ss: staffSS_, tab: 'Exhibit A Options', mode: 'table',
      help: 'Extra line items offered in each section of the Exhibit A builder.',
      types: { active: 'bool' }, options: { section: ['Service Specifications', 'Supplies and Equipment', 'Conduct on Site', 'Required Training'] } },
    { key: 'send_config', group: 'Email', label: 'Send and digest modes', ss: saSolSS_, tab: 'SendConfig', mode: 'kv',
      help: 'Per message tag: send now, queue for the 8am and 4pm digest, weekly rollup, or skip. Anything with an attachment always sends now.',
      options: { value: ['send', 'digest', 'weekly', 'skip'] } },
    { key: 'envirox', group: 'Supplies', label: 'EnvirOx catalog', ss: supSS_, tab: 'EnvirOx Catalog', mode: 'table',
      help: 'Products, pack sizes and price tiers on the EnvirOx order page. tiers is the price ladder the page reads as written.',
      types: { lbs: 'number', star: 'number', active: 'bool', note: 'long', tiers: 'long' }, keyCol: 'sku' },
    { key: 'ac_accounts', group: 'Cleaner Tracker', label: 'Account names', ss: acSS_, tab: 'Accounts', mode: 'table',
      help: 'The account names the cleaner roster form matches typed text against. aliases is comma separated.',
      types: { active: 'bool', aliases: 'long' } },
    { key: 'ac_aliases', group: 'Cleaner Tracker', label: 'Typed-text aliases', ss: acSS_, tab: 'Aliases', mode: 'table',
      help: 'What vendors typed and what it resolves to. kind is account or vendor.',
      options: { kind: ['account', 'vendor'] } }
  ];
}
function saSurface_(key) {
  var list = saSurfaces_();
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}

// ---------- plumbing ----------
function saOut_(o) {
  try { if (typeof _json === 'function') return _json(o); } catch (e) {}
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function saPass_() { return PropertiesService.getScriptProperties().getProperty('SA_PASSCODE') || ''; }
function saStr_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, SA_TZ, 'yyyy-MM-dd HH:mm');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function saNow_() { return Utilities.formatDate(new Date(), SA_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function saWho_(d) { return saStr_(d.who || d.by || '').slice(0, 80) || 'unknown'; }
function saTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color || '#636466').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function saLogSheet_() { return saTab_(saSolSS_(), SA_LOG_TAB, SA_LOG_HEADERS, '#2D2A26'); }
function saNavSheet_() { return saTab_(saSolSS_(), SA_NAV_TAB, SA_NAV_HEADERS, '#2D2A26'); }
function saLog_(who, action, surface, tab, row, field, oldv, newv) {
  var sh = saLogSheet_();
  var id = 'L' + Utilities.formatDate(new Date(), SA_TZ, 'yyMMddHHmmss') + Math.random().toString(36).slice(2, 5).toUpperCase();
  sh.getRange(sh.getLastRow() + 1, 1, 1, SA_LOG_HEADERS.length).setValues([[
    id, saNow_(), who, action, saStr_(surface), saStr_(tab), row === undefined || row === null ? '' : row,
    saStr_(field), saStr_(oldv).slice(0, 49000), saStr_(newv).slice(0, 49000), ''
  ]]);
  return id;
}
// Booleans are written as the strings TRUE / FALSE, which is how every seed on
// the platform writes them and how every reader compares them.
function saTruthy_(v) { var s = saStr_(v).trim().toUpperCase(); return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y'; }
// What the editor sees for a cell: booleans read as TRUE / FALSE whatever the tab stores (1/0, yes).
function saNorm_(v, type) { return type === 'bool' ? (saTruthy_(v) ? 'TRUE' : 'FALSE') : saStr_(v); }
function saCoerce_(v, type) {
  if (type === 'bool') return saTruthy_(v) ? 'TRUE' : 'FALSE';
  if (type === 'number') { var n = Number(String(v).replace(/[$,\s]/g, '')); return isNaN(n) || String(v).trim() === '' ? '' : n; }
  return String(v === null || v === undefined ? '' : v);
}
function saHeaders_(sh) {
  var lastC = sh.getLastColumn();
  if (lastC < 1) return [];
  return sh.getRange(1, 1, 1, lastC).getValues()[0].map(function (h) { return saStr_(h).trim(); });
}
function saTypeOf_(surf, col, sample) {
  if (surf.types && surf.types[col]) return surf.types[col];
  if (surf.options && surf.options[col]) return 'select';
  if (/^(active|hide|hidden|live|star)$/i.test(col)) return 'bool';
  if (sample.length) {
    var allBool = sample.every(function (v) { var s = saStr_(v).toUpperCase(); return s === 'TRUE' || s === 'FALSE' || s === ''; });
    if (allBool && sample.some(function (v) { return saStr_(v) !== ''; })) return 'bool';
  }
  return 'text';
}

// ---------- dispatcher ----------
function saDispatch(d) {
  var kind = String(d.kind || '');
  var pass = saPass_();
  if (!pass) return saOut_({ ok: false, error: 'Site Admin is not set up: no SA_PASSCODE script property.' });
  if ((d.passcode || '') !== pass) return saOut_({ ok: false, error: 'Wrong Site Admin passcode.' });
  try {
    if (kind === 'sa_auth') return saOut_({ ok: true, confirm: SA_CONFIRM, gh: !!PropertiesService.getScriptProperties().getProperty('GH_TOKEN') });
    if (kind === 'sa_surfaces') return saSurfacesList_(d);
    if (kind === 'sa_rows') return saRows_(d);
    if (kind === 'sa_save') return saSave_(d);
    if (kind === 'sa_add') return saAdd_(d);
    if (kind === 'sa_clear') return saClear_(d);
    if (kind === 'sa_switches') return saSwitches_(d);
    if (kind === 'sa_switch_set') return saSwitchSet_(d);
    if (kind === 'sa_log') return saLogList_(d);
    if (kind === 'sa_undo') return saUndo_(d);
    if (kind === 'sa_nav_get') return saNavGet_(d);
    if (kind === 'sa_nav_save') return saNavSave_(d);
    if (kind === 'sa_nav_publish') return saNavPublish_(d);
    if (kind === 'sa_nav_status') return saNavStatus_(d);
    return saOut_({ ok: false, error: 'Unknown sa kind: ' + kind });
  } catch (err) {
    return saOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------- surfaces and rows ----------
function saSurfacesList_(d) {
  var out = saSurfaces_().map(function (s) {
    return { key: s.key, group: s.group, label: s.label, tab: s.tab, mode: s.mode, help: s.help || '',
      locked: s.locked || [], positional: !!s.positional, options: s.options || {}, keyCol: s.keyCol || '' };
  });
  return saOut_({ ok: true, surfaces: out, confirm: SA_CONFIRM });
}
function saOpen_(surf) {
  var ss = surf.ss();
  var sh = ss.getSheetByName(surf.tab);
  if (!sh) throw new Error('Tab "' + surf.tab + '" was not found on its book. Run that module\'s setup first.');
  return { ss: ss, sh: sh };
}
function saRows_(d) {
  var surf = saSurface_(String(d.surface || ''));
  if (!surf) return saOut_({ ok: false, error: 'Not an editable surface.' });
  var o = saOpen_(surf), sh = o.sh;
  var head = saHeaders_(sh);
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  var cols = head.filter(Boolean).map(function (h, c) {
    var sample = vals.slice(0, 40).map(function (r) { return r[head.indexOf(h)]; });
    return { name: h, type: saTypeOf_(surf, h, sample), options: surf.options && surf.options[h] ? surf.options[h] : null,
      locked: surf.mode === 'kv' ? h === 'key' : false };
  });
  var typeOf = {}; cols.forEach(function (c) { typeOf[c.name] = c.type; });
  var rows = [];
  vals.forEach(function (r, i) {
    var rec = { _row: i + 2 }, any = false;
    head.forEach(function (h, c) { if (!h) return; if (saStr_(r[c]) !== '') any = true; rec[h] = saNorm_(r[c], typeOf[h]); });
    if (any) rows.push(rec);
  });
  return saOut_({ ok: true, surface: surf.key, tab: surf.tab, mode: surf.mode, cols: cols, rows: rows,
    locked: surf.locked || [], url: o.ss.getUrl() + '#gid=' + sh.getSheetId(), last_row: last });
}
// Optimistic concurrency: each change carries the value the editor saw. If the
// cell has moved on since, nothing is written and the caller is told which field.
function saSave_(d) {
  var surf = saSurface_(String(d.surface || ''));
  if (!surf) return saOut_({ ok: false, error: 'Not an editable surface.' });
  var row = Number(d.row);
  if (!(row >= 2)) return saOut_({ ok: false, error: 'Bad row.' });
  var changes = d.changes || {};
  var o = saOpen_(surf), sh = o.sh;
  var head = saHeaders_(sh);
  var cur = sh.getRange(row, 1, 1, head.length).getValues()[0];
  var who = saWho_(d);
  var keyIdx = head.indexOf('key');
  if (surf.mode === 'kv') {
    var k = saStr_(cur[keyIdx]);
    if ((surf.locked || []).indexOf(k) >= 0) return saOut_({ ok: false, error: '"' + k + '" is a safety switch. Use the Safety Switches tab.' });
    if (changes.key !== undefined) return saOut_({ ok: false, error: 'Keys cannot be renamed; code reads them by name.' });
  }
  var written = [], stale = [], ids = [];
  Object.keys(changes).forEach(function (col) {
    var c = head.indexOf(col);
    if (c < 0) { stale.push(col + ' (no such column)'); return; }
    if (surf.mode === 'table' && surf.keyCol === col && saStr_(cur[c]) !== '') { stale.push(col + ' (the key column cannot change once set)'); return; }
    var ch = changes[col] || {};
    var type = saTypeOf_(surf, col, []);
    var oldSeen = saNorm_(ch.old, type), now = saNorm_(cur[c], type);
    if (oldSeen !== now) { stale.push(col); return; }
    var nv = saCoerce_(ch['new'], type);
    if (saStr_(nv) === now) return;
    sh.getRange(row, c + 1).setValue(nv);
    ids.push(saLog_(who, 'edit', surf.key, surf.tab, row, col, saStr_(cur[c]), nv));
    written.push(col);
  });
  if (stale.length && !written.length) return saOut_({ ok: false, error: 'Changed by someone else since you loaded it: ' + stale.join(', ') + '. Reload and try again.', stale: stale });
  return saOut_({ ok: true, written: written, stale: stale, log_ids: ids });
}
function saAdd_(d) {
  var surf = saSurface_(String(d.surface || ''));
  if (!surf) return saOut_({ ok: false, error: 'Not an editable surface.' });
  var o = saOpen_(surf), sh = o.sh;
  var head = saHeaders_(sh);
  var values = d.values || {};
  var who = saWho_(d);
  if (surf.mode === 'kv') {
    var k = saStr_(values.key).trim();
    if (!k) return saOut_({ ok: false, error: 'A key is required.' });
    if ((surf.locked || []).indexOf(k) >= 0) return saOut_({ ok: false, error: 'That key is a safety switch.' });
    var have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    for (var i = 0; i < have.length; i++) if (saStr_(have[i][0]).trim() === k) return saOut_({ ok: false, error: 'Key "' + k + '" already exists.' });
  }
  if (surf.keyCol) {
    var kv = saStr_(values[surf.keyCol]).trim();
    if (!kv) return saOut_({ ok: false, error: surf.keyCol + ' is required.' });
    var kc = head.indexOf(surf.keyCol);
    var col = sh.getLastRow() > 1 ? sh.getRange(2, kc + 1, sh.getLastRow() - 1, 1).getValues() : [];
    for (var j = 0; j < col.length; j++) if (saStr_(col[j][0]).trim() === kv) return saOut_({ ok: false, error: surf.keyCol + ' "' + kv + '" already exists.' });
  }
  var row = head.map(function (h) {
    if (!h) return '';
    var type = saTypeOf_(surf, h, []);
    if (values[h] === undefined) return type === 'bool' ? 'TRUE' : '';
    return saCoerce_(values[h], type);
  });
  if (!row.some(function (v) { return saStr_(v) !== '' && saStr_(v) !== 'TRUE' && saStr_(v) !== 'FALSE'; })) return saOut_({ ok: false, error: 'Nothing to add.' });
  var at = sh.getLastRow() + 1;   // never the first blank in column A: some tabs carry spacer rows
  sh.getRange(at, 1, 1, row.length).setValues([row]);
  var id = saLog_(who, 'add', surf.key, surf.tab, at, '', '', JSON.stringify(row));
  return saOut_({ ok: true, row: at, log_id: id });
}
function saClear_(d) {
  var surf = saSurface_(String(d.surface || ''));
  if (!surf) return saOut_({ ok: false, error: 'Not an editable surface.' });
  if (surf.positional) return saOut_({ ok: false, error: 'This tab is read by position. Set active FALSE instead of clearing.' });
  var row = Number(d.row);
  if (!(row >= 2)) return saOut_({ ok: false, error: 'Bad row.' });
  var o = saOpen_(surf), sh = o.sh;
  var head = saHeaders_(sh);
  var cur = sh.getRange(row, 1, 1, head.length).getValues()[0].map(saStr_);
  if (surf.mode === 'kv' && (surf.locked || []).indexOf(cur[head.indexOf('key')]) >= 0) return saOut_({ ok: false, error: 'That row is a safety switch.' });
  sh.getRange(row, 1, 1, head.length).clearContent();
  var id = saLog_(saWho_(d), 'clear', surf.key, surf.tab, row, '', JSON.stringify(cur), '');
  return saOut_({ ok: true, log_id: id });
}

// ---------- the three live switches ----------
function saSwitchDefs_() {
  return [
    { which: 'vio', label: 'Violation notices', ss: vioSS_, tab: 'Config', key: 'live', what: 'When TRUE, violation notices email the vendor. When FALSE, every notice goes to the test address instead.' },
    { which: 'ins', label: 'Insurance reminders', ss: insSS_, tab: 'InsConfig', key: 'ins_live', what: 'When TRUE, COI reminders email vendors. When FALSE, every reminder goes to ins_test_to instead.' },
    { which: 'act', label: 'Account change notifications', ss: actSS_, tab: 'Config', key: 'live', what: 'When TRUE, account change notifications go to the notify lists. When FALSE, they go to test_to instead.' }
  ];
}
function saSwitchCell_(def) {
  var sh = def.ss().getSheetByName(def.tab);
  if (!sh) return null;
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  for (var i = 1; i < vals.length; i++) if (saStr_(vals[i][0]).trim() === def.key) return { sh: sh, row: i + 1, value: saStr_(vals[i][1]).toUpperCase() === 'TRUE' };
  return { sh: sh, row: 0, value: false };
}
function saSwitches_(d) {
  var out = saSwitchDefs_().map(function (def) {
    var c = null, err = '';
    try { c = saSwitchCell_(def); } catch (e) { err = String(e); }
    return { which: def.which, label: def.label, tab: def.tab, key: def.key, what: def.what, value: c ? c.value : null, error: err || (c ? '' : 'tab missing') };
  });
  return saOut_({ ok: true, switches: out, confirm: SA_CONFIRM });
}
function saSwitchSet_(d) {
  var def = saSwitchDefs_().filter(function (x) { return x.which === String(d.which || ''); })[0];
  if (!def) return saOut_({ ok: false, error: 'Unknown switch.' });
  var want = String(d.value).toUpperCase() === 'TRUE';
  if (want && String(d.confirm || '') !== SA_CONFIRM) return saOut_({ ok: false, error: 'Type ' + SA_CONFIRM + ' to turn a live switch on.' });
  var c = saSwitchCell_(def);
  if (!c) return saOut_({ ok: false, error: 'Tab missing.' });
  if (c.row === 0) { c.row = c.sh.getLastRow() + 1; c.sh.getRange(c.row, 1).setValue(def.key); }
  var oldv = c.value ? 'TRUE' : 'FALSE', nv = want ? 'TRUE' : 'FALSE';
  c.sh.getRange(c.row, 2).setValue(nv);
  var id = saLog_(saWho_(d), 'switch', def.which, def.tab, c.row, def.key, oldv, nv);
  return saOut_({ ok: true, value: want, log_id: id });
}

// ---------- log and undo ----------
function saLogList_(d) {
  var sh = saLogSheet_();
  var last = sh.getLastRow();
  var limit = Math.min(Number(d.limit) || 100, 500);
  if (last < 2) return saOut_({ ok: true, rows: [] });
  var from = Math.max(2, last - limit + 1);
  var vals = sh.getRange(from, 1, last - from + 1, SA_LOG_HEADERS.length).getValues();
  var rows = vals.map(function (r, i) {
    var o = { _row: from + i };
    SA_LOG_HEADERS.forEach(function (h, c) { o[h] = saStr_(r[c]); });
    if (o.old.length > 400) o.old = o.old.slice(0, 400) + '...';
    if (o['new'].length > 400) o['new'] = o['new'].slice(0, 400) + '...';
    return o;
  }).reverse();
  return saOut_({ ok: true, rows: rows });
}
function saLogFind_(id) {
  var sh = saLogSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (saStr_(ids[i][0]) === id) {
    var r = sh.getRange(i + 2, 1, 1, SA_LOG_HEADERS.length).getValues()[0];
    var o = { _row: i + 2 };
    SA_LOG_HEADERS.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  }
  return null;
}
function saUndo_(d) {
  var e = saLogFind_(String(d.log_id || ''));
  if (!e) return saOut_({ ok: false, error: 'Log entry not found.' });
  if (saStr_(e.undone)) return saOut_({ ok: false, error: 'Already undone.' });
  var who = saWho_(d), action = saStr_(e.action), row = Number(e.row);
  var logSh = saLogSheet_();
  function markUndone(newId) { logSh.getRange(e._row, SA_LOG_HEADERS.indexOf('undone') + 1).setValue(newId); }
  if (action === 'switch') {
    var def = saSwitchDefs_().filter(function (x) { return x.which === saStr_(e.surface); })[0];
    var c = saSwitchCell_(def);
    c.sh.getRange(c.row, 2).setValue(saStr_(e.old));
    var sid = saLog_(who, 'undo', def.which, def.tab, c.row, def.key, saStr_(e['new']), saStr_(e.old));
    markUndone(sid); return saOut_({ ok: true, log_id: sid });
  }
  if (action === 'nav_save') {
    var hub = saStr_(e.surface);
    var cur = saNavRow_(hub);
    if (!cur) return saOut_({ ok: false, error: 'No draft row for ' + hub });
    cur.sh.getRange(cur.row, 2).setValue(saStr_(e.old));
    cur.sh.getRange(cur.row, 3, 1, 2).setValues([[saNow_(), who]]);
    var nid = saLog_(who, 'undo', hub, SA_NAV_TAB, cur.row, 'json', saStr_(e['new']), saStr_(e.old));
    markUndone(nid); return saOut_({ ok: true, log_id: nid, note: 'Draft restored. Publish again to push it live.' });
  }
  var surf = saSurface_(saStr_(e.surface));
  if (!surf) return saOut_({ ok: false, error: 'That surface is no longer editable.' });
  var o = saOpen_(surf), sh = o.sh, head = saHeaders_(sh);
  if (action === 'edit') {
    var c2 = head.indexOf(saStr_(e.field));
    if (c2 < 0) return saOut_({ ok: false, error: 'Column ' + e.field + ' no longer exists.' });
    var now = saStr_(sh.getRange(row, c2 + 1).getValue());
    if (now !== saStr_(e['new'])) return saOut_({ ok: false, error: 'That cell has changed again since (now "' + now + '"). Edit it directly instead.' });
    var type = saTypeOf_(surf, saStr_(e.field), []);
    sh.getRange(row, c2 + 1).setValue(saCoerce_(e.old, type));
    var uid = saLog_(who, 'undo', surf.key, surf.tab, row, saStr_(e.field), now, saStr_(e.old));
    markUndone(uid); return saOut_({ ok: true, log_id: uid });
  }
  if (action === 'add') {
    var cur2 = sh.getRange(row, 1, 1, head.length).getValues()[0].map(saStr_);
    var was = JSON.parse(saStr_(e['new'])).map(saStr_);
    if (cur2.join('') !== was.join('')) return saOut_({ ok: false, error: 'That row has been edited since it was added. Clear it directly instead.' });
    sh.getRange(row, 1, 1, head.length).clearContent();
    var aid = saLog_(who, 'undo', surf.key, surf.tab, row, '', saStr_(e['new']), '');
    markUndone(aid); return saOut_({ ok: true, log_id: aid });
  }
  if (action === 'clear') {
    var cur3 = sh.getRange(row, 1, 1, head.length).getValues()[0].map(saStr_);
    if (cur3.some(function (v) { return v !== ''; })) return saOut_({ ok: false, error: 'That row is no longer empty.' });
    var back = JSON.parse(saStr_(e.old));
    sh.getRange(row, 1, 1, back.length).setValues([back]);
    var cid = saLog_(who, 'undo', surf.key, surf.tab, row, '', '', saStr_(e.old));
    markUndone(cid); return saOut_({ ok: true, log_id: cid });
  }
  return saOut_({ ok: false, error: 'Cannot undo a ' + action + ' entry.' });
}

// ---------- navigation manifests ----------
function saNavRow_(hub) {
  var sh = saNavSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, SA_NAV_HEADERS.length).getValues();
  for (var i = 0; i < vals.length; i++) if (saStr_(vals[i][0]) === hub) {
    var o = { sh: sh, row: i + 2 };
    SA_NAV_HEADERS.forEach(function (h, c) { o[h] = saStr_(vals[i][c]); });
    return o;
  }
  return null;
}
function saNavValidate_(nav) {
  if (!nav || typeof nav !== 'object') return 'Manifest is not an object.';
  if (!SA_HUBS[nav.hub]) return 'Unknown hub "' + nav.hub + '".';
  if (!Array.isArray(nav.menu)) return 'menu must be an array.';
  var bad = '';
  function walk(list, depth, path) {
    if (bad) return;
    if (!Array.isArray(list)) { bad = path + ' items must be an array.'; return; }
    list.forEach(function (it, i) {
      if (bad || !it || typeof it !== 'object') { bad = bad || path + '[' + i + '] is not an item.'; return; }
      if (it.ghead !== undefined) { if (!saStr_(it.ghead).trim()) bad = path + '[' + i + '] blank group heading.'; return; }
      if (it.sub !== undefined) { if (depth > 0) { bad = path + '[' + i + '] cascades cannot nest twice.'; return; } walk(it.items || [], depth + 1, path + '[' + i + '].items'); return; }
      if (!saStr_(it.label).trim()) { bad = path + '[' + i + '] link has no label.'; return; }
      if (it.items !== undefined) { walk(it.items, depth + 1, path + '[' + i + '].items'); return; }
      if (!saStr_(it.href).trim()) { bad = path + '[' + i + '] "' + it.label + '" has no href.'; return; }
      if (/[<>"'\s]/.test(String(it.href))) { bad = path + '[' + i + '] "' + it.label + '" href has an unsafe character.'; return; }
      if (/^javascript:/i.test(String(it.href).trim())) { bad = path + '[' + i + '] javascript: links are not allowed.'; return; }
    });
  }
  nav.menu.forEach(function (top, i) {
    if (bad) return;
    if (!top || typeof top !== 'object' || !saStr_(top.label).trim()) { bad = 'menu[' + i + '] has no label.'; return; }
    if (top.items !== undefined) walk(top.items, 0, 'menu[' + i + '].items');
    else if (!saStr_(top.href).trim()) bad = 'menu[' + i + '] "' + top.label + '" needs items or an href.';
  });
  if (!bad && nav.quick !== undefined) walk(nav.quick, 0, 'quick');
  return bad;
}
function saNavGet_(d) {
  var hub = String(d.hub || '');
  if (!SA_HUBS[hub]) return saOut_({ ok: false, error: 'Unknown hub.' });
  var r = saNavRow_(hub);
  if (!r) return saOut_({ ok: true, hub: hub, nav: null, note: 'No draft yet. Load the published menu first.' });
  var nav = null;
  try { nav = JSON.parse(r.json); } catch (e) { return saOut_({ ok: false, error: 'Draft JSON is corrupt: ' + e }); }
  return saOut_({ ok: true, hub: hub, nav: nav, updated: r.updated, by: r.by, published: r.published, published_by: r.published_by, published_sha: r.published_sha,
    dirty: r.published_sha ? (saNavSha_(r.json) !== r.published_sha) : true });
}
function saNavSha_(json) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, json, Utilities.Charset.UTF_8);
  return raw.map(function (b) { var s = (b < 0 ? b + 256 : b).toString(16); return s.length < 2 ? '0' + s : s; }).join('').slice(0, 12);
}
function saNavSave_(d) {
  var nav = d.nav;
  if (typeof nav === 'string') { try { nav = JSON.parse(nav); } catch (e) { return saOut_({ ok: false, error: 'Bad JSON.' }); } }
  var hub = String(d.hub || nav && nav.hub || '');
  if (nav) nav.hub = hub;
  var why = saNavValidate_(nav);
  if (why) return saOut_({ ok: false, error: why });
  var who = saWho_(d);
  var json = JSON.stringify(nav);
  if (json.length > 49000) return saOut_({ ok: false, error: 'Manifest is too large for one cell (' + json.length + ' chars).' });
  var r = saNavRow_(hub);
  var sh = saNavSheet_();
  if (!r) {
    var at = sh.getLastRow() + 1;
    sh.getRange(at, 1, 1, SA_NAV_HEADERS.length).setValues([[hub, json, saNow_(), who, '', '', '']]);
    var id0 = saLog_(who, 'nav_save', hub, SA_NAV_TAB, at, 'json', '', json);
    return saOut_({ ok: true, log_id: id0, created: true, sha: saNavSha_(json) });
  }
  if (r.json === json) return saOut_({ ok: true, unchanged: true, sha: saNavSha_(json) });
  sh.getRange(r.row, 2, 1, 3).setValues([[json, saNow_(), who]]);
  var id = saLog_(who, 'nav_save', hub, SA_NAV_TAB, r.row, 'json', r.json, json);
  return saOut_({ ok: true, log_id: id, sha: saNavSha_(json) });
}
function saNavJs_(nav, who) {
  var stamp = saNow_();
  return '/* nav.js for the ' + SA_HUBS[nav.hub].label + '. GENERATED by the Site Admin hub on ' + stamp + ' by ' + who + '.\n' +
    '   Do not edit by hand: the next publish overwrites it. Edit at cw-admin-hub/site-admin.html.\n' +
    '   The page keeps its own MENU as a fallback if this file is missing or malformed. */\n' +
    'window.CW_NAV = ' + JSON.stringify(saNavStamped_(nav, stamp, who), null, 1) + ';\n';
}
function saNavStamped_(nav, stamp, who) {
  var o = { hub: nav.hub, build: stamp, by: who };
  Object.keys(nav).forEach(function (k) { if (k !== 'hub' && k !== 'build' && k !== 'by') o[k] = nav[k]; });
  return o;
}
function saGh_(method, url, body) {
  var token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) throw new Error('No GH_TOKEN script property. Publishing needs a fine-grained GitHub token with Contents write on the hub repos.');
  var opts = { method: method, muteHttpExceptions: true, headers: {
    Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var txt = res.getContentText();
  var js = null; try { js = JSON.parse(txt); } catch (e) {}
  return { code: code, body: js, text: txt };
}
function saNavPublish_(d) {
  var hub = String(d.hub || '');
  if (!SA_HUBS[hub]) return saOut_({ ok: false, error: 'Unknown hub.' });
  var r = saNavRow_(hub);
  if (!r) return saOut_({ ok: false, error: 'Nothing saved for this hub yet.' });
  var nav = JSON.parse(r.json);
  var why = saNavValidate_(nav);
  if (why) return saOut_({ ok: false, error: 'Draft is invalid: ' + why });
  var who = saWho_(d);
  var content = saNavJs_(nav, who);
  var repo = SA_HUBS[hub].repo;
  var url = 'https://api.github.com/repos/' + SA_GH_OWNER + '/' + repo + '/contents/nav.js';
  var cur = saGh_('get', url + '?ref=main');
  var sha = cur.code === 200 && cur.body && cur.body.sha ? cur.body.sha : null;
  if (cur.code !== 200 && cur.code !== 404) return saOut_({ ok: false, error: 'GitHub read failed (' + cur.code + '): ' + (cur.body && cur.body.message || cur.text).slice(0, 200) });
  var body = { message: 'Site Admin: publish ' + SA_HUBS[hub].label + ' menu (' + who + ')', content: Utilities.base64Encode(content, Utilities.Charset.UTF_8), branch: 'main' };
  if (sha) body.sha = sha;
  var put = saGh_('put', url, body);
  if (put.code !== 200 && put.code !== 201) return saOut_({ ok: false, error: 'GitHub write failed (' + put.code + '): ' + (put.body && put.body.message || put.text).slice(0, 200) });
  var commit = put.body && put.body.commit ? put.body.commit : {};
  var draftSha = saNavSha_(r.json);
  r.sh.getRange(r.row, 5, 1, 3).setValues([[saNow_(), who, draftSha]]);
  var id = saLog_(who, 'nav_publish', hub, repo + '/nav.js', r.row, 'commit', r.published_sha, (commit.sha || '') + ' ' + (commit.html_url || ''));
  return saOut_({ ok: true, log_id: id, commit: commit.sha || '', url: commit.html_url || '', sha: draftSha,
    note: 'Committed. GitHub Pages takes a minute or two to serve it, and the CDN can hold the old file for up to ten.' });
}
function saNavStatus_(d) {
  var out = {};
  Object.keys(SA_HUBS).forEach(function (hub) {
    var r = saNavRow_(hub);
    out[hub] = { label: SA_HUBS[hub].label, repo: SA_HUBS[hub].repo, draft: !!r, updated: r ? r.updated : '', by: r ? r.by : '',
      published: r ? r.published : '', published_by: r ? r.published_by : '', dirty: r ? (!r.published_sha || saNavSha_(r.json) !== r.published_sha) : false };
  });
  return saOut_({ ok: true, hubs: out });
}

// Runner helper: paste into cwRunNow to sanity-check the whitelist opens every tab.
function saCheckSurfacesRun() {
  saSurfaces_().forEach(function (s) {
    try { var o = saOpen_(s); Logger.log(s.key + ': ok, ' + saHeaders_(o.sh).join('|') + ' rows=' + o.sh.getLastRow()); }
    catch (e) { Logger.log(s.key + ': ' + e); }
  });
}
