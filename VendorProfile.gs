// ============================================================
// VendorProfile.gs - one vendor, everything, one page (Sep 22 2026, c: parallel parts, index cache)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'vp_' to vpDispatch(d),
//          just before doPostBase.
//
// Backs cw-admin-hub/vendor-profile.html. READ ONLY. Every edit the page makes
// goes through the kinds that already own that data, so nothing here can write:
//   directory fields      adr_save (AdminRecords.gs, logged, undoable)
//   onboarding checklist  ob_save / ob_doc / ob_docs / ob_note (Onboarding.gs)
//   background checks     ob_bc_update (requests), vd_bc_upsert (people)
//   do not email / hide   dne_add / dne_remove / dne_hide (DoNotEmail.gs)
//
// Kinds (team passcode):
//   vp_index   slim list of every directory vendor for the search box (cached 10 min,
//              {fresh:true} bypasses the cache; the page sends that after a save)
//   vp_get     {vendor_id, part}  part 'head' = record + summary; 'onboarding' =
//              checklist, requests, log; 'crew' = background checks, evaluation,
//              audits; 'more' = the other books (responses, uploads, notices,
//              insurance, profile requests); 'core' = head + onboarding + crew.
//              The page fires head, onboarding, crew and more at once.
//
// How a record is tied to the vendor. Only the directory, Onboarding, BC
// Requests, the Background checks tabs, Audits and profile Requests carry a
// vendor_id. Everything else (opportunity responses, uploads, violation
// notices, insurance roster) was typed by the vendor or keyed by vendor number,
// so those are matched by normalized company name (obNorm_), email, or the
// vendor number, and each block says which ('id', 'name', 'email', 'vendor_no')
// so the page can flag a name match for a second look.
// ============================================================

function vpDispatch(d) {
  var kind = String(d.kind || '');
  if ((d.passcode || '') === '' || (d.passcode || '') !== vdPass_()) {
    return vdOut_({ ok: false, error: 'Wrong passcode.' });
  }
  try {
    if (kind === 'vp_index') return vpIndex_(d);
    if (kind === 'vp_get') return vpGet_(d);
    return vdOut_({ ok: false, error: 'Unknown vp kind' });
  } catch (e) {
    return vdOut_({ ok: false, error: String(e && e.message ? e.message : e), where: kind });
  }
}

// ------------------------------------------------------------ index ------

var VP_INDEX_KEY = 'vp_index_v1', VP_INDEX_TTL = 600;
function vpIndex_(d) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache && !d.fresh) {
    try {
      var hit = cache.get(VP_INDEX_KEY);
      if (hit) {
        var json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(hit), 'application/x-gzip')).getDataAsString();
        return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (e) {}
  }
  var ss = vdSS_();
  var out = [];
  vdAllRows_(ss).forEach(function (r) {
    if (!r.dba_name) return;
    out.push({
      vendor_id: r.vendor_id || '', dba_name: r.dba_name, legal_name: r.legal_name || '',
      contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '',
      region: vdRegion_(r.region), status: r.status || '', service_types: r.service_types || '',
      bc_vendor_no: r.bc_vendor_no || '', hide: vdTrue_(r.hide)
    });
  });
  out.sort(function (a, b) { return a.dba_name.toLowerCase() < b.dba_name.toLowerCase() ? -1 : 1; });
  var res = { ok: true, vendors: out, total: out.length, generated: new Date().toISOString(), cached: false };
  if (cache) {
    try {
      var packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(Object.assign({}, res, { cached: true })))).getBytes());
      if (packed.length < 95000) cache.put(VP_INDEX_KEY, packed, VP_INDEX_TTL);
    } catch (e) {}
  }
  return vdOut_(res);
}

// ------------------------------------------------------------ get --------

