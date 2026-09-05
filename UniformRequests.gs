/**
 * CW Uniform Requests - Apps Script
 * ---------------------------------
 * One script, three jobs:
 *   1. doGet  : serves the Bennett uniform catalog as JSON (read from the Catalog tab)
 *   2. doPost : logs an employee uniform request to the Requests tab and emails
 *               tjroberts@ + joshuasmith@gocitywide.com (requester gets a copy)
 *   3. syncBennett : nightly crawl of citywide.bennettuniform.com that rebuilds the
 *               Catalog tab. Run manually once for the initial import.
 *
 * Setup:
 *   - Run setup() once. It creates the "CW Uniform Requests" sheet and remembers its ID.
 *   - Run syncBennett() once (initial import, ~1-2 min).
 *   - Deploy as web app: Execute as me, Access: Anyone. Put /exec URL in uniforms.html.
 *   - Add a time-driven trigger: syncBennett, daily, 2-3am.
 */

var BASE = 'https://citywide.bennettuniform.com';
var REQUEST_RECIPIENTS = 'tjroberts@gocitywide.com,joshuasmith@gocitywide.com';
var ALERT_EMAIL = 'tjroberts@gocitywide.com';
var LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';

var CAT_HEADERS = ['id','url','sku','name','price','image','description','categories','options','last_seen'];
var REQ_HEADERS = ['request_id','received','requester','email','need_by','reason','items','est_total','status','notes'];

/**
 * The spreadsheet is created and owned by this script on first run, and its ID is
 * remembered in Script Properties. No manual ID pasting, so it can never drift.
 */
function ss_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ }
  }
  var ss = SpreadsheetApp.create('CW Uniform Requests');
  props.setProperty('SHEET_ID', ss.getId());
  var def = ss.getSheetByName('Sheet1');
  ensureTab_(ss, 'Catalog', CAT_HEADERS);
  ensureTab_(ss, 'Requests', REQ_HEADERS);
  if (def) ss.deleteSheet(def);
  return ss;
}

