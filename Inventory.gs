/* ==========================================================================
   OFFICE INVENTORY  (inventory*.html in cw-ops-desk)
   Rebuilt Sep 2026 as a perpetual inventory. Self contained: it does not
   depend on helpers in the other files of this project.

   Router: doPost sends every kind starting with inv_ to invDispatch.
     inv_catalog    items, live on hand, and what is expected at the count
     inv_save       a physical count. Resets the book and writes exceptions
     inv_move       receiving, sales, comps and other movements
     inv_onhand     the live on hand view and the exception report
     inv_moves      recent movement history

   Book: its OWN spreadsheet, "CW Inventory", created on first run and held
   in script property INV_SHEET_ID. Nothing here writes to CW Solicitations
   or CW Supply and Inventory. Tabs:
     Items        the catalog. Edit items and the levels we keep HERE.
                  par = one number for the item. size_pars = "S:5;M:5" and
                  wins for apparel, counted across colors for that size.
     Movements    every receipt, sale, comp, issue and transfer, one row each
     Counts       one row per physical count
     Count Lines  one row per item on a count, with the movement breakdown
     On Hand      rewritten after every write so the Sheet always shows stock
     Exceptions   one row per counted variance, with the movements behind it

   The math. A count resets the book for that item in that office. After
   that, on hand = counted at the last count, plus every movement DATED
   AFTER the count date. A movement dated on or before the last count is
   already inside the counted number, so it explains a variance but never
   moves on hand.
   ========================================================================== */

var INV_BOOK_NAME = 'CW Inventory';
var INV_ITEM_TAB  = 'Items';
var INV_MOVE_TAB  = 'Movements';
var INV_COUNT_TAB = 'Counts';
var INV_LINE_TAB  = 'Count Lines';
var INV_HAND_TAB  = 'On Hand';
var INV_EXC_TAB   = 'Exceptions';

var INV_ITEM_HEADERS = ['sku','name','group','unit','cost','par','image','sizes','colors',
  'act_order','note','active','size_pars'];
var INV_MOVE_HEADERS = ['move_id','logged','region','type','direction','move_date','sku','item',
  'size','color','qty','reason','reference','party','entered_by','email','notes','count_id'];
var INV_COUNT_HEADERS = ['count_id','submitted','region','entity','period','count_date',
  'counted_by','email','items_counted','variance_lines','units_to_order','total_value','notes'];
var INV_LINE_HEADERS = ['count_id','submitted','region','period','count_date','sku','item','size',
  'color','opening','received','sold','comped','issued','other','expected','counted','variance',
  'cost','value','to_order','notes'];
var INV_HAND_HEADERS = ['region','sku','item','size','color','on_hand','par','to_order',
  'last_count_date','last_count_qty','received_since','sold_since','comped_since','issued_since',
  'other_since','cost','value','updated'];
var INV_EXC_HEADERS = ['count_id','count_date','region','sku','item','size','color','expected',
  'counted','variance','value_impact','window_from','window_to','movements','status','note'];

var INV_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var INV_OWNER_EMAIL = 'tjroberts@gocitywide.com';

/* Movement types. dir 1 adds to stock, -1 takes it out, 0 is a marker. */
var INV_TYPES = {
  receipt:     { dir:  1, label: 'Received' },
  found:       { dir:  1, label: 'Found in stock' },
  transfer_in: { dir:  1, label: 'Transferred in' },
  sale:        { dir: -1, label: 'Sold' },
  comp:        { dir: -1, label: 'Comped' },
  issue:       { dir: -1, label: 'Issued out' },
  damage:      { dir: -1, label: 'Damaged or expired' },
  transfer_out:{ dir: -1, label: 'Transferred out' },
  lost:        { dir: -1, label: 'Missing' },
  count:       { dir:  0, label: 'Counted' }
};
function invDir_(type) {
  var t = INV_TYPES[String(type || '')];
  return t ? t.dir : 0;
}

var INV_REGION = {
  'Las Vegas':       { inbox: 'lvservicecall@gocitywide.com', entity: 'Low Drag LLC',
                       sender: 'City Wide Las Vegas Ops' },
  'Northern Nevada': { inbox: 'rnservicecall@gocitywide.com', entity: 'Dash Two LLC',
                       sender: 'City Wide Northern Nevada Ops' }
};
function invRegion_(r) {
  var key = String(r || 'Las Vegas');
  if (key === 'NNV' || key === 'nnv') key = 'Northern Nevada';
  if (key === 'LV'  || key === 'lv')  key = 'Las Vegas';
  return INV_REGION[key] ? { name: key, cfg: INV_REGION[key] }
                         : { name: 'Las Vegas', cfg: INV_REGION['Las Vegas'] };
}