function vpGet_(d) {
  var vid = vdStr_(d.vendor_id);
  if (!vid) return vdOut_({ ok: false, error: 'No vendor id.' });
  var part = vdStr_(d.part) || 'core';
  var t0 = Date.now();
  var ss = vdSS_();
  var v = vpFindVendor_(ss, vid);
  if (!v) return vdOut_({ ok: false, error: 'No vendor with id ' + vid + ' on the directory.' });

  var m = vpMatcher_(v);
  var out = { ok: true, vendor_id: vid, part: part, errors: {}, timing: { find: Date.now() - t0 }, generated: new Date().toISOString() };
  function block(name, fn) {
    var t = Date.now();
    try { out[name] = fn(); } catch (e) { out.errors[name] = String(e && e.message ? e.message : e); }
    out.timing[name] = Date.now() - t;
  }

  // Parts. The page asks for head, onboarding, crew and more AT THE SAME TIME, so
  // the wall time is the slowest part, not the sum. 'core' is the old head +
  // onboarding + crew in one call, kept for anything that still asks for it.
  var want = { head: /^(core|head)$/.test(part), onboarding: /^(core|onboarding)$/.test(part), crew: /^(core|crew)$/.test(part), more: part === 'more' };
  if (want.head) {
    block('record', function () { return vpRecord_(v); });
    block('summary', function () { return vpSummary_(v, ss); });
  }
  if (want.onboarding) {
    block('onboarding', function () { return vpOnboarding_(ss, v, m); });
    block('requests', function () { return vpRequests_(ss, v, m); });
    block('log', function () { return vpLog_(ss, v, m, out.onboarding); });
  }
  if (want.crew) {
    block('crew', function () { return vpCrew_(ss, v, m); });
    block('intake', function () { return vpIntake_(ss, v, m); });
    block('audits', function () { return vpAudits_(ss, v); });
  }
  if (want.more) {
    block('responses', function () { return vpResponses_(v, m); });
    block('documents', function () { return vpDocuments_(v, m); });
    block('notices', function () { return vpNotices_(v, m); });
    block('insurance', function () { return vpInsurance_(v, m); });
    block('profile_requests', function () { return vpProfileRequests_(v, m); });
  }
  return vdOut_(out);
}


// One vendor row without reading both market tabs in full: scan the vendor_id
// column, then read that one row. Same shape vdAllRows_ gives (_sheet, _tab, _row).
function vpFindVendor_(ss, vid) {
  var sheets = vdVendorSheets_(ss);
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i].sh, last = sh.getLastRow();
    if (last < 2) continue;
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(vdStr_);
    var idc = head.indexOf('vendor_id');
    if (idc < 0) continue;
    var ids = sh.getRange(2, idc + 1, last - 1, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (vdStr_(ids[r][0]) !== vid) continue;
      var vals = sh.getRange(r + 2, 1, 1, head.length).getValues()[0];
      var o = { _row: r + 2, _sheet: sh, _tab: sheets[i].tab.name };
      for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vdStr_(vals[c]);
      if (!vdStr_(o.region) && sheets[i].tab.region) o.region = sheets[i].tab.region;
      if (!o.dba_name) return null;
      return o;
    }
  }
  return null;
}

// Read a tab but only as many columns as the caller needs (the wide JSON
// columns on the intake, notices and responses tabs are what makes a full
// getDataRange slow). Rows come back header keyed with _row, like vdRows_.
function vpRead_(sh, cols) {
  var lastC = Math.max(sh.getLastColumn(), 1), last = sh.getLastRow();
  var head = sh.getRange(1, 1, 1, lastC).getValues()[0].map(vdStr_);
  var need = lastC;
  if (cols && cols.length) {
    need = 0;
    cols.forEach(function (c) { var i = head.indexOf(c); if (i + 1 > need) need = i + 1; });
    if (!need) need = lastC;
  }
  if (last < 2) return { head: head, rows: [] };
  var vals = sh.getRange(2, 1, last - 1, need).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 }, any = false;
    for (var c = 0; c < need; c++) { if (!head[c]) continue; var x = vdStr_(vals[i][c]); o[head[c]] = x; if (x) any = true; }
    if (any) rows.push(o);
  }
  return { head: head, rows: rows };
}

// ------------------------------------------------------------ matching ---

function vpMatcher_(v) {
  var nd = obNorm_(v.dba_name), nl = obNorm_(v.legal_name || '');
  var mail = vdStr_(v.email).toLowerCase();
  var vno = vpVno_(v.bc_vendor_no);
  return {
    id: function (x) { return vdStr_(x) === v.vendor_id; },
    name: function (s) { var n = obNorm_(s); return !!n && (n === nd || (!!nl && n === nl)); },
    email: function (e) { var x = vdStr_(e).toLowerCase(); return !!mail && !!x && x === mail; },
    vno: function (x) { var y = vpVno_(x); return !!vno && !!y && y === vno; },
    dbaExact: function (s) { return vdStr_(s).toLowerCase() === vdStr_(v.dba_name).toLowerCase(); }
  };
}
function vpVno_(x) { return String(x == null ? '' : x).replace(/\D+/g, '').replace(/^0+/, ''); }
// Which rule tied a row to this vendor. Order matters: id beats everything.
function vpHow_(m, r, cols) {
  if (cols.id && m.id(r[cols.id])) return 'id';
  if (cols.vno && m.vno(r[cols.vno])) return 'vendor_no';
  if (cols.name && cols.name.some(function (c) { return m.name(r[c]); })) return 'name';
  if (cols.dba && cols.dba.some(function (c) { return m.dbaExact(r[c]); })) return 'name';
  if (cols.email && cols.email.some(function (c) { return m.email(r[c]); })) return 'email';
  return '';
}
function vpDesc_(a, b, key) {
  var x = vdStr_(a[key]), y = vdStr_(b[key]);
  return x < y ? 1 : x > y ? -1 : 0;
}