function setup() {
  var ss = ss_();
  ensureTab_(ss, 'Catalog', CAT_HEADERS);
  ensureTab_(ss, 'Requests', REQ_HEADERS);
  Logger.log('Sheet ready: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (String(first[0] || '') === '') sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

/* ============================= WEB APP ============================= */

function doGet(e) {
  var ss = ss_();
  var sh = ss.getSheetByName('Catalog');
  var out = [];
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, CAT_HEADERS.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (!r[3]) continue; // no name
      var opts = [];
      try { opts = r[8] ? JSON.parse(r[8]) : []; } catch (err) {}
      out.push({
        id: r[0], url: r[1], sku: r[2], name: r[3], price: Number(r[4]) || 0,
        image: r[5], description: r[6],
        categories: String(r[7] || '').split('|').filter(String),
        options: opts
      });
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, count: out.length, products: out }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var res = { ok: false };
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.website) { // honeypot: pretend success
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }
    if (!data.requester || !data.need_by || !data.reason || !data.items || !data.items.length) {
      throw new Error('Missing required fields');
    }
    var ss = ss_();
    var sh = ensureTab_(ss, 'Requests', REQ_HEADERS);
    var id = 'UR-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd-HHmmss');
    var itemsText = data.items.map(function (it) {
      var optStr = (it.options || []).map(function (o) { return o.label + ': ' + o.value; }).join(', ');
      return it.qty + ' x ' + it.name + ' (SKU ' + it.sku + ')' + (optStr ? ' [' + optStr + ']' : '') +
        ' @ $' + Number(it.unit).toFixed(2) + ' = $' + Number(it.line).toFixed(2);
    }).join('\n');
    var total = Number(data.total) || 0;
    sh.appendRow([id, new Date(), data.requester, data.email || '', data.need_by, data.reason,
      itemsText, total, 'New', data.notes || '']);
    sendRequestEmail_(id, data, itemsText, total);
    res = { ok: true, id: id };
  } catch (err) {
    res = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function sendRequestEmail_(id, data, itemsText, total) {
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var rows = data.items.map(function (it) {
    var optStr = (it.options || []).map(function (o) { return esc(o.label) + ': <b>' + esc(o.value) + '</b>'; }).join(' &middot; ');
    return '<tr>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E5E5E5;font-size:12px;">' +
      '<b>' + esc(it.name) + '</b><br><span style="color:#636466;font-size:11px;">SKU ' + esc(it.sku) +
      (optStr ? '<br>' + optStr : '') + '</span></td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E5E5E5;font-size:12px;text-align:center;">' + it.qty + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E5E5E5;font-size:12px;text-align:right;">$' + Number(it.line).toFixed(2) + '</td></tr>';
  }).join('');
  var html =
    '<div style="font-family:Verdana,Geneva,sans-serif;max-width:640px;margin:0 auto;border:1px solid #E5E5E5;">' +
    '<div style="background:#D22730;padding:14px 20px;"><img src="' + LOGO + '" alt="City Wide" height="38" style="height:38px;width:auto;display:block;"></div>' +
    '<div style="padding:20px;">' +
    '<h2 style="margin:0 0 4px;font-size:17px;color:#2D2A26;">Employee Uniform Request</h2>' +
    '<p style="margin:0 0 14px;color:#636466;font-size:11px;">' + id + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">' +
    '<tr><td style="padding:4px 0;color:#636466;width:120px;">Requested by</td><td style="padding:4px 0;"><b>' + esc(data.requester) + '</b>' + (data.email ? ' &middot; ' + esc(data.email) : '') + '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#636466;">Needed by</td><td style="padding:4px 0;"><b>' + esc(data.need_by) + '</b></td></tr>' +
    '<tr><td style="padding:4px 0;color:#636466;vertical-align:top;">Reason</td><td style="padding:4px 0;">' + esc(data.reason) + '</td></tr>' +
    (data.notes ? '<tr><td style="padding:4px 0;color:#636466;vertical-align:top;">Notes</td><td style="padding:4px 0;">' + esc(data.notes) + '</td></tr>' : '') +
    '</table>' +
    '<table style="width:100%;border-collapse:collapse;">' +
    '<tr style="background:#F5F5F5;"><th style="padding:8px 10px;text-align:left;font-size:11px;">Item</th><th style="padding:8px 10px;font-size:11px;">Qty</th><th style="padding:8px 10px;text-align:right;font-size:11px;">Est.</th></tr>' +
    rows +
    '<tr><td></td><td style="padding:10px;font-size:12px;text-align:center;"><b>Total</b></td><td style="padding:10px;font-size:14px;text-align:right;"><b>$' + total.toFixed(2) + '</b></td></tr>' +
    '</table>' +
    '<p style="color:#636466;font-size:10px;margin:14px 0 0;">Order with Bennett: <a href="' + BASE + '" style="color:#D22730;">citywide.bennettuniform.com</a>. Full log in the CW Uniform Requests sheet.</p>' +
    '</div>' +
    '<div style="background:#2D2A26;color:#fff;padding:10px 20px;font-size:10px;">City Wide Facility Solutions &middot; GoCityWide.com</div></div>';
  var opts = { htmlBody: html, name: 'City Wide Uniform Requests' };
  if (data.email) opts.replyTo = data.email;
  // Sep 5 2026: routed through the shared digest config (tag uniform_int rolls into the 8am / 4pm digest).
  opts.to = REQUEST_RECIPIENTS; opts.subject = 'Uniform Request ' + id + ': ' + data.requester + ' (needs by ' + data.need_by + ')'; opts.body = itemsText;
  opts.digest = { title: 'Uniform request: ' + data.requester + ' (needs by ' + data.need_by + ')', id: id, fields: [
    ['Requested by', data.requester + (data.email ? ' <' + data.email + '>' : '')], ['Needed by', data.need_by], ['Reason', data.reason], ['Notes', data.notes || ''],
    ['Items', itemsText.replace(/\s+/g, ' ').slice(0, 400)], ['Estimated total', '$' + total.toFixed(2)] ],
    links: [['Bennett store', BASE], ['Uniform Requests sheet', ss_().getUrl()]] };
  cwRemoteMail_('uniform_int', opts);
  if (data.email) {
    cwRemoteMail_('uniform_conf', { to: data.email, subject: 'City Wide received your uniform request (' + id + ')',
      body: 'Your uniform request was received.\n\n' + itemsText + '\n\nNeeded by: ' + data.need_by,
      htmlBody: html, name: 'City Wide Uniform Requests' });
  }
}

/* ============================= BENNETT SYNC ============================= */

function syncBennett() {
  var ss = ss_();
  var sh = ensureTab_(ss, 'Catalog', CAT_HEADERS);
  var prevCount = Math.max(0, sh.getLastRow() - 1);
  var prevPrices = {};
  if (prevCount > 0) {
    sh.getRange(2, 1, prevCount, CAT_HEADERS.length).getValues().forEach(function (r) {
      if (r[1]) prevPrices[r[1]] = Number(r[4]) || 0;
    });
  }
  try {
    var products = crawlBennett_();
    if (products.length === 0) throw new Error('Crawl returned 0 products');
    if (prevCount > 20 && products.length < prevCount * 0.7) {
      throw new Error('Crawl returned ' + products.length + ' products vs ' + prevCount + ' previously; refusing to overwrite. Bennett may have changed their site.');
    }
    var changed = 0;
    var now = new Date();
    var rows = products.map(function (p, i) {
      if (prevPrices[p.url] !== undefined && prevPrices[p.url] !== p.price) changed++;
      return ['U' + ('000' + (i + 1)).slice(-3), p.url, p.sku, p.name, p.price, p.image,
        p.description, p.categories.join('|'), JSON.stringify(p.options), now];
    });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, CAT_HEADERS.length).clearContent();
    sh.getRange(2, 1, rows.length, CAT_HEADERS.length).setValues(rows);
    if (prevCount > 0 && changed > prevCount * 0.3) {
      alert_('Bennett sync: heavy price drift', changed + ' of ' + prevCount + ' products changed price in one night. Sync completed, but worth a look.');
    }
    Logger.log('Sync OK: ' + rows.length + ' products, ' + changed + ' price changes');
    return rows.length;
  } catch (err) {
    alert_('Bennett uniform sync FAILED', String(err) + '\n\nThe uniform storefront is still serving the last good catalog. If Bennett redesigned their site, the crawler needs updating.');
    throw err;
  }
}