/* ------------------------------------------------------------- the book -- */
function invSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = '';
  try { id = props.getProperty('INV_SHEET_ID') || ''; } catch (e) {}
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e2) { id = ''; }
  }
  var ss = SpreadsheetApp.create(INV_BOOK_NAME);
  props.setProperty('INV_SHEET_ID', ss.getId());
  try { DriveApp.getFileById(ss.getId()).addEditor(INV_OWNER_EMAIL); } catch (e3) {}
  return ss;
}
function invSheet_(name, headers, color) {
  var ss = invSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first && first.getName() === 'Sheet1' && ss.getSheets().length === 1 && first.getLastRow() < 2) {
      sh = first; sh.setName(name);
    } else {
      sh = ss.insertSheet(name);
    }
  }
  var head = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < headers.length; i++) if (String(head[i] || '') !== headers[i]) needs = true;
  if (needs) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function invJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function invEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function invNum_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function invMoney_(n) { return '$' + (Math.round(invNum_(n) * 100) / 100).toFixed(2); }
function invKey_(sku, size, color) {
  return String(sku || '') + '|' + String(size || '') + '|' + String(color || '');
}
/* Dates are compared as plain days, so a time of day never decides a variance. */
function invDay_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd');
}
function invToday_() {
  return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
}
function invId_(prefix, region) {
  return prefix + '-' + (region === 'Northern Nevada' ? 'NNV' : 'LV') + '-' +
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
}

/* Safe to re-run. Builds every tab, seeds the item list once, and seeds the
   Las Vegas opening balance from the August 2026 ACT count. */
function setupInventory() {
  var items = invSheet_(INV_ITEM_TAB, INV_ITEM_HEADERS, '#2D2A26');
  invSheet_(INV_MOVE_TAB, INV_MOVE_HEADERS, '#636466');
  invSheet_(INV_COUNT_TAB, INV_COUNT_HEADERS, '#D22730');
  invSheet_(INV_LINE_TAB, INV_LINE_HEADERS, '#636466');
  invSheet_(INV_HAND_TAB, INV_HAND_HEADERS, '#1E7B34');
  invSheet_(INV_EXC_TAB, INV_EXC_HEADERS, '#B01F27');
  if (items.getLastRow() < 2) {
    items.getRange(2, 1, INV_SEED.length, INV_ITEM_HEADERS.length).setValues(INV_SEED);
  }
  invSeedOpening_();
  invRebuildOnHand_();
  return invSS_().getUrl();
}

/* The Las Vegas August 2026 ACT count, loaded once as the opening balance so
   the book starts where the paper record left off. Northern Nevada has no
   inventory history on its ACT, so it starts at its first count. */
var INV_OPENING_LV = {
  'A8-112L': 15, 'A8-112H': 35, 'A-112-02H': 16, '117-06SQ-EA': 0,
  '122-06Q-EA': 11, '138-12Q-EA': 22, 'UNI-APRON': 7, 'UNI-VEST': 10
};
var INV_OPENING_ID = 'INV-LV-260831-ACT';
var INV_OPENING_DATE = '2026-08-31';
function invSeedOpening_() {
  var cs = invSheet_(INV_COUNT_TAB, INV_COUNT_HEADERS, '#D22730');
  if (cs.getLastRow() > 1) {
    var ids = cs.getRange(2, 1, cs.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === INV_OPENING_ID) return 'already seeded';
  }
  var when = new Date(INV_OPENING_DATE + 'T12:00:00-07:00');
  var items = invItems_();
  var lines = [];
  items.forEach(function (it) {
    if (INV_OPENING_LV[it.sku] === undefined) return;
    var q = invNum_(INV_OPENING_LV[it.sku]);
    // Apparel opening is not known by size, so it lands on a blank size and the
    // first real count by size replaces it.
    lines.push([INV_OPENING_ID, when, 'Las Vegas', 'August 2026', INV_OPENING_DATE, it.sku, it.name,
      '', '', 0, 0, 0, 0, 0, 0, 0, q, 0, it.cost, Math.round(q * it.cost * 100) / 100, '',
      'Opening balance from the August 2026 ACT count']);
  });
  if (!lines.length) return 'no items to seed';
  var ls = invSheet_(INV_LINE_TAB, INV_LINE_HEADERS, '#636466');
  ls.getRange(ls.getLastRow() + 1, 1, lines.length, INV_LINE_HEADERS.length).setValues(lines);
  cs.appendRow([INV_OPENING_ID, when, 'Las Vegas', 'Low Drag LLC', 'August 2026', INV_OPENING_DATE,
    'ACT Document', '', lines.length, 0, 0, 0,
    'Opening balance loaded from the Office Inventory block of the Las Vegas ACT']);
  return 'seeded ' + lines.length + ' opening lines';
}

/* ------------------------------------------------------------------ read -- */
function invItems_() {
  var sh = invSheet_(INV_ITEM_TAB, INV_ITEM_HEADERS, '#2D2A26');
  if (sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, INV_ITEM_HEADERS.length).getValues();
  var out = [];
  vals.forEach(function (v) {
    if (String(v[0]) === '') return;
    var act = String(v[11]);
    if (act === '0' || act.toLowerCase() === 'false') return;
    out.push({ sku: String(v[0]), name: String(v[1]), grp: String(v[2]), unit: String(v[3]),
      cost: invNum_(v[4]), par: invNum_(v[5]), image: String(v[6]),
      sizes: String(v[7] || '').split('|').filter(function (s) { return s !== ''; }),
      colors: String(v[8] || '').split('|').filter(function (s) { return s !== ''; }),
      act: invNum_(v[9]), note: String(v[10]), spars: String(v[12] || '') });
  });
  return out;
}
function invRows_(tab, headers) {
  var sh = invSheet_(tab, headers, '#636466');
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues()
    .filter(function (r) { return String(r[0]) !== ''; });
}