// ------------------------------------------------------------ core blocks

// The directory row, shaped exactly like adr_get so the page can save through
// adr_save with the same stale-value protection and the same undo log.
function vpRecord_(v) {
  var surfKey = v._tab === 'Vendors Northern Nevada' ? 'vendors_nnv' : 'vendors_lv';
  var surf = adrSurface_(surfKey);
  if (!surf) throw new Error('Record surface ' + surfKey + ' is not defined.');
  var sh = v._sheet;
  var head = adrHeaders_(sh);
  var vals = sh.getRange(v._row, 1, 1, head.length).getValues()[0];
  var rec = {}, fields = [], placed = {};
  function field(col) {
    var c = head.indexOf(col); if (c < 0 || placed[col]) return;
    placed[col] = true;
    var type = adrTypeOf_(surf, col, vals[c]);
    rec[col] = adrNorm_(vals[c], type);
    fields.push({ name: col, label: adrLabel_(surf, col), type: type, options: (surf.options && surf.options[col]) || null,
      readonly: (surf.readonly || []).indexOf(col) >= 0, internal: (surf.internal || []).indexOf(col) >= 0, section: '' });
  }
  (surf.sections || []).forEach(function (s) {
    s.fields.forEach(function (col) { var n = fields.length; field(col); if (fields.length > n) fields[n].section = s.name; });
  });
  head.forEach(function (col) { if (col && !placed[col]) { var n = fields.length; field(col); if (fields.length > n) fields[n].section = 'More'; } });
  var url = sh.getParent().getUrl().replace(/\/edit.*$/, '/edit') + '#gid=' + sh.getSheetId() + '&range=A' + v._row;
  return { surface: surfKey, tab: v._tab, row: v._row, id: v.vendor_id, rec: rec, fields: fields, url: url };
}

function vpSummary_(v, ss) {
  var slugs = vdSlugs_(v.service_types);
  var typeNames = {};
  try {
    var ts = ss.getSheetByName(VD_TABS.TYPES);
    if (ts) vdRows_(ts).rows.forEach(function (t) { if (t.slug) typeNames[t.slug] = t.name || t.slug; });
  } catch (e) {}
  var dne = false, dneErr = '';
  try { dne = dneHas_(dneSet_(ss), v.email); } catch (e) { dneErr = String(e.message || e); }
  var region = vdRegion_(v.region);
  return {
    vendor_id: v.vendor_id, dba_name: v.dba_name, legal_name: v.legal_name || '', status: v.status || '',
    region: region, market: region === 'Northern Nevada' ? 'nnv' : 'lv', both: region === 'Both',
    live: VD_LIVE_STATUS.indexOf(v.status) >= 0, prospect: VD_PROSPECT_STATUS.indexOf(v.status) >= 0,
    janitorial: slugs.indexOf(VD_JANITORIAL) >= 0,
    types: slugs.map(function (s) { return { slug: s, name: typeNames[s] || s }; }),
    contact_name: v.contact_name || '', email: v.email || '', phone: v.phone || '', business_phone: v.business_phone || '',
    website: v.website || '', city_state: v.city_state || '', ic_type: v.ic_type || '', bc_vendor_no: v.bc_vendor_no || '',
    cw_start_date: v.cw_start_date || '', source: v.source || '', eval_date: v.eval_date || '', updated: v.updated || '',
    gl_exp: v.gl_exp || '', wc_exp: v.wc_exp || '', last_audit: v.last_audit || '', audit_result: v.audit_result || '',
    audit_next_due: v.audit_next_due || '', audit_pdf: v.audit_pdf || '',
    hide: vdTrue_(v.hide), dne: dne, dne_error: dneErr, invited: vdInvIsPlaceholder_(v),
    internal_notes: v.internal_notes || '', outreach: v.outreach || ''
  };
}