function fetchAll_(urls) {
  var out = [];
  for (var i = 0; i < urls.length; i += 20) {
    var batch = urls.slice(i, i + 20).map(function (u) {
      return { url: u, muteHttpExceptions: true, validateHttpsCertificates: false, followRedirects: true };
    });
    var res = UrlFetchApp.fetchAll(batch);
    for (var j = 0; j < res.length; j++) out.push(res[j].getResponseCode() === 200 ? res[j].getContentText() : '');
    Utilities.sleep(300);
  }
  return out;
}

function crawlBennett_() {
  // 1. category URLs from homepage nav
  var home = UrlFetchApp.fetch(BASE + '/', { muteHttpExceptions: true, validateHttpsCertificates: false }).getContentText();
  var catUrls = {};
  var navRe = /<nav[\s\S]*?<\/nav>/g, aRe = /href="(https:\/\/citywide\.bennettuniform\.com\/[^"#?]+)"/g;
  var navBlocks = home.match(navRe) || [home];
  navBlocks.forEach(function (nb) {
    var m; while ((m = aRe.exec(nb)) !== null) {
      var u = m[1];
      if (!/\.(js|css|png|jpg|gif|ico)$/.test(u) && u !== BASE + '/') catUrls[u] = true;
    }
  });
  var cats = Object.keys(catUrls);
  if (cats.length === 0) throw new Error('No category links found on homepage');

  // 2. listing pages -> product URLs + category names
  var prodCats = {}; // url -> {name, cats:[]}
  var linkRe = /class="product-item-link"\s+href="([^"]+)"\s*>\s*([\s\S]*?)<\/a>/g;
  var listUrls = [];
  cats.forEach(function (cu) { for (var p = 1; p <= 4; p++) listUrls.push(cu + '?product_list_limit=36&p=' + p); });
  var pages = fetchAll_(listUrls);
  for (var i = 0; i < pages.length; i++) {
    var html = pages[i];
    if (!html) continue;
    var catName = (html.match(/<h1[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [,''])[1];
    catName = clean_(catName);
    var m;
    while ((m = linkRe.exec(html)) !== null) {
      var u = m[1], nm = clean_(m[2]);
      if (!prodCats[u]) prodCats[u] = { name: nm, cats: [] };
      if (catName && prodCats[u].cats.indexOf(catName) < 0) prodCats[u].cats.push(catName);
    }
  }
  var urls = Object.keys(prodCats);
  if (urls.length === 0) throw new Error('No product links found in category pages');

  // 3. product pages -> details
  var products = [];
  var bodies = fetchAll_(urls);
  for (var k = 0; k < urls.length; k++) {
    var b = bodies[k];
    if (!b) continue;
    var u2 = urls[k];
    var sku = (b.match(/itemprop="sku"[^>]*>\s*([^<]+)</) || [,''])[1].trim();
    var priceM = b.match(/product-info-price[\s\S]{0,600}?class="price"[^>]*>\s*\$?([\d,]+\.?\d*)/) || b.match(/class="price"[^>]*>\s*\$?([\d,]+\.?\d*)/);
    var price = priceM ? Number(priceM[1].replace(/,/g, '')) : 0;
    var img = (b.match(/property="og:image"\s+content="([^"]+)"/) || b.match(/content="([^"]+)"\s+property="og:image"/) || [,''])[1];
    var descM = b.match(/class="product attribute (?:overview|description)"[\s\S]*?class="value"[^>]*>([\s\S]*?)<\/div>/);
    var desc = descM ? clean_(descM[1]).slice(0, 400) : '';
    // Listing pages truncate long names ('Nike Women\'s Dri-FIT...'), sometimes cutting a
    // multi-byte character in half. The detail page h1 carries the full clean name.
    var h1 = clean_((b.match(/<h1[^>]*page-title[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/) ||
                     b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [,''])[1]);
    var nm = h1 || prodCats[u2].name.replace(/\.\.\.$/, '').replace(/\uFFFD/g, '').trim();
    if (sku && nm.indexOf(sku) === 0) nm = nm.slice(sku.length).trim();
    products.push({
      url: u2, sku: sku, name: nm, price: price, image: img,
      description: desc, categories: prodCats[u2].cats, options: parseOptions_(b)
    });
  }
  return products;
}

function parseOptions_(html) {
  var wrapM = html.match(/product-options-wrapper[\s\S]*?<\/form>/) || html.match(/product-options-wrapper[\s\S]*/);
  if (!wrapM) return [];
  var wrap = wrapM[0];
  var opts = [];
  var fieldRe = /<div class="field[^"]*"[\s\S]*?<\/select>/g;
  var fm;
  while ((fm = fieldRe.exec(wrap)) !== null) {
    var block = fm[0];
    var label = clean_((block.match(/<label[\s\S]*?<span>([\s\S]*?)<\/span>/) || [,''])[1]);
    var values = [];
    var oRe = /<option[^>]*>([\s\S]*?)<\/option>/g, om;
    while ((om = oRe.exec(block)) !== null) {
      var v = clean_(om[1]);
      if (v && v.indexOf('--') !== 0) values.push(v);
    }
    if (label && values.length) opts.push({ label: label, required: block.indexOf('required') >= 0, values: values });
  }
  return opts;
}

function clean_(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&#039;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&reg;|&trade;|&#174;|&#8482;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function alert_(subject, body) {
  try { MailApp.sendEmail(ALERT_EMAIL, '[CW Uniform Sync] ' + subject, body, { name: 'CW Uniform Sync' }); } catch (e) {}
}


function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncBennett') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncBennett').timeBased().atHour(3).everyDays(1).inTimezone('America/Los_Angeles').create();
  Logger.log('Nightly syncBennett trigger installed for 3am Pacific');
}
