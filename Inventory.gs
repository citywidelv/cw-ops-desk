/* ==========================================================================
   OFFICE INVENTORY COUNTS  (inventory.html in cw-ops-desk)
   Added Sep 2026. Self contained: it does not depend on helpers that live in
   the other files of this project, so it can be added or removed on its own.

   Router: doPost sends every kind starting with inv_ to invDispatch.
     inv_catalog -> item list for the count sheet, plus last month's numbers
     inv_save    -> write one count, email the region service inbox

   Book: the CW Supply and Inventory Sheet (script property SUPPLY_SHEET_ID),
   the same book that carries Supply Orders, EnvirOx Orders and the EnvirOx
   Catalog. Three tabs:
     Inventory Items   the catalog. Edit items, costs and par levels HERE,
                       not in the page. active 0 hides a row.
     Inventory Counts  one row per submitted count
     Inventory Lines   one row per item on that count

   Region routing: Las Vegas -> lvservicecall@, Northern Nevada -> rnservicecall@.
   ========================================================================== */

var INV_ITEM_TAB  = 'Inventory Items';
var INV_COUNT_TAB = 'Inventory Counts';
var INV_LINE_TAB  = 'Inventory Lines';

var INV_ITEM_HEADERS = ['sku','name','group','unit','cost','par','image','sizes','colors',
  'act_order','note','active'];
var INV_COUNT_HEADERS = ['count_id','submitted','region','entity','period','count_date',
  'counted_by','email','items_counted','variance_lines','total_value','notes'];
var INV_LINE_HEADERS = ['count_id','submitted','region','period','sku','item','group','unit',
  'last_month','sold','comped','received','installed_out','deployed_at_accounts','expected',
  'counted','variance','cost','ending_value','sizes','notes'];

var INV_SUPPLY_ID_FALLBACK = '1_T1hxLt7WLIRYqkVVESGwD94f-IpPYAHVPWVoddbS_0';
var INV_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';

var INV_REGION = {
  'Las Vegas':        { inbox:'lvservicecall@gocitywide.com', entity:'Low Drag LLC',
                        sender:'City Wide Las Vegas Ops' },
  'Northern Nevada':  { inbox:'rnservicecall@gocitywide.com', entity:'Dash Two LLC',
                        sender:'City Wide Northern Nevada Ops' }
};
function invRegion_(r) {
  var key = String(r || 'Las Vegas');
  if (key === 'NNV' || key === 'nnv') key = 'Northern Nevada';
  if (key === 'LV'  || key === 'lv')  key = 'Las Vegas';
  return INV_REGION[key] ? { name: key, cfg: INV_REGION[key] }
                         : { name: 'Las Vegas', cfg: INV_REGION['Las Vegas'] };
}

function invSS_() {
  var id = '';
  try { id = PropertiesService.getScriptProperties().getProperty('SUPPLY_SHEET_ID') || ''; } catch (e) {}
  if (!id) id = INV_SUPPLY_ID_FALLBACK;
  return SpreadsheetApp.openById(id);
}
function invJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function invEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function invNum_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function invMoney_(n) { return '$' + (Math.round(invNum_(n) * 100) / 100).toFixed(2); }

function invSheet_(name, headers, color) {
  var ss = invSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
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

/* Safe to re-run. Creates the three tabs and seeds the item list once. */
function setupInventory() {
  var items = invSheet_(INV_ITEM_TAB, INV_ITEM_HEADERS, '#2D2A26');
  invSheet_(INV_COUNT_TAB, INV_COUNT_HEADERS, '#D22730');
  invSheet_(INV_LINE_TAB, INV_LINE_HEADERS, '#636466');
  if (items.getLastRow() < 2) {
    items.getRange(2, 1, INV_SEED.length, INV_ITEM_HEADERS.length).setValues(INV_SEED);
  }
  return 'Inventory tabs ready on ' + invSS_().getName();
}

/* ------------------------------------------------------------------ router */
function invDispatch(data) {
  var kind = String(data.kind || '');
  if (kind === 'inv_catalog') return handleInvCatalog(data);
  if (kind === 'inv_save')    return handleInvSave(data);
  return invJson_({ ok: false, error: 'unknown_kind' });
}

/* ----------------------------------------------------------------- catalog */
function handleInvCatalog(data) {
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  var sh = invSheet_(INV_ITEM_TAB, INV_ITEM_HEADERS, '#2D2A26');
  if (sh.getLastRow() < 2) { setupInventory(); sh = invSheet_(INV_ITEM_TAB, INV_ITEM_HEADERS, '#2D2A26'); }
  if (sh.getLastRow() < 2) return invJson_({ ok: false, error: 'no_items' });

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, INV_ITEM_HEADERS.length).getValues();
  var rows = [];
  vals.forEach(function (v) {
    if (String(v[0]) === '') return;
    var act = String(v[11]);
    if (act === '0' || act.toLowerCase() === 'false') return;
    rows.push([String(v[0]), String(v[1]), String(v[2]), String(v[3]), invNum_(v[4]),
      invNum_(v[5]), String(v[6]), String(v[7]), String(v[8]), invNum_(v[9]), String(v[10])]);
  });
  return invJson_({ ok: true, rows: rows, last: invLastCount_(data.region) });
}

