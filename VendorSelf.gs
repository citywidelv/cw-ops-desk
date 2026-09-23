/* VendorSelf.gs - CW Solicitations project. Build 2026-09-23a.
   Vendor self-service profile (cw-vendor-hub/my-profile.html) and the Admin Hub
   Vendor Activity feed (cw-admin-hub/vendor-activity.html).

   Router: doPost must route the vs_ prefix here, before doPostBase:
     if (d && String(d.kind||'').indexOf('vs_') === 0) return vsDispatch(d);

   HOW A VENDOR GETS IN. No passwords. The vendor types an email on the page.
   If that email is the vendor's directory email, or a Vendor Contact with
   can_edit TRUE, a link with a one-time token lands in that inbox. The link
   works for VS_LINK_HOURS. The page never learns whether the email was on file:
   the reply is identical either way, so nobody can use the box to test which
   vendors exist. Requests are rate limited per email and overall.

   WHAT A VENDOR MAY CHANGE (VS_EDIT below). Contact name, phones, website,
   address, metro areas, crew size, services description, license number,
   service types, the evaluation answers, references. Every change carries the
   value the vendor last saw; a cell that changed since is skipped as stale.
   Every change is logged to the Site Admin Log (previous value kept), written
   to the Vendor Activity tab for Angel, and emailed to the market compliance
   inbox so the other systems (CRM, Business Central, emfluence) get synced.

   WHAT A VENDOR MAY SEE BUT NOT CHANGE (VS_VIEW). Vendor id, DBA, legal name,
   status, region, IC type, vendor number, start date, primary email, insurance
   expiration dates, audit dates and result, onboarding checklist states, crew
   clearance (cleared / pending / not cleared, never a reason), documents on file.

   WHAT NEVER LEAVES THE SERVER. internal_notes, outreach, hide, monthly_revenue,
   cw_clients, source, added_by, trade_raw, audit PDFs, violation notices, the
   fix notes on onboarding items, anything about another vendor.

   NOT HERE ON PURPOSE. Primary email, DBA / legal name, entity, banking, W-9.
   Those stay on profile-update.html (Profile.gs), which is a pending request a
   person verifies at the contact already on file. The self-service page links
   there.

   Kinds, vendor side (token, no passcode):
     vs_request        {email, company_fax}                -> {ok, message} (always the same)
     vs_get            {token, part:'head'|'compliance'}   -> profile blocks
     vs_save           {token, changes:{col:{old,new}}}    -> {ok, written, stale, skipped}
     vs_contact        {token, contact:{...}}              -> {ok, contacts}
     vs_contact_remove {token, contact_id}                 -> {ok, contacts}
     vs_details        {token, details:{...}}              -> {ok, details}
   Kinds, admin side (team passcode):
     vs_admin_contacts {vendor_id}                         -> {ok, contacts, details, links, activity}
     vs_admin_contact  {vendor_id, contact:{...}, who}     -> {ok, contacts}
     vs_admin_contact_remove {vendor_id, contact_id, who}  -> {ok, contacts}
     vs_admin_link     {vendor_id, email, who}             -> {ok, sent_to}
     vs_feed           {source, days}                      -> {ok, items, statuses}
     vs_feed_set       {keys, status, by}                  -> {ok, saved}

   Tabs (all on the CW Vendor Directory book, vdSS_):
     Vendor Contacts, Vendor Details, Profile Links, Vendor Activity, Activity Status.
   Rows are never deleted. A removed contact gets a removed date.
*/

var VS_TZ = 'America/Los_Angeles';
var VS_PAGE = 'https://citywidelv.github.io/cw-vendor-hub/my-profile.html';
var VS_PROFILE_ADMIN = 'https://citywidelv.github.io/cw-admin-hub/vendor-profile.html';
var VS_UPLOAD = 'https://citywidelv.github.io/cw-vendor-hub/upload.html';
var VS_PROFILE_FORM = 'https://citywidelv.github.io/cw-vendor-hub/profile-update.html';
var VS_EVAL = 'https://citywidelv.github.io/cw-vendor-hub/vendor-evaluation.html';
var VS_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var VS_LINK_HOURS = 24;
var VS_RATE_EMAIL = 3;      // link requests per email per hour
var VS_RATE_ALL = 60;       // link requests platform-wide per hour
var VS_FEED_DAYS = 45;      // feed window
var VS_FEED_DONE_DAYS = 7;  // handled items stay visible this long

var VS_TABS = { CONTACTS: 'Vendor Contacts', DETAILS: 'Vendor Details', LINKS: 'Profile Links',
                ACT: 'Vendor Activity', STATUS: 'Activity Status' };
var VS_CONTACT_HEADERS = ['contact_id', 'vendor_id', 'vendor', 'name', 'role', 'title', 'email', 'mobile', 'phone',
  'use_for', 'can_edit', 'notes', 'added', 'added_by', 'updated', 'updated_by', 'removed', 'removed_by'];
var VS_DETAIL_HEADERS = ['vendor_id', 'vendor', 'capacity', 'capacity_notes', 'preferred_language', 'crew_languages',
  'equipment', 'certifications', 'after_hours_phone', 'emergency_name', 'emergency_phone', 'notes_for_cw',
  'updated', 'updated_by'];
var VS_LINK_HEADERS = ['token', 'vendor_id', 'vendor', 'email', 'contact_id', 'name', 'created', 'expires', 'expires_ms', 'opened',
  'last_used', 'revoked', 'sent_by'];
var VS_ACT_HEADERS = ['event_id', 'when', 'vendor_id', 'vendor', 'market', 'type', 'summary', 'detail',
  'actor', 'actor_email', 'ref'];
var VS_STATUS_HEADERS = ['alert_key', 'type', 'status', 'handled_by', 'handled_at', 'summary'];

var VS_ROLES = ['Owner', 'Manager', 'Supervisor', 'Office / Billing', 'Other'];
var VS_EDIT_ROLES = ['Owner', 'Manager'];          // can_edit defaults on for these
var VS_USE_FOR = ['Opportunities', 'Compliance notices', 'Invoicing and payments', 'Scheduling', 'Emergencies', 'After hours'];
var VS_CAPACITY = ['Taking new work', 'Full for now', 'Taking small jobs only'];
var VS_LANGS = ['English', 'Spanish', 'English and Spanish', 'Other'];

// Directory columns the vendor may write. Nothing outside this list is ever
// written from a token, whatever the payload says.
var VS_EDIT = ['contact_name', 'phone', 'business_phone', 'website', 'business_address', 'city_state', 'metro_areas',
  'years_in_business', 'crew_ft', 'crew_pt', 'services_desc', 'license_no', 'service_types',
  'workers_comp', 'general_liability', 'background_checks', 'sut_paid', 'wage_compliance', 'documented_pay',
  'i9_collected', 'daily_supervision', 'concern_process', 'family_involvement', 'additional_notes',
  'ref1_company', 'ref1_name', 'ref1_phone', 'ref1_email', 'ref2_company', 'ref2_name', 'ref2_phone', 'ref2_email'];
// Directory columns the vendor may read but not write.
var VS_VIEW = ['vendor_id', 'dba_name', 'legal_name', 'status', 'region', 'ic_type', 'bc_vendor_no', 'cw_start_date',
  'email', 'eval_date', 'updated', 'gl_exp', 'wc_exp', 'last_audit', 'audit_result', 'audit_next_due'];
var VS_NUMERIC = ['years_in_business', 'crew_ft', 'crew_pt'];
var VS_YESNO = ['workers_comp', 'general_liability', 'background_checks', 'sut_paid', 'wage_compliance',
  'documented_pay', 'i9_collected', 'daily_supervision'];