/* The last count per region, as {region: {count_id, date, submitted}}. */
function invLastCounts_() {
  var out = {};
  invRows_(INV_COUNT_TAB, INV_COUNT_HEADERS).forEach(function (r) {
    var reg = String(r[2]), day = invDay_(r[5]) || invDay_(r[1]);
    if (!reg || !day) return;
    if (!out[reg] || day >= out[reg].date) {
      out[reg] = { id: String(r[0]), date: day, period: String(r[4]) };
    }
  });
  return out;
}

/* on hand per region and variant, plus the movement breakdown since the count.
   Apparel counted by size keeps its size key. An opening row with a blank size
   stays on the blank key until the first count by size replaces it. */
function invState_() {
  var last = invLastCounts_();
  var base = {};      // region -> key -> {qty, date}
  invRows_(INV_LINE_TAB, INV_LINE_HEADERS).forEach(function (r) {
    var cid = String(r[0]), reg = String(r[2]);
    if (!last[reg] || last[reg].id !== cid) return;
    var k = invKey_(r[5], r[7], r[8]);
    if (!base[reg]) base[reg] = {};
    base[reg][k] = { qty: invNum_(r[16]), date: last[reg].date, item: String(r[6]) };
  });

  var since = {};     // region -> key -> {received, sold, comped, issued, other, net}
  function bucket(reg, k) {
    if (!since[reg]) since[reg] = {};
    if (!since[reg][k]) since[reg][k] = { received: 0, sold: 0, comped: 0, issued: 0, other: 0, net: 0 };
    return since[reg][k];
  }
  invRows_(INV_MOVE_TAB, INV_MOVE_HEADERS).forEach(function (r) {
    var reg = String(r[2]), type = String(r[3]), day = invDay_(r[5]);
    var dir = invDir_(type);
    if (!dir) return;
    var cutoff = last[reg] ? last[reg].date : '';
    if (cutoff && day && day <= cutoff) return;   // already inside the counted number
    var k = invKey_(r[6], r[8], r[9]);
    var q = invNum_(r[10]);
    var b = bucket(reg, k);
    if (type === 'receipt' || type === 'transfer_in' || type === 'found') b.received += q;
    else if (type === 'sale') b.sold += q;
    else if (type === 'comp') b.comped += q;
    else if (type === 'issue') b.issued += q;
    else b.other += q;
    b.net += dir * q;
  });
  return { last: last, base: base, since: since };
}

/* Everything the count page and the on hand page need, per region. */
function invSnapshot_(region) {
  var reg = invRegion_(region).name;
  var st = invState_();
  var items = invItems_();
  var base = st.base[reg] || {};
  var since = st.since[reg] || {};
  var last = st.last[reg] || null;
  var rows = [];
  var seen = {};
  items.forEach(function (it) {
    var variants = invVariants_(it);
    variants.forEach(function (v) {
      var k = invKey_(it.sku, v.size, v.color);
      seen[k] = true;
      var b = base[k] || { qty: 0 };
      var s = since[k] || { received: 0, sold: 0, comped: 0, issued: 0, other: 0, net: 0 };
      rows.push({ sku: it.sku, name: it.name, grp: it.grp, unit: it.unit, cost: it.cost,
        size: v.size, color: v.color, opening: b.qty, received: s.received, sold: s.sold,
        comped: s.comped, issued: s.issued, other: s.other,
        on_hand: b.qty + s.net });
    });
    // An opening row with no size, on an item that is now counted by size, still
    // has to show up so nothing disappears from the book.
    var blank = invKey_(it.sku, '', '');
    if (!seen[blank] && (base[blank] || since[blank])) {
      var b2 = base[blank] || { qty: 0 };
      var s2 = since[blank] || { received: 0, sold: 0, comped: 0, issued: 0, other: 0, net: 0 };
      if (b2.qty || s2.net) {
        rows.push({ sku: it.sku, name: it.name, grp: it.grp, unit: it.unit, cost: it.cost,
          size: '', color: '', opening: b2.qty, received: s2.received, sold: s2.sold,
          comped: s2.comped, issued: s2.issued, other: s2.other, on_hand: b2.qty + s2.net,
          unsized: true });
        seen[blank] = true;
      }
    }
  });
  return { region: reg, last: last, rows: rows };
}
function invVariants_(it) {
  if (it.grp === 'apparel' && it.sizes.length) {
    var out = [];
    (it.colors.length ? it.colors : ['']).forEach(function (c) {
      it.sizes.forEach(function (s) { out.push({ size: s, color: c }); });
    });
    return out;
  }
  return [{ size: '', color: '' }];
}