function vpOnboarding_(ss, v, m) {
  var cfg = obChecklist_(ss);
  var sh = ss.getSheetByName(OB_TAB);
  var rows = sh ? obRows_(sh).rows : [];
  var mine = [], maybe = [];
  rows.forEach(function (r) {
    var how = vpHow_(m, r, { id: 'vendor_id', name: ['vendor'], email: ['email'] });
    if (!how) return;
    r.docs = obDocs_(r);
    delete r._row;
    if (how === 'id') mine.push(r);
    else if (!r.vendor_id) { r._how = how; maybe.push(r); }
  });
  mine.sort(function (a, b) { return vpDesc_(a, b, 'updated'); });
  return { checklist: cfg, stages: OB_STAGES, rows: mine, unmatched: maybe,
           req_types: OB_REQ_TYPES, req_status: OB_REQ_STATUS, badge: OB_BADGE };
}

function vpRequests_(ss, v, m) {
  var sh = ss.getSheetByName(OB_REQ_TAB);
  if (!sh) return { rows: [] };
  var out = [];
  obRows_(sh).rows.forEach(function (r) {
    var how = vpHow_(m, r, { id: 'vendor_id', name: ['company'] });
    if (!how) return;
    if (how !== 'id' && r.vendor_id) return;     // tied to a different vendor by id
    delete r._row;
    r.status = obReqStatus_(r.status);
    r._how = how;
    out.push(r);
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'received'); });
  return { rows: out };
}

function vpCrew_(ss, v, m) {
  var out = [];
  VD_BC_TABS.forEach(function (b) {
    var sh = ss.getSheetByName(b.name);
    if (!sh) return;
    vdRows_(sh).rows.forEach(function (r) {
      var name = [vdStr_(r.first_name), vdStr_(r.last_name)].filter(function (x) { return x; }).join(' ');
      if (!name) return;
      var how = vpHow_(m, r, { id: 'vendor_id', name: ['vendor', 'roster_company_as_typed'] });
      if (!how) return;
      if (how !== 'id' && r.vendor_id) return;
      out.push({ market: b.key, row: r._row, vendor_id: r.vendor_id || '', vendor: r.vendor || r.roster_company_as_typed || '',
                 first_name: r.first_name || '', last_name: r.last_name || '', status: r.status || '', result: vdBcRes_(r.result),
                 result_date: r.result_date || '', check_type: r.check_type || '', source: r.source || '',
                 first_check: r.first_check || '', most_recent_check: r.most_recent_check || '', notes: r.notes || '',
                 reviewed_by: r.reviewed_by || '', added: r.added || '', _how: how });
    });
  });
  out.sort(function (a, b) { return (a.last_name + a.first_name).toLowerCase() < (b.last_name + b.first_name).toLowerCase() ? -1 : 1; });
  return { rows: out, results: VD_BC_RESULT, types: VD_BC_TYPES, sources: VD_BC_SOURCES };
}

// Intake Log: EVAL rows carry the whole evaluation (raw JSON), INVITE rows carry
// who sent the invite and the email that went. Newest first, last 25.
function vpIntake_(ss, v, m) {
  var sh = ss.getSheetByName(VD_TABS.INTAKE);
  if (!sh) return { rows: [], eval: null };
  var rr = vpRead_(sh, ['received', 'submission_id', 'business_name', 'contact_name', 'email', 'phone', 'region', 'service_types', 'matched_vendor_id', 'action']);
  var rawCol = rr.head.indexOf('raw') + 1, out = [];
  rr.rows.forEach(function (r) {
    var how = vpHow_(m, r, { id: 'matched_vendor_id', name: ['business_name'], email: ['email'] });
    if (!how) return;
    if (how !== 'id' && r.matched_vendor_id && r.matched_vendor_id !== v.vendor_id) return;
    out.push({ received: r.received || '', kind: r.submission_id || '', business_name: r.business_name || '',
               contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '', region: r.region || '',
               service_types: r.service_types || '', action: r.action || '', _how: how, raw: null, _row: r._row });
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'received'); });
  // The raw JSON cell is only read for the newest few rows that need it.
  var first = out.filter(function (o) { return o.kind === 'EVAL'; })[0];
  if (first && rawCol) {
    var raw = vdStr_(sh.getRange(first._row, rawCol).getValue());
    if (raw) { try { first.raw = JSON.parse(raw); } catch (e) { first.raw_text = raw.slice(0, 4000); } }
  }
  out.forEach(function (o) { delete o._row; });
  var ev = out.filter(function (r) { return r.kind === 'EVAL' && r.raw; })[0] || null;
  return { rows: out.slice(0, 25).map(function (r) { var c = {}; for (var k in r) if (k !== 'raw' || r.kind !== 'EVAL') c[k] = r[k]; if (r.kind === 'EVAL') c.has_raw = !!r.raw; return c; }),
           eval: ev, eval_count: out.filter(function (r) { return r.kind === 'EVAL'; }).length };
}