var VS_LABEL = {
  contact_name: 'Primary contact', phone: 'Phone', business_phone: 'Business phone', website: 'Website',
  business_address: 'Business address', city_state: 'City and state', metro_areas: 'Areas you serve',
  years_in_business: 'Years in business', crew_ft: 'Full-time crew', crew_pt: 'Part-time crew',
  services_desc: 'What your company does', license_no: 'License number', service_types: 'Service types',
  workers_comp: 'Workers compensation coverage', general_liability: 'General liability coverage',
  background_checks: 'Background checks on crew', sut_paid: 'Unemployment tax paid', wage_compliance: 'Wage law compliance',
  documented_pay: 'Documented pay records', i9_collected: 'I-9s collected', daily_supervision: 'Daily supervision',
  concern_process: 'How you handle a concern', family_involvement: 'Family involvement', additional_notes: 'Additional notes',
  ref1_company: 'Reference 1 company', ref1_name: 'Reference 1 name', ref1_phone: 'Reference 1 phone', ref1_email: 'Reference 1 email',
  ref2_company: 'Reference 2 company', ref2_name: 'Reference 2 name', ref2_phone: 'Reference 2 phone', ref2_email: 'Reference 2 email'
};
// Onboarding checklist items that are City Wide's own steps. The vendor never sees them.
var VS_OB_INTERNAL = ['packet_sent', 'crm_account', 'crm_js', 'crm_os', 'crm_class', 'profile', 'accounting', 'bc_request'];
var VS_FEED_STATUS = {
  profile_edit: ['Synced to other systems', 'Reviewed'],
  contact: ['Synced to other systems', 'Reviewed'],
  details: ['Reviewed'],
  eval: ['Reviewed', 'Not a fit'],
  intake: ['Reviewed', 'Not a fit'],
  request: ['Applied', 'Reviewed'],
  upload: ['Filed', 'Reviewed'],
  bc: ['Reviewed'],
  audit: ['Reviewed'],
  response: ['Reviewed'],
  cleaner: ['Reviewed'],
  link: ['Reviewed']
};

// ------------------------------------------------------------ helpers -----

function vsOut_(o) { return _json(o); }
function vsStr_(v, max) { var s = vdStr_(v); return max ? s.slice(0, max) : s; }
function vsNow_() { return Utilities.formatDate(new Date(), VS_TZ, 'yyyy-MM-dd HH:mm'); }
function vsToday_() { return Utilities.formatDate(new Date(), VS_TZ, 'yyyy-MM-dd'); }
function vsId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), VS_TZ, 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function vsEmail_(v) { return vsStr_(v, 160).toLowerCase(); }
function vsEmailOk_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')); }
function vsTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    // Append any header the tab is missing so a schema change shows up as a column, never a mis-map.
    var lastC = Math.max(sh.getLastColumn(), 1);
    var have = sh.getRange(1, 1, 1, lastC).getValues()[0].map(vdStr_);
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length && have.join('') !== '') {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    } else if (have.join('') === '') {
      return vdTab_(ss, name, headers, '#636466');
    }
    return sh;
  }
  return vdTab_(ss, name, headers, '#636466');
}
// Like vpRead_, but a Date cell keeps its time (Sheets turns 'yyyy-MM-dd HH:mm'
// strings into Dates on write, and vdStr_ would drop the time on the way back).
function vsVal_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, VS_TZ, 'yyyy-MM-dd HH:mm');
  return vdStr_(v);
}
function vsRead_(sh, cols) {
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
    for (var c = 0; c < need; c++) { if (!head[c]) continue; var x = vsVal_(vals[i][c]); o[head[c]] = x; if (x) any = true; }
    if (any) rows.push(o);
  }
  return { head: head, rows: rows };
}
function vsRows_(sh) { return vsRead_(sh).rows; }
function vsHeaders_(sh) {
  var lastC = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lastC).getValues()[0].map(vdStr_);
}
function vsNextRow_(sh) {
  // First row with an empty column A. getLastRow is unsafe on tabs with validation painted down.
  var last = sh.getLastRow();
  if (last < 2) return 2;
  var a = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < a.length; i++) if (vdStr_(a[i][0]) === '') return i + 2;
  return last + 1;
}
function vsAppend_(sh, headers, obj) {
  var head = vsHeaders_(sh);
  var row = head.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  var r = vsNextRow_(sh);
  sh.getRange(r, 1, 1, head.length).setValues([row]);
  return r;
}
function vsSet_(sh, head, row, field, value) {
  var c = head.indexOf(field);
  if (c >= 0) sh.getRange(row, c + 1).setValue(value);
}
function vsMarketKey_(v) { return vdRegion_(v.region) === 'Northern Nevada' ? 'nnv' : 'lv'; }
function vsMarket_(v) { return OB_MARKETS[vsMarketKey_(v)]; }
function vsMarketCode_(region) { return /north/i.test(String(region || '')) ? 'NNV' : 'LV'; }
function vsEsc_(s) { return _esc(s); }
function vsPass_(d) { return String(d.passcode || '') !== '' && String(d.passcode || '') === vdPass_(); }
function vsWho_(d) { return vsStr_(d.who || d.by || '', 80) || 'admin'; }
function vsCoerce_(col, v) {
  var s = vsStr_(v, col === 'services_desc' || col === 'concern_process' || col === 'additional_notes' || col === 'family_involvement' ? 4000 : 300);
  if (VS_NUMERIC.indexOf(col) >= 0) {
    var n = Number(s.replace(/[$,\s]/g, ''));
    return s === '' || isNaN(n) ? '' : n;
  }
  if (VS_YESNO.indexOf(col) >= 0) {
    var l = s.toLowerCase();
    return l === 'yes' ? 'Yes' : l === 'no' ? 'No' : s;
  }
  if (col === 'service_types') return vdSlugs_(s).join(',');
  if (col === 'website' && s && !/^https?:\/\//i.test(s)) return 'https://' + s;
  return s;
}

// ------------------------------------------------------------ rate limit --

function vsRate_(email) {
  try {
    var c = CacheService.getScriptCache();
    var k1 = 'vs_rl:' + email, k2 = 'vs_rl_all';
    var n1 = Number(c.get(k1) || 0), n2 = Number(c.get(k2) || 0);
    if (n1 >= VS_RATE_EMAIL || n2 >= VS_RATE_ALL) return false;
    c.put(k1, String(n1 + 1), 3600);
    c.put(k2, String(n2 + 1), 3600);
  } catch (e) {}
  return true;
}

// ------------------------------------------------------------ tokens ------

function vsToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
}
function vsLinkCreate_(ss, v, email, contactId, name, sentBy) {
  var sh = vsTab_(ss, VS_TABS.LINKS, VS_LINK_HEADERS);
  var token = vsToken_();
  var now = new Date();
  var exp = new Date(now.getTime() + VS_LINK_HOURS * 3600 * 1000);
  vsAppend_(sh, VS_LINK_HEADERS, {
    token: token, vendor_id: v.vendor_id, vendor: v.dba_name, email: email, contact_id: contactId || '', name: name || '',
    created: Utilities.formatDate(now, VS_TZ, 'yyyy-MM-dd HH:mm'), expires: Utilities.formatDate(exp, VS_TZ, 'yyyy-MM-dd HH:mm'),
    expires_ms: exp.getTime(), opened: '', last_used: '', revoked: '', sent_by: sentBy || 'vendor request'
  });
  return token;
}
function vsParseStamp_(s) {
  // 'yyyy-MM-dd HH:mm' written in VS_TZ. Compare in the same zone by formatting now the same way.
  return String(s || '');
}
function vsLinkFind_(ss, token) {
  token = vsStr_(token, 80);
  if (!token || token.length < 20) return null;
  var sh = ss.getSheetByName(VS_TABS.LINKS);
  if (!sh) return null;
  var head = vsHeaders_(sh);
  var tc = head.indexOf('token');
  if (tc < 0) return null;
  var last = sh.getLastRow();
  if (last < 2) return null;
  var toks = sh.getRange(2, tc + 1, last - 1, 1).getValues();
  for (var i = 0; i < toks.length; i++) {
    if (vdStr_(toks[i][0]) !== token) continue;
    var vals = sh.getRange(i + 2, 1, 1, head.length).getValues()[0];
    var o = { _row: i + 2, _sheet: sh, _head: head };
    head.forEach(function (h, c) { if (h) o[h] = vsVal_(vals[c]); });
    o._expiresMs = Number(o.expires_ms) || 0;
    return o;
  }
  return null;
}
function vsLinkCheck_(ss, token) {
  var hit = vsLinkFind_(ss, token);
  if (!hit) return { error: 'This link is not valid. Request a new one from the profile page.' };
  if (hit.revoked) return { error: 'This link was cancelled. Request a new one from the profile page.' };
  var expired = hit._expiresMs ? (Date.now() > hit._expiresMs) : (vsParseStamp_(hit.expires) < vsNow_());
  if (expired) return { error: 'This link has expired. Request a new one from the profile page.', expired: true };
  return { hit: hit };
}
function vsLinkTouch_(hit, opened) {
  try {
    if (opened && !hit.opened) vsSet_(hit._sheet, hit._head, hit._row, 'opened', vsNow_());
    vsSet_(hit._sheet, hit._head, hit._row, 'last_used', vsNow_());
  } catch (e) {}
}
function vsLinkRevokeContact_(ss, vendorId, contactId) {
  var sh = ss.getSheetByName(VS_TABS.LINKS);
  if (!sh || !contactId) return;
  var head = vsHeaders_(sh);
  vsRows_(sh).forEach(function (r) {
    if (r.vendor_id === vendorId && r.contact_id === contactId && !r.revoked) vsSet_(sh, head, r._row, 'revoked', vsNow_());
  });
}