/* The On Hand tab is a mirror, rewritten whole after every write. */
function invRebuildOnHand_() {
  var sh = invSheet_(INV_HAND_TAB, INV_HAND_HEADERS, '#1E7B34');
  var now = new Date();
  var rows = [];
  ['Las Vegas', 'Northern Nevada'].forEach(function (reg) {
    var snap = invSnapshot_(reg);
    var lastDate = snap.last ? snap.last.date : '';
    var items = {};
    invItems_().forEach(function (it) { items[it.sku] = it; });
    snap.rows.forEach(function (r) {
      var it = items[r.sku] || {};
      var par = invParFor_(it, r.size);
      rows.push([reg, r.sku, r.name, r.size, r.color, r.on_hand, par,
        Math.max(0, par - r.on_hand), lastDate, r.opening, r.received, r.sold, r.comped,
        r.issued, r.other, r.cost, Math.round(r.on_hand * r.cost * 100) / 100, now]);
    });
  });
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, INV_HAND_HEADERS.length).clearContent();
  }
  if (rows.length) sh.getRange(2, 1, rows.length, INV_HAND_HEADERS.length).setValues(rows);
  return rows.length;
}
function invParFor_(it, size) {
  if (size) {
    var map = {};
    String(it.spars || '').split(/[;,]/).forEach(function (p) {
      var kv = p.split(':');
      if (kv.length === 2 && kv[0].trim() !== '') map[kv[0].trim()] = invNum_(kv[1]);
    });
    return invNum_(map[size]);
  }
  return invNum_(it.par);
}

/* ------------------------------------------------------------------ router */
function invDispatch(data) {
  var kind = String(data.kind || '');
  if (kind === 'inv_catalog') return handleInvCatalog(data);
  if (kind === 'inv_save')    return handleInvSave(data);
  if (kind === 'inv_move')    return handleInvMove(data);
  if (kind === 'inv_onhand')  return handleInvOnHand(data);
  if (kind === 'inv_moves')   return handleInvMoves(data);
  return invJson_({ ok: false, error: 'unknown_kind' });
}

/* ----------------------------------------------------------------- catalog */
function handleInvCatalog(data) {
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  var items = invItems_();
  if (!items.length) { setupInventory(); items = invItems_(); }
  if (!items.length) return invJson_({ ok: false, error: 'no_items' });
  var rows = items.map(function (it) {
    return [it.sku, it.name, it.grp, it.unit, it.cost, it.par, it.image,
      it.sizes.join('|'), it.colors.join('|'), it.act, it.note, it.spars];
  });
  var snap = invSnapshot_(data.region);
  return invJson_({ ok: true, rows: rows, region: snap.region,
    last: snap.last, state: snap.rows, book: invSS_().getUrl() });
}

/* ------------------------------------------------------- live on hand view */
function handleInvOnHand(data) {
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  var snap = invSnapshot_(data.region);
  var items = {};
  invItems_().forEach(function (it) { items[it.sku] = it; });
  var rows = snap.rows.map(function (r) {
    var it = items[r.sku] || {};
    var par = invParFor_(it, r.size);
    return { sku: r.sku, name: r.name, grp: r.grp, unit: r.unit, size: r.size, color: r.color,
      on_hand: r.on_hand, par: par, to_order: Math.max(0, par - r.on_hand), opening: r.opening,
      received: r.received, sold: r.sold, comped: r.comped, issued: r.issued, other: r.other,
      cost: r.cost, value: Math.round(r.on_hand * r.cost * 100) / 100, unsized: !!r.unsized };
  });
  var exc = invRows_(INV_EXC_TAB, INV_EXC_HEADERS).filter(function (r) {
    return String(r[2]) === snap.region;
  }).slice(-40).map(function (r) {
    return { count_id: String(r[0]), date: invDay_(r[1]), sku: String(r[3]), name: String(r[4]),
      size: String(r[5]), expected: invNum_(r[7]), counted: invNum_(r[8]),
      variance: invNum_(r[9]), value: invNum_(r[10]), from: invDay_(r[11]), to: invDay_(r[12]),
      movements: String(r[13]), status: String(r[14]), note: String(r[15]) };
  }).reverse();
  return invJson_({ ok: true, region: snap.region, last: snap.last, rows: rows,
    exceptions: exc, book: invSS_().getUrl() });
}

function handleInvMoves(data) {
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  var reg = invRegion_(data.region).name;
  var limit = Math.min(200, Math.max(1, invNum_(data.limit) || 50));
  var all = invRows_(INV_MOVE_TAB, INV_MOVE_HEADERS).filter(function (r) {
    return String(r[2]) === reg;
  });
  var rows = all.slice(-limit).reverse().map(function (r) {
    return { id: String(r[0]), type: String(r[3]), date: invDay_(r[5]), sku: String(r[6]),
      name: String(r[7]), size: String(r[8]), color: String(r[9]), qty: invNum_(r[10]),
      reason: String(r[11]), reference: String(r[12]), party: String(r[13]),
      by: String(r[14]), notes: String(r[16]) };
  });
  return invJson_({ ok: true, region: reg, rows: rows, total: all.length });
}