function vpAudits_(ss, v) {
  var sh = ss.getSheetByName(AUD_TABS.AUDITS);
  if (!sh) return { rows: [] };
  var mine = vdRows_(sh).rows.filter(function (r) { return r.vendor_id === v.vendor_id && !vdTrue_(r.test); });
  var ids = {};
  var out = mine.map(function (r) {
    return { audit_id: r.audit_id, audit_date: r.audit_date || '', market: r.market || '', result: r.result || '',
             fail_reasons: r.fail_reasons || '', finding_list: r.finding_list || '', submitted_by: r.submitted_by || '',
             accounts_audited: r.accounts_audited || '', people_listed: r.people_listed || '', notes: r.notes || '',
             pdf_url: r.pdf_url || '', next_due: r.next_due || '' };
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'audit_date'); });
  return { rows: out };
}

function vpLog_(ss, v, m, ob) {
  var sh = ss.getSheetByName(OB_LOG_TAB);
  if (!sh) return { rows: [] };
  var ids = {};
  ((ob && ob.rows) || []).forEach(function (r) { ids[r.ob_id] = true; });
  var out = [];
  obRows_(sh).rows.forEach(function (r) {
    if (!(r.ob_id && ids[r.ob_id]) && !m.name(r.vendor)) return;
    delete r._row;
    out.push(r);
  });
  return { rows: out.slice(Math.max(0, out.length - 60)).reverse() };
}

// ------------------------------------------------------------ more blocks

function vpResponses_(v, m) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(RESP_TAB);
  if (!sh) return { rows: [] };
  var out = [];
  vpRead_(sh, ['response_id', 'received', 'posting_id', 'posting_title', 'region', 'trade', 'mode', 'company', 'contact_name', 'email', 'phone', 'earliest_start', 'crew_size', 'quote_amount', 'quote_basis', 'comments', 'account_name', 'pdf_url']).rows.forEach(function (r) {
    var how = vpHow_(m, r, { name: ['company'], email: ['email'] });
    if (!how) return;
    out.push({ response_id: r.response_id || '', received: r.received || '', posting_id: r.posting_id || '',
               posting_title: r.posting_title || '', region: r.region || '', trade: r.trade || '', mode: r.mode || '',
               company: r.company || '', contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '',
               earliest_start: r.earliest_start || '', crew_size: r.crew_size || '', quote_amount: r.quote_amount || '',
               quote_basis: r.quote_basis || '', comments: r.comments || '', account_name: r.account_name || '',
               pdf_url: r.pdf_url || '', _how: how });
  });
  // Is the posting still open? One pass over the Solicitations tab.
  try {
    var ps = ss.getSheetByName(TAB), open = {};
    if (ps && out.length) {
      vpRead_(ps, ['id', 'filled']).rows.forEach(function (p) { if (p.id) open[p.id] = vdTrue_(p.filled) ? 'filled' : 'open'; });
      out.forEach(function (r) { r.posting_state = open[r.posting_id] || ''; });
    }
  } catch (e) {}
  out.sort(function (a, b) { return vpDesc_(a, b, 'received'); });
  return { rows: out };
}

function vpDocuments_(v, m) {
  var sh = docSheet_();
  var out = [];
  vdRows_(sh).rows.forEach(function (r) {
    var how = vpHow_(m, r, { name: ['company'], email: ['email'] });
    if (!how) return;
    out.push({ doc_id: r.doc_id || '', received: r.received || '', doc_type: r.doc_type || '', coi_coverage: r.coi_coverage || '',
               region: r.region || '', entity: r.entity || '', company: r.company || '', agency: r.agency || '',
               first_name: r.first_name || '', last_name: r.last_name || '', email: r.email || '', comments: r.comments || '',
               file_names: r.file_names || '', drive_links: r.drive_links || '', _how: how });
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'received'); });
  return { rows: out };
}