// Who may ask for a link to this vendor: the directory email, or a contact with can_edit.
function vsTargetsForEmail_(ss, email) {
  var out = {}, order = [];
  vdAllRows_(ss).forEach(function (v) {
    if (!v.dba_name || !v.vendor_id) return;
    if (vsEmail_(v.email) !== email) return;
    if (!out[v.vendor_id]) { out[v.vendor_id] = { v: v, contact_id: '', name: v.contact_name || '' }; order.push(v.vendor_id); }
  });
  var sh = ss.getSheetByName(VS_TABS.CONTACTS);
  if (sh) {
    vsRows_(sh).forEach(function (c) {
      if (c.removed || !vdTrue_(c.can_edit) || vsEmail_(c.email) !== email || !c.vendor_id) return;
      if (out[c.vendor_id]) { if (!out[c.vendor_id].contact_id) { out[c.vendor_id].contact_id = c.contact_id; out[c.vendor_id].name = c.name; } return; }
      var v = vpFindVendor_(ss, c.vendor_id);
      if (!v) return;
      out[c.vendor_id] = { v: v, contact_id: c.contact_id, name: c.name };
      order.push(c.vendor_id);
    });
  }
  return order.map(function (id) { return out[id]; });
}

// ------------------------------------------------------------ activity ----

function vsAct_(ss, e) {
  try {
    var sh = vsTab_(ss, VS_TABS.ACT, VS_ACT_HEADERS);
    var id = vsId_('VA');
    vsAppend_(sh, VS_ACT_HEADERS, {
      event_id: id, when: vsNow_(), vendor_id: e.vendor_id || '', vendor: e.vendor || '', market: e.market || '',
      type: e.type || '', summary: vsStr_(e.summary, 300), detail: vsStr_(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail || ''), 20000),
      actor: vsStr_(e.actor, 120), actor_email: vsStr_(e.actor_email, 160), ref: vsStr_(e.ref, 200)
    });
    return id;
  } catch (err) { return ''; }
}
function vsLog_(who, surface, tab, row, field, oldv, newv) {
  try { if (typeof saLog_ === 'function') saLog_(who, 'vendor-edit', surface, tab, row, field, oldv, newv); } catch (e) {}
}

// ------------------------------------------------------------ dispatch ----

function vsDispatch(d) {
  var kind = String(d.kind || '');
  try {
    // vendor side, token keyed
    if (kind === 'vs_request') return vsOut_(vsRequest_(d));
    if (kind === 'vs_get') return vsOut_(vsGet_(d));
    if (kind === 'vs_save') return vsOut_(vsSave_(d));
    if (kind === 'vs_contact') return vsOut_(vsContact_(d));
    if (kind === 'vs_contact_remove') return vsOut_(vsContactRemove_(d));
    if (kind === 'vs_details') return vsOut_(vsDetails_(d));
    // admin side, team passcode
    if (!vsPass_(d)) return vsOut_({ ok: false, error: 'Wrong passcode.' });
    if (kind === 'vs_admin_contacts') return vsOut_(vsAdminContacts_(d));
    if (kind === 'vs_admin_contact') return vsOut_(vsAdminContact_(d));
    if (kind === 'vs_admin_contact_remove') return vsOut_(vsAdminContactRemove_(d));
    if (kind === 'vs_admin_link') return vsOut_(vsAdminLink_(d));
    if (kind === 'vs_feed') return vsOut_(vsFeed_(d));
    if (kind === 'vs_feed_set') return vsOut_(vsFeedSet_(d));
  } catch (e) {
    return vsOut_({ ok: false, error: String(e && e.message || e), where: kind });
  }
  return vsOut_({ ok: false, error: 'Unknown vs kind ' + kind });
}

// Resolves a vendor-side call: token -> {ss, hit, v, mk, actor} or {error}.
function vsAuth_(d, opened) {
  var ss = vdSS_();
  var chk = vsLinkCheck_(ss, d.token);
  if (chk.error) return { error: chk.error, expired: !!chk.expired };
  var v = vpFindVendor_(ss, chk.hit.vendor_id);
  if (!v) return { error: 'We could not find your vendor record. Email your compliance office.' };
  vsLinkTouch_(chk.hit, opened);
  var actorName = chk.hit.name || v.contact_name || v.dba_name;
  return { ss: ss, hit: chk.hit, v: v, mk: vsMarket_(v), actor: actorName, actor_email: chk.hit.email };
}

// ------------------------------------------------------------ vs_request --

function vsRequest_(d) {
  var GENERIC = { ok: true, message: 'If that email is on file with us, your link is on the way. Give it a few minutes and check spam. Still nothing? Email your compliance office and we will send it by hand.' };
  if (vsStr_(d.company_fax) || vsStr_(d.website_hp)) return GENERIC;   // honeypot
  var email = vsEmail_(d.email);
  if (!vsEmailOk_(email)) return { ok: false, error: 'Enter the email address we have on file for your company.' };
  if (!vsRate_(email)) return GENERIC;
  var ss = vdSS_();
  var targets = vsTargetsForEmail_(ss, email);
  if (!targets.length) return GENERIC;
  var links = targets.map(function (t) {
    var token = vsLinkCreate_(ss, t.v, email, t.contact_id, t.name, 'vendor request');
    return { v: t.v, url: VS_PAGE + '?t=' + token };
  });
  var mk = vsMarket_(targets[0].v);
  vsSendLink_(email, links, mk);
  targets.forEach(function (t) {
    vsAct_(ss, { vendor_id: t.v.vendor_id, vendor: t.v.dba_name, market: vsMarketCode_(t.v.region), type: 'link',
                 summary: 'Asked for a profile link', actor: t.v.contact_name || '', actor_email: email });
  });
  return GENERIC;
}