/* --------------------------------------------------------------- movements */
function handleInvMove(data) {
  if (data.website) return invJson_({ ok: true });
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  if (!data.entered_by || !data.email) return invJson_({ ok: false, error: 'Missing name or email' });
  var lines = data.lines || [];
  if (!lines.length) return invJson_({ ok: false, error: 'No lines' });

  var reg = invRegion_(data.region);
  var now = new Date();
  var id = invId_('MOV', reg.name);
  var lastCounts = invLastCounts_();
  var cutoff = lastCounts[reg.name] ? lastCounts[reg.name].date : '';

  var rows = [], backdated = 0;
  lines.forEach(function (l, i) {
    var type = String(l.type || data.type || 'receipt');
    if (!INV_TYPES[type]) type = 'receipt';
    var day = invDay_(l.move_date || data.move_date) || invToday_();
    if (cutoff && day <= cutoff) backdated++;
    rows.push([id + '-' + (i + 1), now, reg.name, type, invDir_(type), day,
      String(l.sku || ''), String(l.name || ''), String(l.size || ''), String(l.color || ''),
      invNum_(l.qty), String(l.reason || ''), String(l.reference || data.reference || ''),
      String(l.party || data.party || ''), String(data.entered_by), String(data.email),
      String(l.notes || data.notes || ''), '']);
  });
  var ms = invSheet_(INV_MOVE_TAB, INV_MOVE_HEADERS, '#636466');
  ms.getRange(ms.getLastRow() + 1, 1, rows.length, INV_MOVE_HEADERS.length).setValues(rows);
  invRebuildOnHand_();

  try {
    cwMail_('inventory_move', {
      to: reg.cfg.inbox,
      cc: String(data.email),
      name: reg.cfg.sender,
      replyTo: String(data.email),
      subject: invMoveSubject_(data, lines, reg, id),
      htmlBody: invMoveEmail_(id, data, lines, reg, cutoff, backdated),
      body: invMoveSubject_(data, lines, reg, id) + '. Entered by ' + String(data.entered_by) +
        '. Open the CW Inventory Sheet, Movements tab.'
    });
  } catch (e) {}

  return invJson_({ ok: true, id: id, lines: rows.length, backdated: backdated,
    cutoff: cutoff });
}
function invMoveSubject_(data, lines, reg, id) {
  var type = String((lines[0] && lines[0].type) || data.type || 'receipt');
  var t = INV_TYPES[type] || INV_TYPES.receipt;
  var units = 0;
  lines.forEach(function (l) { units += invNum_(l.qty); });
  return 'Inventory ' + t.label.toLowerCase() + ' - ' + reg.name + ' - ' + units +
    (units === 1 ? ' unit' : ' units') + ' [' + id + ']';
}
function invMoveEmail_(id, data, lines, reg, cutoff, backdated) {
  var td = 'padding:5px 8px;border-bottom:1px solid #eee';
  var tdr = td + ';text-align:right';
  var rows = lines.map(function (l) {
    var t = INV_TYPES[String(l.type || data.type || 'receipt')] || INV_TYPES.receipt;
    return '<tr><td style="' + td + '">' + invEsc_(l.name) +
      (l.size ? ' <span style="color:#636466">' + invEsc_((l.color ? l.color + ' ' : '') + l.size) + '</span>' : '') +
      '</td><td style="' + td + '">' + invEsc_(t.label) + '</td>' +
      '<td style="' + td + '">' + invEsc_(invDay_(l.move_date || data.move_date)) + '</td>' +
      '<td style="' + td + '">' + invEsc_(l.reason || '') + '</td>' +
      '<td style="' + tdr + '">' + invNum_(l.qty) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Verdana,Geneva,sans-serif;font-size:13px;color:#2D2A26;max-width:680px">' +
    '<img src="' + INV_LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto"><br><br>' +
    '<h2 style="font-size:17px;margin:0 0 4px">Inventory movement logged</h2>' +
    '<p style="color:#636466;margin:0 0 14px">' + invEsc_(reg.name) + ' office. Entered by ' +
      invEsc_(String(data.entered_by)) + '. Reference ' + invEsc_(id) + '.</p>' +
    (data.party ? '<p style="margin:0 0 10px"><b>Who</b> ' + invEsc_(String(data.party)) + '</p>' : '') +
    (data.reference ? '<p style="margin:0 0 10px"><b>Reference</b> ' + invEsc_(String(data.reference)) + '</p>' : '') +
    '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
    '<tr><th align="left" style="' + td + '">Item</th><th align="left" style="' + td + '">What</th>' +
    '<th align="left" style="' + td + '">Date</th><th align="left" style="' + td + '">Reason</th>' +
    '<th align="right" style="' + td + '">Qty</th></tr>' + rows + '</table>' +
    (backdated ? '<p style="margin:14px 0 0;color:#8a6d1a"><b>' + backdated +
      (backdated === 1 ? ' line is' : ' lines are') + ' dated on or before the last count (' +
      invEsc_(cutoff) + ').</b> Those are already inside the counted number, so they explain a ' +
      'variance but do not change what is on the shelf.</p>' : '') +
    (data.notes ? '<p style="margin:14px 0 0"><b>Notes</b><br>' + invEsc_(String(data.notes)) + '</p>' : '') +
    '<p style="color:#636466;font-size:11.5px;margin:16px 0 0">Rows are on the CW Inventory ' +
    'Sheet, Movements tab. On Hand updates with every entry.</p></div>';
}

/* ------------------------------------------------------------- the count -- */
function handleInvSave(data) {
  if (data.website) return invJson_({ ok: true });
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  if (!data.counted_by || !data.email) return invJson_({ ok: false, error: 'Missing name or email' });
  var lines = data.lines || [];
  if (!lines.length) return invJson_({ ok: false, error: 'No counted items' });

  var reg = invRegion_(data.region);
  var now = new Date();
  var countDate = invDay_(data.count_date) || invToday_();
  var id = invId_('INV', reg.name);
  var prior = invLastCounts_()[reg.name] || null;
  var windowFrom = prior ? prior.date : '';

  var moveDetail = invMovementDetail_(reg.name, windowFrom, countDate);

  var flagged = 0, total = 0, units = 0;
  var lineRows = [], excRows = [], countMoves = [];
  lines.forEach(function (l) {
    var v = invNum_(l.variance);
    if (v !== 0) flagged++;
    total += invNum_(l.value);
    units += invNum_(l.to_order_units);
    lineRows.push([id, now, reg.name, String(data.period || ''), countDate, String(l.sku || ''),
      String(l.name || ''), String(l.size || ''), String(l.color || ''), invNum_(l.opening),
      invNum_(l.received), invNum_(l.sold), invNum_(l.comped), invNum_(l.issued),
      invNum_(l.other), invNum_(l.expected), invNum_(l.counted), v, invNum_(l.cost),
      invNum_(l.value), String(l.to_order || ''), String(l.notes || '')]);
    if (v !== 0) {
      var k = invKey_(l.sku, l.size, l.color);
      excRows.push([id, countDate, reg.name, String(l.sku || ''), String(l.name || ''),
        String(l.size || ''), String(l.color || ''), invNum_(l.expected), invNum_(l.counted), v,
        Math.round(v * invNum_(l.cost) * 100) / 100, windowFrom, countDate,
        moveDetail[k] || 'No movement logged in this window', 'Open', '']);
    }
    countMoves.push([id + '-C' + countMoves.length, now, reg.name, 'count', 0, countDate,
      String(l.sku || ''), String(l.name || ''), String(l.size || ''), String(l.color || ''),
      invNum_(l.counted), 'Physical count', id, '', String(data.counted_by), String(data.email),
      String(l.notes || ''), id]);
  });

  var ls = invSheet_(INV_LINE_TAB, INV_LINE_HEADERS, '#636466');
  ls.getRange(ls.getLastRow() + 1, 1, lineRows.length, INV_LINE_HEADERS.length).setValues(lineRows);

  var cs = invSheet_(INV_COUNT_TAB, INV_COUNT_HEADERS, '#D22730');
  cs.appendRow([id, now, reg.name, reg.cfg.entity, String(data.period || ''), countDate,
    String(data.counted_by), String(data.email), lines.length, flagged,
    invNum_(data.units_to_order), Math.round(total * 100) / 100, String(data.notes || '')]);

  if (excRows.length) {
    var es = invSheet_(INV_EXC_TAB, INV_EXC_HEADERS, '#B01F27');
    es.getRange(es.getLastRow() + 1, 1, excRows.length, INV_EXC_HEADERS.length).setValues(excRows);
  }
  var ms = invSheet_(INV_MOVE_TAB, INV_MOVE_HEADERS, '#636466');
  ms.getRange(ms.getLastRow() + 1, 1, countMoves.length, INV_MOVE_HEADERS.length).setValues(countMoves);

  invRebuildOnHand_();

  var reorder = data.reorder || [];
  var orderUnits = 0;
  reorder.forEach(function (r) { orderUnits += invNum_(r.order); });

  try {
    cwMail_('inventory', {
      to: reg.cfg.inbox,
      cc: String(data.email),
      name: reg.cfg.sender,
      replyTo: String(data.email),
      subject: 'Office inventory count ' + String(data.period || '') + ' - ' + reg.name +
        (flagged ? ' - ' + flagged + ' to explain' : ' - no variances') +
        (orderUnits ? ' - ' + orderUnits + ' to order' : '') + ' [' + id + ']',
      htmlBody: invCountEmail_(id, data, lines, reg, flagged, total, reorder, orderUnits,
        windowFrom, countDate, excRows),
      body: 'Office inventory count ' + id + ' for ' + reg.name + ', ' + lines.length +
        ' lines, ' + flagged + ' variances, ' + orderUnits + ' units to order. Open the CW ' +
        'Inventory Sheet.'
    });
  } catch (e) {}

  return invJson_({ ok: true, id: id, variance_lines: flagged, units_to_order: orderUnits,
    exceptions: excRows.length });
}

/* A one line movement summary per variant inside a count window. */
function invMovementDetail_(region, fromDay, toDay) {
  var out = {};
  invRows_(INV_MOVE_TAB, INV_MOVE_HEADERS).forEach(function (r) {
    if (String(r[2]) !== region) return;
    var type = String(r[3]);
    if (!invDir_(type)) return;
    var day = invDay_(r[5]);
    if (fromDay && day <= fromDay) return;
    if (toDay && day > toDay) return;
    var k = invKey_(r[6], r[8], r[9]);
    var t = INV_TYPES[type] || { label: type };
    var bit = t.label + ' ' + invNum_(r[10]) + ' on ' + day +
      (r[13] ? ' (' + String(r[13]) + ')' : '');
    out[k] = out[k] ? out[k] + '; ' + bit : bit;
  });
  return out;
}

function invCountEmail_(id, data, lines, reg, flagged, total, reorder, orderUnits,
                        windowFrom, countDate, excRows) {
  var td = 'padding:5px 8px;border-bottom:1px solid #eee';
  var tdr = td + ';text-align:right';
  var ordRows = (reorder || []).map(function (r) {
    return '<tr><td style="' + td + '">' + invEsc_(r.name) + '</td>' +
      '<td style="' + td + '">' + invEsc_(r.size || '') + '</td>' +
      '<td style="' + tdr + '">' + invNum_(r.have) + '</td>' +
      '<td style="' + tdr + '">' + invNum_(r.par) + '</td>' +
      '<td style="' + tdr + ';font-weight:bold;color:#B01F27">' + invNum_(r.order) + '</td></tr>';
  }).join('');
  var orderBlock = (reorder && reorder.length)
    ? '<h3 style="font-size:14px;margin:18px 0 6px">What to order</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
      '<tr><th align="left" style="' + td + '">Item</th><th align="left" style="' + td + '">Size</th>' +
      '<th align="right" style="' + td + '">On hand</th><th align="right" style="' + td + '">Keep</th>' +
      '<th align="right" style="' + td + '">Order</th></tr>' + ordRows + '</table>'
    : '<p style="margin:16px 0 0;color:#1E7B34"><b>Nothing to order.</b> Every size is at the ' +
      'level we keep on the shelf.</p>';

  var excBlock = '';
  if (excRows && excRows.length) {
    var er = excRows.map(function (r) {
      return '<tr><td style="' + td + '">' + invEsc_(r[4]) +
        (r[5] ? ' ' + invEsc_(r[5]) : '') + '</td>' +
        '<td style="' + tdr + '">' + invNum_(r[7]) + '</td>' +
        '<td style="' + tdr + '">' + invNum_(r[8]) + '</td>' +
        '<td style="' + tdr + ';font-weight:bold;color:#B01F27">' +
          (invNum_(r[9]) > 0 ? '+' : '') + invNum_(r[9]) + '</td>' +
        '<td style="' + td + ';color:#636466;font-size:11px">' + invEsc_(r[13]) + '</td></tr>';
    }).join('');
    excBlock = '<h3 style="font-size:14px;margin:18px 0 6px">Exceptions to explain</h3>' +
      '<p style="color:#636466;margin:0 0 8px;font-size:12px">Movement logged between ' +
      invEsc_(windowFrom || 'the start of the book') + ' and ' + invEsc_(countDate) + '.</p>' +
      '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
      '<tr><th align="left" style="' + td + '">Item</th><th align="right" style="' + td + '">Expected</th>' +
      '<th align="right" style="' + td + '">Counted</th><th align="right" style="' + td + '">Variance</th>' +
      '<th align="left" style="' + td + '">What moved</th></tr>' + er + '</table>';
  } else {
    excBlock = '<p style="margin:16px 0 0;color:#1E7B34"><b>No exceptions.</b> Every line came ' +
      'in exactly where the book said it would.</p>';
  }

  return '<div style="font-family:Verdana,Geneva,sans-serif;font-size:13px;color:#2D2A26;max-width:680px">' +
    '<img src="' + INV_LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto"><br><br>' +
    '<h2 style="font-size:17px;margin:0 0 4px">Office inventory count ' +
      invEsc_(String(data.period || '')) + '</h2>' +
    '<p style="color:#636466;margin:0 0 14px">' + invEsc_(reg.name) + ' office. Counted by ' +
      invEsc_(String(data.counted_by)) + ' on ' + invEsc_(countDate) + '. Reference ' +
      invEsc_(id) + '.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
    '<tr><td style="' + td + '">Lines counted</td><td style="' + tdr + '">' + lines.length + '</td></tr>' +
    '<tr><td style="' + td + '">Exceptions</td><td style="' + tdr +
      (flagged ? ';color:#B01F27;font-weight:bold' : '') + '">' + flagged + '</td></tr>' +
    '<tr><td style="' + td + '">Units to order</td><td style="' + tdr +
      (orderUnits ? ';color:#B01F27;font-weight:bold' : '') + '">' + orderUnits + '</td></tr>' +
    '<tr><td style="' + td + '">On the shelf</td><td style="' + tdr + '">' + invMoney_(total) + '</td></tr>' +
    '</table>' + excBlock + orderBlock +
    (data.notes ? '<p style="margin:14px 0 0"><b>Notes</b><br>' + invEsc_(String(data.notes)) + '</p>' : '') +
    '<h3 style="font-size:14px;margin:18px 0 6px">Paste block for the ACT</h3>' +
    '<pre style="font-family:Consolas,Menlo,monospace;font-size:11px;background:#F5F5F5;' +
      'border:1px solid #E5E5E5;padding:10px;overflow:auto;white-space:pre">' +
      invEsc_(String(data.act_block || '')) + '</pre>' +
    '<p style="color:#636466;font-size:11.5px;margin:16px 0 0">The count reset the book. ' +
    'On Hand now runs forward from it.</p></div>';
}

/* ------------------------------------------------------------------- seed --
   Seeded once into the Items tab. After that the tab is the source of truth.
   par is the level for a whole item. size_pars is the level per size and wins
   for apparel: "S:5;M:5;L:5;XL:5;2XL:0" means keep five of each on the shelf,
   counted across colors.
   [sku, name, group, unit, cost, par, image, sizes, colors, act_order, note, active, size_pars] */
var INV_SEED = [
['A-112-02H','EnvirOx H2Orange2 H-C 112 2x1 Half Gal (case of 2)','chem','Case of 2',88.79,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2367/1701707851227.png','','',3,'Product #1, our standard.',1,''],
['117-06SQ-EA','H2Orange2 117 - Simple Measures 6pk (EPA) (each)','chem','Each',15.70,0,'','','',4,'Bought by the 6 pack, counted as singles.',1,''],
['122-06Q-EA','OxiGenesis 32oz RTU (each)','chem','Each',4.65,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2371/1701710272232.png','','',5,'Ready to use, no dispenser needed.',1,''],
['138-12Q-EA','Mineral Shock 32oz RTU (each)','chem','Each',7.05,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2396/1701968613978.png','','',6,'Hard water and scum remover.',1,''],
['A8-112L','112 Absolute Bottle & Spray Head - Light Duty Green','bottle','Each',2.60,0,'https://d3gygecnvdjq5h.cloudfront.net/userfiles/products/images/websites/b2bseller/customer/braind/images/items/8-550.jpg','','',1,'Green is light duty, glass and everyday surfaces.',1,''],
['A8-112H','112 Absolute Bottle & Spray Head - Heavy Duty Red','bottle','Each',2.60,0,'https://d3gygecnvdjq5h.cloudfront.net/userfiles/products/images/websites/b2bseller/customer/braind/images/items/288-552.jpg','','',2,'Red is heavy duty.',1,''],
['A9-112L','Secondary Label - Light Duty Green 112','bottle','Each',0.27,0,'','','',0,'Spare labels for relabeling bottles.',1,''],
['A9-112H','Secondary Label - Heavy Duty Red 112','bottle','Each',0.27,0,'','','',0,'Spare labels for relabeling bottles.',1,''],
['AS-112','Bottle Sticker - H2Orange2 H-C 112','bottle','Each',0,0,'','','',0,'One per spray bottle in service. No charge.',1,''],
['7-644-N','Trigger Spray Head (fits 28mm)','bottle','Each',1.18,0,'','','',0,'',1,''],
['4-252-KEY','Wall Mount Dispenser Key','bottle','Each',2.48,0,'','','',0,'',1,''],
['A-252-MDD-YGR','Absolute TRIO Dispenser (YGR)','disp','Each',0,0,'','','',0,'No charge. One per new building running 112.',1,''],
['AP-252-112','Absolute Portable Dispenser for H2Orange2 112','disp','Each',0,0,'','','',0,'No charge. Needs water hose 6-221.',1,''],
['A-252-MDD-YGBR','Absolute Multi Dispenser for OxiGenesis (YGBR)','disp','Each',0,0,'','','',0,'Billed at cost unless EnvirOx credits it.',1,''],
['A-IN-112-YGR-KIT','Trio Installation Kit - H2Orange2 112','disp','Each',0,0,'','','',0,'One per TRIO going on a wall.',1,''],
['A-IN-145-YGBR-KIT','Installation Kit - OxiGenesis','disp','Each',0,0,'','','',0,'One per dispenser running OxiGenesis.',1,''],
['ACW-112-YGR-1','Wall Chart - H2Orange2 112 YGR TRIO','paper','Each',0,0,'','','',0,'Hangs next to each TRIO.',1,''],
['ACP-112-YGR-PCK','Pocket Chart - 112 YGR TRIO with lanyard','paper','Each',0,0,'','','',0,'',1,''],
['ACW-145-YGBR-1','Wall Chart - OxiGenesis General','paper','Each',0,0,'','','',0,'',1,''],
['ACP-145-YGBR-PCK','Pocket Chart - OxiGenesis YGBR with lanyard','paper','Each',0,0,'','','',0,'',1,''],
['A9-855-112','Product Literature - H2Orange2 H-C 112','paper','Pack of 25',0,0,'','','',0,'',1,''],
['SDS-112','SDS Sheets - H2Orange2 H-C 112','paper','Each',0,0,'','','',0,'No charge, EnvirOx bills it as MISCNOCHARGE.',1,''],
['SDS-145','SDS Sheets - OxiGenesis','paper','Each',0,0,'','','',0,'No charge, EnvirOx bills it as MISCNOCHARGE.',1,''],
['UNI-VEST','Unisex Vest','apparel','Each',17.00,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cwmv-model.jpg','S|M|L|XL|2XL','Red',8,'Red with the Independent Contractor monogram.',1,'S:5;M:5;L:5;XL:5;2XL:0'],
['UNI-APRON','Unisex Cobbler Apron','apparel','Each',14.00,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cwf12ic10.png','OSFM|XL','Red|Black',7,'The smock. Count each color.',1,'OSFM:10;XL:10'],
['UNI-HIVIS','Class 2 High-Visibility Vest','apparel','Each',9.99,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cws362-back.jpg','M|L|XL|2XL|3XL|4XL|5XL','Safety Yellow',0,'Special order item. Count only what is on the shelf.',1,'']
];