function vpNotices_(v, m) {
  var ss = vioSS_();
  var sh = ss.getSheetByName(VIO_TABS.LOG);
  if (!sh) return { rows: [] };
  var out = [];
  vpRead_(sh, ['notice_id', 'issued', 'test', 'market', 'level', 'nature', 'issuer_name', 'ic_dba', 'ic_owner', 'ic_email', 'vendor_no', 'account', 'inspection_date', 'findings_summary', 'chargeback_amount', 'email_status', 'status', 'corrected_date', 'notes', 'approved_by', 'approved_date']).rows.forEach(function (r) {
    if (vdTrue_(r.test)) return;
    var how = vpHow_(m, r, { vno: 'vendor_no', dba: ['ic_dba'], name: ['ic_dba'], email: ['ic_email'] });
    if (!how) return;
    out.push({ notice_id: r.notice_id || '', issued: r.issued || '', market: r.market || '', level: r.level || '',
               nature: r.nature || '', issuer_name: r.issuer_name || '', account: r.account || '',
               inspection_date: r.inspection_date || '', findings_summary: r.findings_summary || '',
               chargeback_amount: r.chargeback_amount || '', status: r.status || '', email_status: r.email_status || '',
               corrected_date: r.corrected_date || '', approved_by: r.approved_by || '', approved_date: r.approved_date || '',
               notes: r.notes || '', _how: how });
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'issued'); });
  return { rows: out };
}

// COI expiry as Insurance.gs tracks it (Roster tab on the violations book), next
// to the copy on the directory row, so the page can show both and flag drift.
function vpInsurance_(v, m) {
  var ss = insSS_();
  var sh = ss.getSheetByName(INS_TABS.ROSTER);
  var hit = null;
  if (sh) {
    vdRows_(sh).rows.some(function (r) {
      var how = vpHow_(m, r, { vno: 'vendor_no', dba: ['dba'] });
      if (!how) return false;
      hit = { market: r.market || '', dba: r.dba || '', vendor_no: r.vendor_no || '', gl_exp: r.gl_exp || '', wc_exp: r.wc_exp || '', _how: how };
      return true;
    });
  }
  var todayMs = Date.now();
  function state(x) { try { return insExpiryState_(x, todayMs); } catch (e) { return { state: 'unknown', label: x || '' }; } }
  var log = [];
  try {
    var ls = ss.getSheetByName(INS_TABS.LOG);
    if (ls) vdRows_(ls).rows.forEach(function (r) {
      if (vdTrue_(r.test)) return;
      var how = vpHow_(m, r, { vno: 'vendor_no', dba: ['vendor_dba'], email: ['vendor_email'] });
      if (!how) return;
      log.push({ sent: r.sent || '', coverage: r.coverage || '', issuer_name: r.issuer_name || '', email_status: r.email_status || '', _how: how });
    });
    log.sort(function (a, b) { return vpDesc_(a, b, 'sent'); });
  } catch (e) {}
  return { roster: hit, directory: { gl_exp: v.gl_exp || '', wc_exp: v.wc_exp || '' },
           gl: state(hit ? hit.gl_exp : v.gl_exp), wc: state(hit ? hit.wc_exp : v.wc_exp), reminders: log.slice(0, 10) };
}

function vpProfileRequests_(v, m) {
  var sh = profSheet_();
  var out = [];
  vpRead_(sh, ['request_id', 'received', 'status', 'region', 'company', 'matched_vendor_id', 'submitted_by', 'role', 'submitter_email', 'changes', 'phone_main', 'contact_name', 'contact_email', 'address', 'name_new', 'other_text', 'notes', 'drive_links', 'verified_by', 'applied_by']).rows.forEach(function (r) {
    var how = vpHow_(m, r, { id: 'matched_vendor_id', name: ['company'], email: ['submitter_email'] });
    if (!how) return;
    if (how !== 'id' && r.matched_vendor_id && r.matched_vendor_id !== v.vendor_id) return;
    out.push({ request_id: r.request_id || '', received: r.received || '', status: r.status || '', region: r.region || '',
               submitted_by: r.submitted_by || '', role: r.role || '', changes: r.changes || '',
               contact_name: r.contact_name || '', contact_email: r.contact_email || '', phone_main: r.phone_main || '',
               address: r.address || '', name_new: r.name_new || '', other_text: r.other_text || '', notes: r.notes || '',
               drive_links: r.drive_links || '', verified_by: r.verified_by || '', applied_by: r.applied_by || '', _how: how });
  });
  out.sort(function (a, b) { return vpDesc_(a, b, 'received'); });
  return { rows: out };
}