function vsSendLink_(email, links, mk) {
  var one = links.length === 1;
  var rows = links.map(function (l) {
    return '<p style="margin:0 0 16px;">' + (one ? '' : '<b style="font-family:Verdana,Arial,sans-serif;font-size:13px;color:#2D2A26;">' + vsEsc_(l.v.dba_name) + '</b><br>') +
      '<a href="' + l.url + '" style="display:inline-block;background:#D22730;color:#fff;font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:6px;">Open my vendor profile</a></p>';
  }).join('');
  var html = '<div style="font-family:Verdana,Arial,sans-serif;color:#2D2A26;max-width:560px;margin:0 auto;padding:8px 0;">' +
    '<img src="' + VS_LOGO + '" alt="City Wide Facility Solutions" style="height:40px;margin:0 0 18px;display:block;">' +
    '<p style="font-size:14px;line-height:1.55;margin:0 0 16px;">Here is your link to view and update your City Wide vendor profile' + (one ? ' for <b>' + vsEsc_(links[0].v.dba_name) + '</b>' : '') + '. It works for ' + VS_LINK_HOURS + ' hours.</p>' +
    rows +
    '<p style="font-size:12px;line-height:1.55;color:#636466;margin:16px 0 0;">If you did not ask for this, ignore this email. Nothing changes until someone opens the link.<br>Questions: ' + vsEsc_(mk.compliance) + '</p></div>';
  var plain = 'Here is your link to view and update your City Wide vendor profile. It works for ' + VS_LINK_HOURS + ' hours.\n\n' +
    links.map(function (l) { return (one ? '' : l.v.dba_name + '\n') + l.url; }).join('\n\n') +
    '\n\nIf you did not ask for this, ignore this email. Questions: ' + mk.compliance;
  var opts = { to: email, name: mk.sender, replyTo: mk.compliance, subject: 'Your City Wide vendor profile link', body: plain, htmlBody: html };
  if (typeof cwMail_ === 'function') cwMail_('vs_link', opts); else cwSend_(opts);
}

// ------------------------------------------------------------ vs_get ------

function vsGet_(d) {
  var a = vsAuth_(d, true);
  if (a.error) return { ok: false, error: a.error, expired: a.expired };
  var part = vsStr_(d.part) || 'head';
  var out = { ok: true, part: part, vendor_id: a.v.vendor_id, expires: a.hit.expires, errors: {}, generated: vsNow_() };
  function block(name, fn) { try { out[name] = fn(); } catch (e) { out.errors[name] = String(e && e.message || e); } }
  if (part === 'head') {
    block('vendor', function () { return vsVendorView_(a.v); });
    block('types', function () { return vsTypes_(a.ss); });
    block('contacts', function () { return vsContacts_(a.ss, a.v.vendor_id); });
    block('details', function () { return vsDetailsRead_(a.ss, a.v.vendor_id); });
    out.lists = { roles: VS_ROLES, use_for: VS_USE_FOR, capacity: VS_CAPACITY, languages: VS_LANGS, edit_roles: VS_EDIT_ROLES };
    out.links = vsLinks_(a.v, a.mk);
    out.you = { name: a.actor, email: a.actor_email };
  } else if (part === 'compliance') {
    var m = vpMatcher_(a.v);
    block('insurance', function () { return vsInsurance_(a.v, m); });
    block('onboarding', function () { return vsOnboarding_(a.ss, a.v, m); });
    block('crew', function () { return vsCrew_(a.ss, a.v, m); });
    block('audit', function () { return vsAudit_(a.ss, a.v); });
    block('documents', function () { return vsDocuments_(a.v, m); });
  } else return { ok: false, error: 'Unknown part' };
  return out;
}

function vsLinks_(v, mk) {
  var rk = vsMarketKey_(v);
  var q = 'region=' + rk + '&company=' + encodeURIComponent(v.dba_name || '');
  return { upload: VS_UPLOAD + '?' + q, upload_coi: VS_UPLOAD + '?doc=coi&' + q, profile_form: VS_PROFILE_FORM + '?' + q,
           eval: VS_EVAL + '?region=' + rk, compliance_email: mk.compliance, market: mk.name };
}

function vsVendorView_(v) {
  var view = {}, edit = {};
  VS_VIEW.forEach(function (c) { view[c] = v[c] || ''; });
  VS_EDIT.forEach(function (c) { edit[c] = v[c] || ''; });
  view.region = vdRegion_(v.region);
  view.market = vsMarketKey_(v);
  view.live = VD_LIVE_STATUS.indexOf(v.status) >= 0;
  return { view: view, edit: edit, labels: VS_LABEL, yesno: VS_YESNO, numeric: VS_NUMERIC };
}

function vsTypes_(ss) {
  var sh = ss.getSheetByName(VD_TABS.TYPES);
  if (!sh) return [];
  return vdRows_(sh).rows.filter(function (t) { return t.slug && vdStr_(t.active).toUpperCase() !== 'FALSE'; })
    .sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); })
    .map(function (t) { return { slug: t.slug, name: t.name || t.slug }; });
}

function vsContacts_(ss, vendorId) {
  var sh = ss.getSheetByName(VS_TABS.CONTACTS);
  if (!sh) return [];
  return vsRows_(sh).filter(function (c) { return c.vendor_id === vendorId && !c.removed; })
    .map(function (c) {
      return { contact_id: c.contact_id, name: c.name, role: c.role, title: c.title, email: c.email, mobile: c.mobile,
               phone: c.phone, use_for: c.use_for, can_edit: vdTrue_(c.can_edit), notes: c.notes, added: c.added, updated: c.updated };
    });
}

function vsDetailsRead_(ss, vendorId) {
  var sh = ss.getSheetByName(VS_TABS.DETAILS);
  var o = {};
  VS_DETAIL_HEADERS.forEach(function (h) { o[h] = ''; });
  o.vendor_id = vendorId;
  if (!sh) return o;
  vsRows_(sh).some(function (r) {
    if (r.vendor_id !== vendorId) return false;
    VS_DETAIL_HEADERS.forEach(function (h) { o[h] = r[h] || ''; });
    return true;
  });
  return o;
}

function vsInsurance_(v, m) {
  var ins = vpInsurance_(v, m);
  function pick(x) { return { state: x.state || 'unknown', label: x.label || '', days: x.days }; }
  return { gl: pick(ins.gl || {}), wc: pick(ins.wc || {}) };
}

function vsOnboarding_(ss, v, m) {
  var cfg = obChecklist_(ss);
  var sh = ss.getSheetByName(OB_TAB);
  if (!sh) return { tracks: [] };
  var mine = obRows_(sh).rows.filter(function (r) { return r.vendor_id === v.vendor_id; });
  mine.sort(function (a, b) { return String(b.updated || '') < String(a.updated || '') ? -1 : 1; });
  var seen = {};
  var tracks = [];
  mine.forEach(function (r) {
    var track = r.track || 'JS';
    if (seen[track]) return;
    seen[track] = 1;
    var docs = obDocs_(r);
    var items = obItemsFor_(cfg, track).filter(function (c) { return VS_OB_INTERNAL.indexOf(c.key) < 0; })
      .map(function (c) {
        var dd = docs[c.key] || {};
        var s = String(dd.s || '');
        var state = s === 'verified' ? 'Verified' : s === 'received' ? 'Received' : s === 'fix' ? 'Needs attention' : 'Not received';
        return { key: c.key, label: c.label, group: c.group, required: !!c.required, state: state, date: dd.d || '' };
      });
    tracks.push({ track: track, track_label: track === 'OS' ? 'Other services' : 'Janitorial', stage: r.stage || '', started: r.started || '', completed: r.completed || '', items: items });
  });
  return { tracks: tracks };
}

function vsCrew_(ss, v, m) {
  var crew = vpCrew_(ss, v, m).rows || [];
  var out = [];
  crew.forEach(function (r) {
    if (String(r.status || '') === 'Removed') return;
    var res = String(r.result || ''), st = String(r.status || '');
    var state = (res === 'Clear' || (st === 'Cleared' && res !== 'Not clear' && res !== 'Pending')) ? 'Cleared' : res === 'Not clear' ? 'Not cleared' : 'Pending';
    out.push({ name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(), state: state, date: r.result_date || r.most_recent_check || '' });
  });
  out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return { rows: out };
}