/* Most recent submitted count for this region, as {period, map, dep}. */
function invLastCount_(region) {
  var out = { period: '', map: {}, dep: {} };
  try {
    var reg = invRegion_(region).name;
    var cs = invSS_().getSheetByName(INV_COUNT_TAB);
    if (!cs || cs.getLastRow() < 2) return out;
    var cv = cs.getRange(2, 1, cs.getLastRow() - 1, INV_COUNT_HEADERS.length).getValues();
    var best = null, bestAt = 0;
    cv.forEach(function (r) {
      if (String(r[2]) !== reg) return;
      var at = (r[1] instanceof Date) ? r[1].getTime() : 0;
      if (!best || at >= bestAt) { best = r; bestAt = at; }
    });
    if (!best) return out;
    out.period = String(best[4] || '');
    var ls = invSS_().getSheetByName(INV_LINE_TAB);
    if (!ls || ls.getLastRow() < 2) return out;
    var lv = ls.getRange(2, 1, ls.getLastRow() - 1, INV_LINE_HEADERS.length).getValues();
    lv.forEach(function (r) {
      if (String(r[0]) !== String(best[0])) return;
      out.map[String(r[4])] = invNum_(r[15]);
      out.dep[String(r[4])] = invNum_(r[13]);
    });
  } catch (e) {}
  return out;
}