function vsAudit_(ss, v) {
  var a = null;
  try { a = (vpAudits_(ss, v).rows || [])[0] || null; } catch (e) {}
  return { last: (a && a.audit_date) || v.last_audit || '', result: (a && a.result) || v.audit_result || '',
           next_due: (a && a.next_due) || v.audit_next_due || '' };
}

function vsDocuments_(v, m) {
  var rows = (vpDocuments_(v, m).rows || []).map(function (r) {
    return { received: r.received, doc_type: r.doc_type, coi_coverage: r.coi_coverage, file_names: r.file_names };
  });
  return { rows: rows.slice(0, 40) };
}

// ------------------------------------------------------------ vs_save -----

function vsSave_(d) {
  var a = vsAuth_(d, false);
  if (a.error) return { ok: false, error: a.error, expired: a.expired };
  var changes = d.changes && typeof d.changes === 'object' ? d.changes : {};
  var cols = Object.keys(changes);
  if (!cols.length) return { ok: false, error: 'Nothing to save.' };
  var sh = a.v._sheet, row = a.v._row;
  var head = vsHeaders_(sh);
  var live = sh.getRange(row, 1, 1, head.length).getValues()[0];
  var written = [], stale = [], skipped = [], lines = [];
  cols.forEach(function (col) {
    if (VS_EDIT.indexOf(col) < 0) { skipped.push(col); return; }
    var ci = head.indexOf(col);
    if (ci < 0) { skipped.push(col); return; }
    var ch = changes[col] || {};
    var cur = vdStr_(live[ci]);
    var oldv = vdStr_(ch.old);
    if (cur !== oldv) { stale.push(col); return; }
    var nv = vsCoerce_(col, ch['new']);
    if (vdStr_(nv) === cur) return;                       // no change
    if ((col === 'ref1_email' || col === 'ref2_email') && nv && !vsEmailOk_(nv)) { skipped.push(col); return; }
    sh.getRange(row, ci + 1).setValue(nv);
    written.push(col);
    lines.push([VS_LABEL[col] || col, cur, vdStr_(nv)]);
    vsLog_('vendor: ' + a.actor_email, 'vs:' + (a.v._tab === 'Vendors Northern Nevada' ? 'vendors_nnv' : 'vendors_lv'), a.v._tab, row, col, cur, vdStr_(nv));
  });
  if (written.length) {
    var uc = head.indexOf('updated');
    if (uc >= 0) sh.getRange(row, uc + 1).setValue(vsToday_());
    var summary = 'Updated ' + lines.map(function (l) { return l[0]; }).join(', ');
    vsAct_(a.ss, { vendor_id: a.v.vendor_id, vendor: a.v.dba_name, market: vsMarketCode_(a.v.region), type: 'profile_edit',
                   summary: summary, detail: lines, actor: a.actor, actor_email: a.actor_email });
    vsNotify_(a, 'Profile updated by the vendor', lines);
  }
  return { ok: true, written: written, stale: stale, skipped: skipped };
}

// Compliance inbox email so the team syncs CRM / Business Central / emfluence.
// Tag vs_edit: set SendConfig vs_edit|digest to batch these into the daily digest, or skip to silence.
function vsNotify_(a, title, lines) {
  try {
    var rows = lines.map(function (l) {
      return '<tr><td style="padding:6px 12px 6px 0;color:#636466;font-size:12px;vertical-align:top;white-space:nowrap;">' + vsEsc_(l[0]) + '</td>' +
        '<td style="padding:6px 12px 6px 0;font-size:13px;color:#8a1d23;vertical-align:top;">' + (l[1] ? vsEsc_(l[1]) : '<i>blank</i>') + '</td>' +
        '<td style="padding:6px 0;font-size:13px;color:#2D2A26;vertical-align:top;">' + (l[2] ? vsEsc_(l[2]) : '<i>blank</i>') + '</td></tr>';
    }).join('');
    var html = '<div style="font-family:Verdana,Arial,sans-serif;color:#2D2A26;max-width:640px;">' +
      '<p style="font-size:14px;margin:0 0 6px;"><b>' + vsEsc_(a.v.dba_name) + '</b> (' + vsEsc_(a.v.vendor_id) + ') &middot; ' + vsEsc_(vdRegion_(a.v.region)) + '</p>' +
      '<p style="font-size:12px;color:#636466;margin:0 0 14px;">' + vsEsc_(title) + ' &middot; by ' + vsEsc_(a.actor) + ' (' + vsEsc_(a.actor_email) + ') &middot; ' + vsEsc_(vsNow_()) + '</p>' +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><th style="text-align:left;font-size:11px;color:#636466;padding:0 12px 4px 0;">Field</th><th style="text-align:left;font-size:11px;color:#636466;padding:0 12px 4px 0;">Was</th><th style="text-align:left;font-size:11px;color:#636466;padding:0 0 4px;">Now</th></tr>' + rows + '</table>' +
      '<p style="font-size:12px;margin:16px 0 0;">The Vendor Directory is already updated. CRM, Business Central and emfluence are not. ' +
      '<a href="' + VS_PROFILE_ADMIN + '?id=' + encodeURIComponent(a.v.vendor_id) + '" style="color:#D22730;">Open the vendor profile</a></p></div>';
    var plain = a.v.dba_name + ' (' + a.v.vendor_id + ')\n' + title + ' by ' + a.actor + ' (' + a.actor_email + ')\n\n' +
      lines.map(function (l) { return l[0] + ': ' + (l[1] || 'blank') + ' -> ' + (l[2] || 'blank'); }).join('\n') +
      '\n\nThe Vendor Directory is updated. CRM, Business Central and emfluence are not.\n' + VS_PROFILE_ADMIN + '?id=' + a.v.vendor_id;
    var opts = { to: a.mk.compliance, name: a.mk.sender, replyTo: a.mk.compliance, subject: title + ': ' + a.v.dba_name, body: plain, htmlBody: html,
                 digest: { title: title + ': ' + a.v.dba_name, fields: lines.map(function (l) { return [l[0], (l[1] || 'blank') + ' -> ' + (l[2] || 'blank')]; }),
                           links: [['Vendor profile', VS_PROFILE_ADMIN + '?id=' + a.v.vendor_id]], region: vdRegion_(a.v.region), id: a.v.vendor_id } };
    if (typeof cwMail_ === 'function') cwMail_('vs_edit', opts); else cwSend_(opts);
  } catch (e) {}
}

// ------------------------------------------------------------ contacts ----

function vsContactCore_(ss, v, c, who, whoEmail) {
  var sh = vsTab_(ss, VS_TABS.CONTACTS, VS_CONTACT_HEADERS);
  var head = vsHeaders_(sh);
  var name = vsStr_(c.name, 120);
  if (!name) return { error: 'The contact needs a name.' };
  var role = vsStr_(c.role, 40);
  if (VS_ROLES.indexOf(role) < 0) role = 'Other';
  var email = vsEmail_(c.email);
  if (email && !vsEmailOk_(email)) return { error: 'That email address does not look right.' };
  var useFor = [].concat(c.use_for || []).map(function (u) { return vsStr_(u, 40); }).filter(function (u) { return VS_USE_FOR.indexOf(u) >= 0; });
  var canEdit = c.can_edit === undefined || c.can_edit === null ? (VS_EDIT_ROLES.indexOf(role) >= 0) : !!c.can_edit;
  if (!email) canEdit = false;
  var rec = { name: name, role: role, title: vsStr_(c.title, 80), email: email, mobile: vsStr_(c.mobile, 40), phone: vsStr_(c.phone, 40),
              use_for: useFor.join(', '), can_edit: canEdit ? 'TRUE' : 'FALSE', notes: vsStr_(c.notes, 500) };
  var id = vsStr_(c.contact_id, 40);
  var existing = null;
  if (id) {
    vsRows_(sh).some(function (r) { if (r.contact_id === id && r.vendor_id === v.vendor_id) { existing = r; return true; } return false; });
    if (!existing) return { error: 'That contact is not on this profile.' };
  }
  var changed = [];
  if (existing) {
    Object.keys(rec).forEach(function (k) {
      if (vdStr_(existing[k]) === vdStr_(rec[k])) return;
      vsSet_(sh, head, existing._row, k, rec[k]);
      changed.push([name + ' ' + k.replace(/_/g, ' '), existing[k] || '', rec[k] || '']);
    });
    if (!changed.length) return { contact_id: id, changed: [] };
    vsSet_(sh, head, existing._row, 'updated', vsNow_());
    vsSet_(sh, head, existing._row, 'updated_by', who);
    if (!canEdit) vsLinkRevokeContact_(ss, v.vendor_id, id);
    vsAct_(ss, { vendor_id: v.vendor_id, vendor: v.dba_name, market: vsMarketCode_(v.region), type: 'contact',
                 summary: 'Updated contact ' + name + ' (' + role + ')', detail: changed, actor: who, actor_email: whoEmail, ref: id });
    return { contact_id: id, changed: changed };
  }
  id = vsId_('VC');
  rec.contact_id = id; rec.vendor_id = v.vendor_id; rec.vendor = v.dba_name; rec.added = vsNow_(); rec.added_by = who;
  vsAppend_(sh, VS_CONTACT_HEADERS, rec);
  vsAct_(ss, { vendor_id: v.vendor_id, vendor: v.dba_name, market: vsMarketCode_(v.region), type: 'contact',
               summary: 'Added contact ' + name + ' (' + role + ')' + (email ? ' ' + email : ''), detail: rec, actor: who, actor_email: whoEmail, ref: id });
  return { contact_id: id, added: true, changed: [['New contact', '', name + ' (' + role + ')' + (email ? ' ' + email : '') + (rec.mobile || rec.phone ? ' ' + (rec.mobile || rec.phone) : '') + (rec.use_for ? ' for ' + rec.use_for : '')]] };
}
function vsContactRemoveCore_(ss, v, id, who, whoEmail) {
  var sh = ss.getSheetByName(VS_TABS.CONTACTS);
  if (!sh) return { error: 'No contacts on file.' };
  var head = vsHeaders_(sh), hit = null;
  vsRows_(sh).some(function (r) { if (r.contact_id === id && r.vendor_id === v.vendor_id) { hit = r; return true; } return false; });
  if (!hit) return { error: 'That contact is not on this profile.' };
  if (hit.removed) return { removed: true };
  vsSet_(sh, head, hit._row, 'removed', vsNow_());
  vsSet_(sh, head, hit._row, 'removed_by', who);
  vsLinkRevokeContact_(ss, v.vendor_id, id);
  vsAct_(ss, { vendor_id: v.vendor_id, vendor: v.dba_name, market: vsMarketCode_(v.region), type: 'contact',
               summary: 'Removed contact ' + hit.name + ' (' + hit.role + ')', detail: hit, actor: who, actor_email: whoEmail, ref: id });
  return { removed: true, name: hit.name, role: hit.role, email: hit.email };
}

function vsContact_(d) {
  var a = vsAuth_(d, false);
  if (a.error) return { ok: false, error: a.error, expired: a.expired };
  var r = vsContactCore_(a.ss, a.v, d.contact || {}, a.actor, a.actor_email);
  if (r.error) return { ok: false, error: r.error };
  if (r.changed && r.changed.length) vsNotify_(a, r.added ? 'Contact added by the vendor' : 'Contact updated by the vendor', r.changed);
  return { ok: true, contact_id: r.contact_id, contacts: vsContacts_(a.ss, a.v.vendor_id) };
}
function vsContactRemove_(d) {
  var a = vsAuth_(d, false);
  if (a.error) return { ok: false, error: a.error, expired: a.expired };
  var r = vsContactRemoveCore_(a.ss, a.v, vsStr_(d.contact_id, 40), a.actor, a.actor_email);
  if (r.error) return { ok: false, error: r.error };
  if (r.name) vsNotify_(a, 'Contact removed by the vendor', [['Contact removed', r.name + ' (' + r.role + ')' + (r.email ? ' ' + r.email : ''), '']]);
  return { ok: true, contacts: vsContacts_(a.ss, a.v.vendor_id) };
}

// ------------------------------------------------------------ details -----

function vsDetailsCore_(ss, v, det, who) {
  var sh = vsTab_(ss, VS_TABS.DETAILS, VS_DETAIL_HEADERS);
  var head = vsHeaders_(sh);
  var cur = vsDetailsRead_(ss, v.vendor_id);
  var rec = {};
  var fields = ['capacity', 'capacity_notes', 'preferred_language', 'crew_languages', 'equipment', 'certifications',
                'after_hours_phone', 'emergency_name', 'emergency_phone', 'notes_for_cw'];
  fields.forEach(function (k) { if (det[k] !== undefined && det[k] !== null) rec[k] = vsStr_(det[k], k === 'notes_for_cw' || k === 'equipment' || k === 'certifications' || k === 'capacity_notes' ? 2000 : 200); });
  if (rec.capacity !== undefined && rec.capacity && VS_CAPACITY.indexOf(rec.capacity) < 0) delete rec.capacity;   // unknown value: leave the field alone
  var changed = [];
  Object.keys(rec).forEach(function (k) { if (vdStr_(cur[k]) !== vdStr_(rec[k])) changed.push([k.replace(/_/g, ' '), cur[k] || '', rec[k] || '']); });
  if (!changed.length) return { changed: [] };
  var existing = null;
  vsRows_(sh).some(function (r) { if (r.vendor_id === v.vendor_id) { existing = r; return true; } return false; });
  if (existing) {
    Object.keys(rec).forEach(function (k) { vsSet_(sh, head, existing._row, k, rec[k]); });
    vsSet_(sh, head, existing._row, 'vendor', v.dba_name);
    vsSet_(sh, head, existing._row, 'updated', vsNow_());
    vsSet_(sh, head, existing._row, 'updated_by', who);
  } else {
    var full = { vendor_id: v.vendor_id, vendor: v.dba_name, updated: vsNow_(), updated_by: who };
    Object.keys(rec).forEach(function (k) { full[k] = rec[k]; });
    vsAppend_(sh, VS_DETAIL_HEADERS, full);
  }
  return { changed: changed };
}
function vsDetails_(d) {
  var a = vsAuth_(d, false);
  if (a.error) return { ok: false, error: a.error, expired: a.expired };
  var r = vsDetailsCore_(a.ss, a.v, d.details || {}, a.actor);
  if (r.changed.length) {
    vsAct_(a.ss, { vendor_id: a.v.vendor_id, vendor: a.v.dba_name, market: vsMarketCode_(a.v.region), type: 'details',
                   summary: 'Updated ' + r.changed.map(function (c) { return c[0]; }).join(', '), detail: r.changed, actor: a.actor, actor_email: a.actor_email });
    vsNotify_(a, 'Company details updated by the vendor', r.changed);
  }
  return { ok: true, details: vsDetailsRead_(a.ss, a.v.vendor_id), changed: r.changed.length };
}

// ------------------------------------------------------------ admin -------