/* -------------------------------------------------------------------- save */
function handleInvSave(data) {
  if (data.website) return invJson_({ ok: true });                       // honeypot
  if ((data.passcode || '') !== PASSCODE) return invJson_({ ok: false, error: 'bad_passcode' });
  if (!data.counted_by || !data.email) return invJson_({ ok: false, error: 'Missing name or email' });
  var lines = data.lines || [];
  if (!lines.length) return invJson_({ ok: false, error: 'No counted items' });

  var reg = invRegion_(data.region);
  var now = new Date();
  var id = 'INV-' + (reg.name === 'Northern Nevada' ? 'NNV' : 'LV') + '-' +
    Utilities.formatDate(now, 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();

  var cs = invSheet_(INV_COUNT_TAB, INV_COUNT_HEADERS, '#D22730');
  var ls = invSheet_(INV_LINE_TAB, INV_LINE_HEADERS, '#636466');

  var flagged = 0, total = 0;
  var lineRows = lines.map(function (l) {
    if (invNum_(l.variance) !== 0) flagged++;
    total += invNum_(l.value);
    var sizes = (l.sizes || []).map(function (s) {
      return (s.color ? s.color + ' ' : '') + s.size + ' x' + invNum_(s.qty);
    }).join(', ');
    return [id, now, reg.name, String(data.period || ''), String(l.sku || ''), String(l.name || ''),
      String(l.grp || ''), String(l.unit || ''), invNum_(l.last), invNum_(l.sold), invNum_(l.comped),
      invNum_(l.received), invNum_(l.installed), invNum_(l.deployed), invNum_(l.expected),
      invNum_(l.counted), invNum_(l.variance), invNum_(l.cost), invNum_(l.value), sizes,
      String(l.notes || '')];
  });
  ls.getRange(ls.getLastRow() + 1, 1, lineRows.length, INV_LINE_HEADERS.length).setValues(lineRows);

  cs.appendRow([id, now, reg.name, reg.cfg.entity, String(data.period || ''),
    String(data.count_date || ''), String(data.counted_by), String(data.email),
    lines.length, flagged, Math.round(total * 100) / 100, String(data.notes || '')]);

  try {
    cwMail_('inventory', {
      to: reg.cfg.inbox,
      cc: String(data.email),
      name: reg.cfg.sender,
      replyTo: String(data.email),
      subject: 'Office inventory count ' + String(data.period || '') + ' - ' + reg.name +
        ' [' + id + ']',
      htmlBody: invEmail_(id, data, lines, reg, flagged, total),
      body: 'Office inventory count ' + id + ' for ' + reg.name + ' (' +
        String(data.period || '') + ') submitted by ' + String(data.counted_by) + '. ' +
        lines.length + ' items, ' + flagged + ' with a variance, ' + invMoney_(total) +
        ' on the shelf. Open the CW Supply and Inventory Sheet, Inventory Counts tab.'
    });
  } catch (e) {}

  return invJson_({ ok: true, id: id, total_value: Math.round(total * 100) / 100,
    variance_lines: flagged });
}

function invEmail_(id, data, lines, reg, flagged, total) {
  var td = 'padding:5px 8px;border-bottom:1px solid #eee';
  var tdr = td + ';text-align:right';
  var rows = lines.map(function (l) {
    var v = invNum_(l.variance);
    var sizes = (l.sizes || []).map(function (s) {
      return (s.color ? s.color + ' ' : '') + s.size + ' x' + invNum_(s.qty);
    }).join(', ');
    var extra = [];
    if (sizes) extra.push(sizes);
    if (String(l.grp) === 'disp') extra.push(invNum_(l.deployed) + ' installed at accounts');
    if (l.notes) extra.push(String(l.notes));
    return '<tr><td style="' + td + '">' + invEsc_(l.name) +
      (extra.length ? '<br><span style="color:#636466;font-size:11px">' +
        invEsc_(extra.join(' | ')) + '</span>' : '') + '</td>' +
      '<td style="' + tdr + '">' + invNum_(l.counted) + '</td>' +
      '<td style="' + tdr + '">' + invNum_(l.expected) + '</td>' +
      '<td style="' + tdr + (v !== 0 ? ';color:#B01F27;font-weight:bold' : '') + '">' +
        (v > 0 ? '+' : '') + v + '</td>' +
      '<td style="' + tdr + '">' + invMoney_(l.value) + '</td></tr>';
  }).join('');

  return '<div style="font-family:Verdana,Geneva,sans-serif;font-size:13px;color:#2D2A26;max-width:680px">' +
    '<img src="' + INV_LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto"><br><br>' +
    '<h2 style="font-size:17px;margin:0 0 4px">Office inventory count ' + invEsc_(String(data.period || '')) + '</h2>' +
    '<p style="color:#636466;margin:0 0 14px">' + invEsc_(reg.name) + ' office. Counted by ' +
      invEsc_(String(data.counted_by)) + (data.count_date ? ' on ' + invEsc_(String(data.count_date)) : '') +
      '. Reference ' + invEsc_(id) + '.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
    '<tr><td style="' + td + ';background:#F5F5F5"><b>On the shelf</b></td>' +
    '<td style="' + tdr + ';background:#F5F5F5">' + invMoney_(total) + '</td></tr>' +
    '<tr><td style="' + td + '">Items counted</td><td style="' + tdr + '">' + lines.length + '</td></tr>' +
    '<tr><td style="' + td + '">Lines with a variance</td><td style="' + tdr +
      (flagged ? ';color:#B01F27;font-weight:bold' : '') + '">' + flagged + '</td></tr>' +
    '</table>' +
    (data.notes ? '<p style="margin:14px 0 0"><b>Notes</b><br>' + invEsc_(String(data.notes)) + '</p>' : '') +
    '<h3 style="font-size:14px;margin:18px 0 6px">Count</h3>' +
    '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
    '<tr><th align="left" style="' + td + '">Item</th><th align="right" style="' + td + '">Counted</th>' +
    '<th align="right" style="' + td + '">Expected</th><th align="right" style="' + td + '">Variance</th>' +
    '<th align="right" style="' + td + '">Value</th></tr>' + rows + '</table>' +
    '<h3 style="font-size:14px;margin:18px 0 6px">Paste block for the ACT</h3>' +
    '<pre style="font-family:Consolas,Menlo,monospace;font-size:11px;background:#F5F5F5;' +
      'border:1px solid #E5E5E5;padding:10px;overflow:auto;white-space:pre">' +
      invEsc_(String(data.act_block || '')) + '</pre>' +
    '<p style="color:#636466;font-size:11.5px;margin:16px 0 0">Rows are on the CW Supply and ' +
    'Inventory Sheet, Inventory Counts and Inventory Lines tabs.</p></div>';
}

/* ------------------------------------------------------------------- seed --
   Seeded once into the Inventory Items tab. After that the tab is the source
   of truth. Costs came off the August 2026 ACT and the EnvirOx price sheet.
   par is left at 0 on purpose: set a par level per item and the count sheet
   starts flagging anything below it as a reorder.
   [sku, name, group, unit, cost, par, image, sizes, colors, act_order, note, active] */
var INV_SEED = [
['A-112-02H','EnvirOx H2Orange2 H-C 112 2x1 Half Gal (case of 2)','chem','Case of 2',88.79,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2367/1701707851227.png','','',3,'Product #1, our standard.',1],
['117-06SQ-EA','H2Orange2 117 - Simple Measures 6pk (EPA) (each)','chem','Each',15.70,0,'','','',4,'Bought by the 6 pack, counted as singles.',1],
['122-06Q-EA','OxiGenesis 32oz RTU (each)','chem','Each',4.65,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2371/1701710272232.png','','',5,'Ready to use, no dispenser needed.',1],
['138-12Q-EA','Mineral Shock 32oz RTU (each)','chem','Each',7.05,0,'https://s3.amazonaws.com/cart2order/uploads/65/products/2396/1701968613978.png','','',6,'Hard water and scum remover.',1],
['A8-112L','112 Absolute Bottle & Spray Head - Light Duty Green','bottle','Each',2.60,0,'https://d3gygecnvdjq5h.cloudfront.net/userfiles/products/images/websites/b2bseller/customer/braind/images/items/8-550.jpg','','',1,'Green is light duty, glass and everyday surfaces.',1],
['A8-112H','112 Absolute Bottle & Spray Head - Heavy Duty Red','bottle','Each',2.60,0,'https://d3gygecnvdjq5h.cloudfront.net/userfiles/products/images/websites/b2bseller/customer/braind/images/items/288-552.jpg','','',2,'Red is heavy duty.',1],
['A9-112L','Secondary Label - Light Duty Green 112','bottle','Each',0.27,0,'','','',0,'Spare labels for relabeling bottles.',1],
['A9-112H','Secondary Label - Heavy Duty Red 112','bottle','Each',0.27,0,'','','',0,'Spare labels for relabeling bottles.',1],
['AS-112','Bottle Sticker - H2Orange2 H-C 112','bottle','Each',0,0,'','','',0,'One per spray bottle in service. No charge.',1],
['7-644-N','Trigger Spray Head (fits 28mm)','bottle','Each',1.18,0,'','','',0,'',1],
['4-252-KEY','Wall Mount Dispenser Key','bottle','Each',2.48,0,'','','',0,'',1],
['A-252-MDD-YGR','Absolute TRIO Dispenser (YGR)','disp','Each',0,0,'','','',0,'No charge. One per new building running 112.',1],
['AP-252-112','Absolute Portable Dispenser for H2Orange2 112','disp','Each',0,0,'','','',0,'No charge. Needs water hose 6-221.',1],
['A-252-MDD-YGBR','Absolute Multi Dispenser for OxiGenesis (YGBR)','disp','Each',0,0,'','','',0,'Billed at cost unless EnvirOx credits it.',1],
['A-IN-112-YGR-KIT','Trio Installation Kit - H2Orange2 112','disp','Each',0,0,'','','',0,'One per TRIO going on a wall.',1],
['A-IN-145-YGBR-KIT','Installation Kit - OxiGenesis','disp','Each',0,0,'','','',0,'One per dispenser running OxiGenesis.',1],
['ACW-112-YGR-1','Wall Chart - H2Orange2 112 YGR TRIO','paper','Each',0,0,'','','',0,'Hangs next to each TRIO.',1],
['ACP-112-YGR-PCK','Pocket Chart - 112 YGR TRIO with lanyard','paper','Each',0,0,'','','',0,'',1],
['ACW-145-YGBR-1','Wall Chart - OxiGenesis General','paper','Each',0,0,'','','',0,'',1],
['ACP-145-YGBR-PCK','Pocket Chart - OxiGenesis YGBR with lanyard','paper','Each',0,0,'','','',0,'',1],
['A9-855-112','Product Literature - H2Orange2 H-C 112','paper','Pack of 25',0,0,'','','',0,'',1],
['SDS-112','SDS Sheets - H2Orange2 H-C 112','paper','Each',0,0,'','','',0,'No charge, EnvirOx bills it as MISCNOCHARGE.',1],
['SDS-145','SDS Sheets - OxiGenesis','paper','Each',0,0,'','','',0,'No charge, EnvirOx bills it as MISCNOCHARGE.',1],
['UNI-VEST','Unisex Vest','apparel','Each',17.00,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cwmv-model.jpg','S|M|L|XL|2XL','Red',8,'Red with the Independent Contractor monogram.',1],
['UNI-APRON','Unisex Cobbler Apron','apparel','Each',14.00,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cwf12ic10.png','OSFM|XL','Red|Black',7,'The smock. Count each color.',1],
['UNI-HIVIS','Class 2 High-Visibility Vest','apparel','Each',9.99,0,'https://citywide.bennettuniform.com/pub/media/catalog/product/cache/9323ec0560e662bc9841b2d71b3b8c4b/c/w/cws362-back.jpg','M|L|XL|2XL|3XL|4XL|5XL','Safety Yellow',0,'Special order item. Count only what is on the shelf.',1]
];