function vsAdminVendor_(ss, d) {
  var vid = vsStr_(d.vendor_id, 20);
  if (!vid) return { error: 'vendor_id is required.' };
  var v = vpFindVendor_(ss, vid);
  if (!v) return { error: 'No vendor ' + vid };
  return { v: v };
}
function vsAdminContacts_(d) {
  var ss = vdSS_();
  var r = vsAdminVendor_(ss, d);
  if (r.error) return { ok: false, error: r.error };
  var v = r.v;
  var links = [];
  try {
    var ls = ss.getSheetByName(VS_TABS.LINKS);
    if (ls) links = vsRows_(ls).filter(function (l) { return l.vendor_id === v.vendor_id; })
      .map(function (l) { return { email: l.email, created: l.created, expires: l.expires, opened: l.opened, last_used: l.last_used, revoked: l.revoked, sent_by: l.sent_by }; })
      .sort(function (a, b) { return a.created < b.created ? 1 : -1; }).slice(0, 10);
  } catch (e) {}
  var act = [];
  try {
    var as = ss.getSheetByName(VS_TABS.ACT);
    if (as) act = vsRows_(as).filter(function (e) { return e.vendor_id === v.vendor_id; })
      .map(function (e) { return { event_id: e.event_id, when: e.when, type: e.type, summary: e.summary, detail: vsDetailParse_(e.detail), actor: e.actor, actor_email: e.actor_email }; })
      .sort(function (a, b) { return a.when < b.when ? 1 : -1; }).slice(0, 40);
  } catch (e) {}
  return { ok: true, vendor_id: v.vendor_id, contacts: vsContacts_(ss, v.vendor_id), details: vsDetailsRead_(ss, v.vendor_id),
           links: links, activity: act, lists: { roles: VS_ROLES, use_for: VS_USE_FOR, capacity: VS_CAPACITY, languages: VS_LANGS } };
}
function vsDetailParse_(s) { try { var x = JSON.parse(s); return x; } catch (e) { return s || ''; } }
function vsAdminContact_(d) {
  var ss = vdSS_();
  var r = vsAdminVendor_(ss, d);
  if (r.error) return { ok: false, error: r.error };
  var x = vsContactCore_(ss, r.v, d.contact || {}, vsWho_(d), '');
  if (x.error) return { ok: false, error: x.error };
  return { ok: true, contact_id: x.contact_id, contacts: vsContacts_(ss, r.v.vendor_id) };
}
function vsAdminContactRemove_(d) {
  var ss = vdSS_();
  var r = vsAdminVendor_(ss, d);
  if (r.error) return { ok: false, error: r.error };
  var x = vsContactRemoveCore_(ss, r.v, vsStr_(d.contact_id, 40), vsWho_(d), '');
  if (x.error) return { ok: false, error: x.error };
  return { ok: true, contacts: vsContacts_(ss, r.v.vendor_id) };
}
// Angel sends a vendor their link by hand (vendor cannot find the email, or has a new address).
function vsAdminLink_(d) {
  var ss = vdSS_();
  var r = vsAdminVendor_(ss, d);
  if (r.error) return { ok: false, error: r.error };
  var email = vsEmail_(d.email) || vsEmail_(r.v.email);
  if (!vsEmailOk_(email)) return { ok: false, error: 'Enter the email to send the link to.' };
  var token = vsLinkCreate_(ss, r.v, email, '', '', vsWho_(d));
  vsSendLink_(email, [{ v: r.v, url: VS_PAGE + '?t=' + token }], vsMarket_(r.v));
  vsAct_(ss, { vendor_id: r.v.vendor_id, vendor: r.v.dba_name, market: vsMarketCode_(r.v.region), type: 'link',
               summary: 'Profile link sent to ' + email + ' by ' + vsWho_(d), actor: vsWho_(d), actor_email: email });
  return { ok: true, sent_to: email };
}

// ------------------------------------------------------------ feed --------

function vsFeed_(d) {
  var source = vsStr_(d.source) || 'self';
  var days = Number(d.days) || VS_FEED_DAYS;
  var since = new Date(Date.now() - days * 86400000);
  var items = [];
  var fn = {
    self: vsFeedSelf_, intake: vsFeedIntake_, requests: vsFeedRequests_, uploads: vsFeedUploads_,
    bc: vsFeedBc_, audits: vsFeedAudits_, responses: vsFeedResponses_, cleaners: vsFeedCleaners_
  }[source];
  if (!fn) return { ok: false, error: 'Unknown source ' + source };
  var vendorFilter = vsStr_(d.vendor_id, 20);
  items = fn(since) || [];
  if (vendorFilter) items = items.filter(function (it) { return it.vendor_id === vendorFilter; });
  var st = vsStatusMap_();
  var out = [];
  items.forEach(function (it) {
    var s = st[it.key];
    if (s && s.status) {
      if (!vsFresh_(s.at, VS_FEED_DONE_DAYS)) return;
      it.status = s.status; it.by = s.by; it.at = s.at;
    } else { it.status = ''; it.by = ''; it.at = ''; }
    if (it.vendor_id) it.link = VS_PROFILE_ADMIN + '?id=' + encodeURIComponent(it.vendor_id);
    out.push(it);
  });
  out.sort(function (a, b) { return a.when < b.when ? 1 : a.when > b.when ? -1 : 0; });
  return { ok: true, source: source, items: out, statuses: VS_FEED_STATUS, days: days, generated: vsNow_() };
}
function vsWhenMs_(s) {
  s = vdStr_(s);
  if (!s) return 0;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)).getTime();
  var t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
function vsWhenIso_(s) {
  s = vdStr_(s);
  var ms = vsWhenMs_(s);
  if (!ms) return s;
  return Utilities.formatDate(new Date(ms), VS_TZ, 'yyyy-MM-dd HH:mm');
}
function vsRecent_(s, since) { var ms = vsWhenMs_(s); return !ms || ms >= since.getTime(); }
function vsFresh_(at, days) { var ms = vsWhenMs_(at); return !ms || (Date.now() - ms) < days * 86400000; }
function vsReadTab_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  return vsRead_(sh, cols).rows;
}

function vsFeedSelf_(since) {
  var ss = vdSS_();
  return vsReadTab_(ss, VS_TABS.ACT, VS_ACT_HEADERS).filter(function (r) { return r.event_id && vsRecent_(r.when, since); })
    .map(function (r) {
      return { key: 'va:' + r.event_id, type: r.type === 'profile_edit' ? 'profile_edit' : r.type === 'contact' ? 'contact' : r.type === 'details' ? 'details' : r.type === 'link' ? 'link' : r.type,
               when: r.when, vendor_id: r.vendor_id, vendor: r.vendor, market: r.market, summary: r.summary, detail: vsDetailParse_(r.detail),
               actor: r.actor, actor_email: r.actor_email, ref: r.ref };
    });
}
function vsFeedIntake_(since) {
  var ss = vdSS_();
  return vsReadTab_(ss, VD_TABS.INTAKE, ['received', 'submission_id', 'business_name', 'contact_name', 'email', 'phone', 'region', 'service_types', 'matched_vendor_id', 'action'])
    .filter(function (r) { return r.received && r.submission_id !== 'INVITE' && vsRecent_(r.received, since); })
    .map(function (r) {
      var isEval = r.submission_id === 'EVAL';
      return { key: 'eval:' + vsWhenIso_(r.received) + '|' + vsEmail_(r.email), type: isEval ? 'eval' : 'intake',
               when: vsWhenIso_(r.received), vendor_id: r.matched_vendor_id || '', vendor: r.business_name, market: vsMarketCode_(r.region),
               summary: (isEval ? 'Vendor evaluation: ' : 'Intake form: ') + r.business_name + (r.action ? ' (' + r.action + ')' : ''),
               detail: [['Contact', r.contact_name], ['Email', r.email], ['Phone', r.phone], ['Region', r.region], ['Services', r.service_types], ['Result', r.action]],
               actor: r.contact_name, actor_email: r.email, ref: r.submission_id };
    });
}
function vsFeedRequests_(since) {
  var sh = profSheet_();
  return vsRead_(sh, ['request_id', 'received', 'status', 'region', 'company', 'matched_vendor_id', 'submitted_by', 'role', 'submitter_email', 'changes', 'notes']).rows
    .filter(function (r) { return r.request_id && vsRecent_(r.received, since); })
    .map(function (r) {
      return { key: 'preq:' + r.request_id, type: 'request', when: vsWhenIso_(r.received), vendor_id: r.matched_vendor_id || '', vendor: r.company,
               market: vsMarketCode_(r.region), summary: 'Profile change request: ' + r.company + ' (' + r.changes + ')' + (r.status ? ' - ' + r.status : ''),
               detail: [['Submitted by', r.submitted_by + (r.role ? ', ' + r.role : '')], ['Email', r.submitter_email], ['Changes', r.changes], ['Notes', r.notes], ['Request status', r.status]],
               actor: r.submitted_by, actor_email: r.submitter_email, ref: r.request_id };
    });
}
function vsFeedUploads_(since) {
  var sh = docSheet_();
  return vsRead_(sh, ['doc_id', 'received', 'doc_type', 'coi_coverage', 'region', 'company', 'first_name', 'last_name', 'email', 'file_names']).rows
    .filter(function (r) { return r.doc_id && vsRecent_(r.received, since); })
    .map(function (r) {
      return { key: 'doc:' + r.doc_id, type: 'upload', when: vsWhenIso_(r.received), vendor_id: '', vendor: r.company, market: vsMarketCode_(r.region),
               summary: 'Uploaded ' + r.doc_type + (r.coi_coverage ? ' (' + r.coi_coverage + ')' : '') + ': ' + r.company,
               detail: [['Files', r.file_names], ['Sent by', ((r.first_name || '') + ' ' + (r.last_name || '')).trim()], ['Email', r.email]],
               actor: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(), actor_email: r.email, ref: r.doc_id };
    });
}
function vsFeedBc_(since) {
  var ss = vdSS_();
  return vsReadTab_(ss, OB_REQ_TAB, ['req_id', 'received', 'market', 'company', 'vendor_id', 'request_type', 'first_name', 'last_name', 'email', 'submitted_by', 'submitter_email', 'source', 'status'])
    .filter(function (r) { return r.req_id && vsRecent_(r.received, since); })
    .map(function (r) {
      return { key: 'bcr:' + r.req_id, type: 'bc', when: vsWhenIso_(r.received), vendor_id: r.vendor_id || '', vendor: r.company, market: vsMarketCode_(r.market),
               summary: (r.request_type || 'Background check') + ' request: ' + ((r.first_name || '') + ' ' + (r.last_name || '')).trim() + ' at ' + r.company + (r.status ? ' - ' + r.status : ''),
               detail: [['Person', ((r.first_name || '') + ' ' + (r.last_name || '')).trim()], ['Submitted by', r.submitted_by], ['Email', r.submitter_email], ['Source', r.source], ['Status', r.status]],
               actor: r.submitted_by, actor_email: r.submitter_email, ref: r.req_id };
    });
}
function vsFeedAudits_(since) {
  var ss = vdSS_();
  return vsReadTab_(ss, AUD_TABS.AUDITS, ['audit_id', 'audit_date', 'market', 'vendor_id', 'vendor', 'submitted_by', 'result', 'fail_reasons', 'accounts_audited', 'next_due', 'received', 'test'])
    .filter(function (r) { return r.audit_id && !vdTrue_(r.test) && vsRecent_(r.received || r.audit_date, since); })
    .map(function (r) {
      return { key: 'aud:' + r.audit_id, type: 'audit', when: vsWhenIso_(r.received || r.audit_date), vendor_id: r.vendor_id, vendor: r.vendor, market: vsMarketCode_(r.market),
               summary: 'Quarterly audit ' + (r.result || '') + ': ' + r.vendor, detail: [['Submitted by', r.submitted_by], ['Accounts', r.accounts_audited], ['Fail reasons', r.fail_reasons], ['Next due', r.next_due]],
               actor: r.submitted_by, actor_email: '', ref: r.audit_id };
    });
}
function vsFeedResponses_(since) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(RESP_TAB);
  if (!sh) return [];
  return vsRead_(sh, ['response_id', 'received', 'posting_id', 'posting_title', 'region', 'mode', 'company', 'contact_name', 'email', 'phone']).rows
    .filter(function (r) { return r.response_id && vsRecent_(r.received, since); })
    .map(function (r) {
      return { key: 'resp:' + r.response_id, type: 'response', when: vsWhenIso_(r.received), vendor_id: '', vendor: r.company, market: vsMarketCode_(r.region),
               summary: (r.mode === 'quote' ? 'Quote' : 'Interest') + ' on ' + (r.posting_title || r.posting_id) + ': ' + r.company,
               detail: [['Contact', r.contact_name], ['Email', r.email], ['Phone', r.phone], ['Posting', r.posting_id]],
               actor: r.contact_name, actor_email: r.email, ref: r.response_id };
    });
}
function vsFeedCleaners_(since) {
  var sh;
  try { sh = acSS_().getSheetByName(AC_EV); } catch (e) { return []; }
  if (!sh) return [];
  return vsRead_(sh, ['event_id', 'received', 'submission_id', 'action', 'company_raw', 'company_matched', 'submitter_name', 'submitter_email', 'cleaner_first', 'cleaner_last', 'account_matched', 'status', 'region']).rows
    .filter(function (r) { return r.event_id && vsRecent_(r.received, since); })
    .map(function (r) {
      var who = ((r.cleaner_first || '') + ' ' + (r.cleaner_last || '')).trim();
      return { key: 'cln:' + r.event_id, type: 'cleaner', when: vsWhenIso_(r.received), vendor_id: '', vendor: r.company_matched || r.company_raw, market: vsMarketCode_(r.region),
               summary: (String(r.action).toLowerCase() === 'add' ? 'Cleaner added: ' : 'Cleaner removed: ') + who + ' at ' + (r.company_matched || r.company_raw) + (r.status ? ' - ' + r.status : ''),
               detail: [['Building', r.account_matched], ['Submitted by', r.submitter_name], ['Email', r.submitter_email], ['Status', r.status]],
               actor: r.submitter_name, actor_email: r.submitter_email, ref: r.event_id };
    });
}

function vsStatusMap_() {
  var map = {};
  try {
    var sh = vdSS_().getSheetByName(VS_TABS.STATUS);
    if (!sh) return map;
    vsRows_(sh).forEach(function (r) { if (r.alert_key) map[r.alert_key] = { status: r.status, by: r.handled_by, at: r.handled_at, row: r._row }; });
  } catch (e) {}
  return map;
}
function vsFeedSet_(d) {
  var keys = [].concat(d.keys || []).map(function (k) { return vsStr_(k, 200); }).filter(Boolean);
  if (!keys.length) return { ok: false, error: 'No keys.' };
  var status = vsStr_(d.status, 60);
  var by = vsWho_(d);
  var ss = vdSS_();
  var sh = vsTab_(ss, VS_TABS.STATUS, VS_STATUS_HEADERS);
  var head = vsHeaders_(sh);
  var map = vsStatusMap_();
  var now = vsNow_();
  var saved = [];
  keys.forEach(function (k) {
    var type = vsStr_(d.type, 30);
    var allowed = VS_FEED_STATUS[type] || [];
    if (status && allowed.indexOf(status) < 0 && status !== 'Handled') return;
    var row = map[k] ? map[k].row : vsNextRow_(sh);
    sh.getRange(row, 1, 1, head.length).setValues([[k, type, status, status ? by : '', status ? now : '', vsStr_(d.summary, 200)]]);
    saved.push({ key: k, status: status, by: status ? by : '', at: status ? now : '' });
  });
  return { ok: true, saved: saved };
}

// ------------------------------------------------------------ setup -------

function vsSetupRun() {
  var ss = vdSS_();
  vsTab_(ss, VS_TABS.CONTACTS, VS_CONTACT_HEADERS);
  vsTab_(ss, VS_TABS.DETAILS, VS_DETAIL_HEADERS);
  vsTab_(ss, VS_TABS.LINKS, VS_LINK_HEADERS);
  vsTab_(ss, VS_TABS.ACT, VS_ACT_HEADERS);
  vsTab_(ss, VS_TABS.STATUS, VS_STATUS_HEADERS);
  Logger.log('VendorSelf tabs ready on ' + ss.getName());
}
