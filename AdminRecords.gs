/* AdminRecords.gs - CW Solicitations project. Build 2026-09-19.
   Backend for the Admin Hub "Ops Admin Desk" (cw-admin-hub/desk.html + records.html).
   Lets the operations admin read and edit form submissions one record at a time
   instead of scrolling rows on the Google Sheets.

   Router: doPost must route the adr_ prefix here, before doPostBase:
     if (d && String(d.kind||'').indexOf('adr_') === 0) return adrDispatch(d);

   Kinds (team passcode, same tier as the rest of the Admin Hub):
     adr_surfaces  {}                                  -> the list of record types this page may open
     adr_list      {surface}                           -> light rows (list columns only) + sheet url
     adr_get       {surface, row}                      -> one full record with field metadata
     adr_save      {surface, row, id, changes:{col:{old,new}}, who}
     adr_add       {surface, values:{col:val}, who}    -> only on surfaces that declare add:true
     adr_log       {surface?, limit}                   -> recent changes made through this page
     adr_undo      {log_id, who}                       -> puts the previous value back

   Rules:
   - Every surface is whitelisted below with its book, tab and how rows are identified.
     There is no generic "edit any sheet" path.
   - Fields come from the tab's LIVE header row, so a new column shows up as a new field
     instead of a silent mis-map. Sections and labels below only decorate what is there.
   - Every write carries the value the editor last saw. If the cell changed since, that
     field is skipped and reported as stale. Nothing is overwritten blind.
   - Rows are never deleted or cleared here. Postings are archived by the filled box.
   - Every change is logged to the Site Admin Log tab (SiteAdmin.gs) with its previous
     value, under surface "adr:<key>", and can be undone from the page.
   - Booleans are written as real booleans when the cell already holds one (checkbox
     cells), otherwise as the strings TRUE / FALSE like every seed on the platform.
   - Opportunity postings publish to vendors through doGet. Any edit to a public column
     is live on the Vendor Hub within a minute. The page labels which columns are public.
*/

var ADR_TZ = 'America/Los_Angeles';
var ADR_PREFIX = 'adr:';

function adrSurfaces_() {
  var FSM = [];
  try { FSM = Object.keys(FSM_ROSTER || {}); } catch (e) {}
  var ROLES = (typeof STAFF_ROLES !== 'undefined') ? STAFF_ROLES : ['Facility Solutions Manager', 'Night Manager', 'Director of Operations', 'General Manager', 'Business Operations Manager', 'Chief Operating Officer', 'Sales', 'Accounting', 'Other'];
  var MARKETS = (typeof STAFF_MARKETS !== 'undefined') ? STAFF_MARKETS : ['Las Vegas', 'Northern Nevada', 'Both'];
  var TERR = (typeof STAFF_TERRITORIES !== 'undefined') ? STAFF_TERRITORIES : ['North', 'West', 'Southwest', 'Southeast', 'Citywide'];
  var VSTAT = [];
  try { VSTAT = VD_LIVE_STATUS.concat(VD_PROSPECT_STATUS); } catch (e) { VSTAT = ['Active', 'Waiting for Account', 'In Progress', 'Prospect', 'Do Not Contact']; }
  var TRADES = ['Janitorial', 'Day Porter', 'Floor Care (Strip & Wax / Buff)', 'Carpet Cleaning', 'Tile & Grout', 'Upholstery Cleaning', 'Window Cleaning', 'High Dusting / Ceilings', 'Duct & Vent Cleaning', 'Post-Construction Clean', 'Specialty (Medical / Clean Room / GMP)', 'Pressure Washing', 'Landscaping', 'Tree Trimming / Palms', 'Snow Removal', 'Parking Lot Services', 'Street Sweeping', 'Graffiti Removal', 'Solar Panel Cleaning', 'Trash Bin Cleaning', 'Handyman / Repairs', 'Flooring Installation / Repair', 'Painting', 'Pest Control', 'HVAC / Mechanical', 'Plumbing', 'Electrical', 'Junk Removal / Hauling', 'Water / Flood Restoration', 'Security / Guard Services', 'Other'];
  var FREQ = ['5 days per week', '7 days per week', '6 days per week', '4 days per week', '3 days per week', '2 days per week', '1 day per week', 'Every other week', 'Monthly', '3x per week: 2 full cleans + 1 trash only', '5x per week: 3 full cleans + 2 trash and restrooms only'];
  var WINDOW = ['Night clean (after close)', 'Day clean (during business hours)', 'Early morning (before open)', 'Flexible', 'Overnight only', 'Weekends only'];
  var PERIOD = ['per month', 'per job', 'per visit', 'per hour', 'per quarter'];

  var vendorSections = [
    { name: 'Vendor', fields: ['vendor_id', 'dba_name', 'legal_name', 'status', 'region', 'service_types', 'ic_type', 'license_no'] },
    { name: 'Contact', fields: ['contact_name', 'email', 'phone', 'business_phone', 'website', 'business_address', 'city_state', 'metro_areas'] },
    { name: 'Business', fields: ['years_in_business', 'crew_ft', 'crew_pt', 'services_desc', 'cw_start_date', 'cw_clients', 'monthly_revenue', 'bc_vendor_no'] },
    { name: 'Compliance', fields: ['workers_comp', 'wc_exp', 'general_liability', 'gl_exp', 'background_checks', 'sut_paid', 'wage_compliance', 'documented_pay', 'i9_collected', 'daily_supervision', 'concern_process', 'last_audit', 'audit_result', 'audit_next_due', 'audit_pdf'] },
    { name: 'References', fields: ['ref1_company', 'ref1_name', 'ref1_phone', 'ref1_email', 'ref2_company', 'ref2_name', 'ref2_phone', 'ref2_email', 'family_involvement'] },
    { name: 'Internal', fields: ['internal_notes', 'additional_notes', 'outreach', 'hide', 'source', 'eval_date', 'added_by', 'updated', 'has_brochures', 'has_cards', 'business_card_url', 'trade_raw'] }
  ];
  var vendorTypes = { hide: 'bool', has_brochures: 'bool', has_cards: 'bool', services_desc: 'long', internal_notes: 'long', additional_notes: 'long', outreach: 'long', concern_process: 'long', cw_clients: 'long', crew_ft: 'number', crew_pt: 'number', email: 'email', ref1_email: 'email', ref2_email: 'email', audit_pdf: 'url', business_card_url: 'url', website: 'url' };
  var vendorLabels = { dba_name: 'Vendor (DBA)', legal_name: 'Legal name', ic_type: 'IC type', bc_vendor_no: 'Vendor number', cw_start_date: 'Started with City Wide', cw_clients: 'City Wide clients', wc_exp: 'Workers comp expires', gl_exp: 'General liability expires', sut_paid: 'SUT paid', i9_collected: 'I-9s collected', ref1_company: 'Reference 1 company', ref1_name: 'Reference 1 name', ref1_phone: 'Reference 1 phone', ref1_email: 'Reference 1 email', ref2_company: 'Reference 2 company', ref2_name: 'Reference 2 name', ref2_phone: 'Reference 2 phone', ref2_email: 'Reference 2 email', hide: 'Hidden from pickers', trade_raw: 'Trade as typed', audit_pdf: 'Audit PDF', business_card_url: 'Business card' };
  var vendorList = ['vendor_id', 'dba_name', 'status', 'service_types', 'contact_name', 'phone', 'email', 'updated'];
  var vendorSearch = ['vendor_id', 'dba_name', 'legal_name', 'contact_name', 'email', 'phone', 'service_types', 'city_state', 'status'];

  return [
    {
      key: 'postings', group: 'Opportunity Wall', label: 'Opportunity postings', one: 'posting',
      help: 'Each posting is one opportunity on the Vendor Hub wall. Columns marked Public are what vendors see; edits there are live within a minute. Check Filled to take it off the wall. Never put the customer name or anything that identifies the building in a public column.',
      ss: function () { return SpreadsheetApp.openById(SHEET_ID); }, tab: 'Solicitations',
      idCol: 'id', titleCol: 'title', dateCol: 'posted',
      list: ['id', 'posted', 'filled', 'region', 'trade', 'title', 'area', 'pay_amount', 'responses', 'fsm'],
      search: ['id', 'title', 'trade', 'area', 'facility_type', 'account_name', 'fsm', 'region'],
      readonly: ['id', 'posted', 'responses', 'response_form'],
      types: { filled: 'bool', sqft: 'number', restrooms: 'number', pay_amount: 'number', responses: 'number', scope_summary: 'long', chemicals: 'long', equipment_required: 'long', equipment_provided: 'long', certifications: 'long', special_requirements: 'long', pay_notes: 'long', notes: 'long', contact_email: 'email', response_form: 'url', start_date: 'date', deadline: 'date', walkthrough: 'datetime' },
      options: { region: ['Las Vegas', 'Northern Nevada'], type: ['contract', 'project'], trade: TRADES, frequency: FREQ, clean_window: WINDOW, pay_type: ['set', 'quote'], pay_period: PERIOD, fsm: FSM },
      labels: { id: 'Posting ID', filled: 'Filled (off the wall)', type: 'Contract or project', facility_type: 'Facility type', area: 'Area of town', sqft: 'Square feet', clean_window: 'Cleaning window', walkthrough: 'Walkthrough date', deadline: 'Response deadline', pay_type: 'Pay is set or quote requested', pay_amount: 'Pay amount', pay_period: 'Pay period', pay_notes: 'Pay notes', scope_summary: 'Scope summary', equipment_required: 'Equipment the vendor brings', equipment_provided: 'Equipment City Wide provides', special_requirements: 'Special requirements', contact_name: 'FSM contact name (shown to vendors)', contact_email: 'FSM contact email', contact_phone: 'FSM contact phone', response_form: 'Response form link', responses: 'Responses received', account_name: 'Customer (account name)', fsm: 'Posting FSM', notes: 'Internal notes' },
      internal: ['filled', 'responses', 'account_name', 'notes', 'contact_phone', 'contact_email'],
      sections: [
        { name: 'Posting', fields: ['id', 'posted', 'filled', 'region', 'type', 'trade', 'title', 'fsm', 'contact_name'] },
        { name: 'Building (public)', fields: ['facility_type', 'area', 'sqft', 'restrooms', 'frequency', 'clean_window', 'start_date', 'walkthrough', 'deadline'] },
        { name: 'Pay (public)', fields: ['pay_type', 'pay_amount', 'pay_period', 'pay_notes'] },
        { name: 'Scope (public)', fields: ['scope_summary', 'chemicals', 'equipment_required', 'equipment_provided', 'certifications', 'special_requirements'] },
        { name: 'Internal only (vendors never see this)', fields: ['account_name', 'notes', 'contact_email', 'contact_phone', 'responses', 'response_form'] }
      ],
      quick: [{ label: 'Open', col: 'filled', is: 'FALSE' }, { label: 'Filled', col: 'filled', is: 'TRUE' }, { label: 'Las Vegas', col: 'region', is: 'Las Vegas' }, { label: 'Northern Nevada', col: 'region', is: 'Northern Nevada' }]
    },
    {
      key: 'responses', group: 'Opportunity Wall', label: 'Vendor responses', one: 'response',
      help: 'What a vendor submitted for a posting, one response per page. These are the vendor\'s own words. Fix a typo if you must; otherwise read and move on.',
      ss: function () { return SpreadsheetApp.openById(SHEET_ID); }, tab: 'Responses',
      idCol: 'response_id', titleCol: 'company', dateCol: 'received',
      list: ['response_id', 'received', 'posting_id', 'posting_title', 'company', 'contact_name', 'mode', 'quote_amount', 'region'],
      search: ['response_id', 'posting_id', 'posting_title', 'company', 'contact_name', 'email', 'phone', 'account_name', 'region', 'trade'],
      readonly: ['response_id', 'received', 'posting_id', 'pdf_url'],
      types: { quote_amount: 'number', crew_size: 'number', staffing_plan: 'long', supervision_plan: 'long', training_plan: 'long', equipment: 'long', confirmations: 'long', custom_answers: 'long', quote_details: 'long', comments: 'long', email: 'email', pdf_url: 'url' },
      options: { mode: ['interest', 'quote'], region: ['Las Vegas', 'Northern Nevada'] },
      labels: { response_id: 'Response ID', posting_id: 'Posting ID', posting_title: 'Posting', mode: 'Interest or quote', packet_on_file: 'Packet on file', earliest_start: 'Earliest start', crew_size: 'Crew size', quote_amount: 'Quote amount', quote_basis: 'Quote basis', quote_details: 'Quote details', custom_answers: 'Answers to posting questions', account_name: 'Customer (account name)', pdf_url: 'PDF' },
      internal: ['account_name'],
      sections: [
        { name: 'Response', fields: ['response_id', 'received', 'posting_id', 'posting_title', 'region', 'trade', 'mode'] },
        { name: 'Vendor', fields: ['company', 'contact_name', 'email', 'phone', 'packet_on_file'] },
        { name: 'Their plan', fields: ['earliest_start', 'crew_size', 'staffing_plan', 'supervision_plan', 'training_plan', 'equipment'] },
        { name: 'Quote', fields: ['quote_amount', 'quote_basis', 'quote_details'] },
        { name: 'Answers and comments', fields: ['confirmations', 'custom_answers', 'comments'] },
        { name: 'Internal', fields: ['account_name', 'pdf_url'] }
      ],
      quick: [{ label: 'Quotes', col: 'mode', is: 'quote' }, { label: 'Interest', col: 'mode', is: 'interest' }, { label: 'Las Vegas', col: 'region', is: 'Las Vegas' }, { label: 'Northern Nevada', col: 'region', is: 'Northern Nevada' }]
    },
    {
      key: 'supplies', group: 'Supplies', label: 'Supplies needed reports', one: 'report',
      help: 'A vendor or night manager reported that a building needs supplies. This is a report, not an order. Items are listed as the reporter entered them.',
      ss: function () { return supSS_(); }, tab: 'Supply Orders',
      idCol: 'order_id', titleCol: 'building', dateCol: 'received',
      list: ['order_id', 'received', 'region', 'building', 'requester', 'item_count', 'subtotal'],
      search: ['order_id', 'building', 'requester', 'email', 'region', 'items'],
      readonly: ['order_id', 'received'],
      types: { item_count: 'number', subtotal: 'number', items: 'json', comments: 'long', email: 'email' },
      options: { region: ['Las Vegas', 'Northern Nevada'] },
      labels: { order_id: 'Report ID', requester: 'Reported by', item_count: 'Item count', items: 'Items needed' },
      sections: [
        { name: 'Report', fields: ['order_id', 'received', 'region', 'building'] },
        { name: 'Reported by', fields: ['requester', 'email', 'phone'] },
        { name: 'Items', fields: ['item_count', 'subtotal', 'items', 'comments'] }
      ],
      quick: [{ label: 'Las Vegas', col: 'region', is: 'Las Vegas' }, { label: 'Northern Nevada', col: 'region', is: 'Northern Nevada' }]
    },
    {
      key: 'envirox', group: 'Supplies', label: 'EnvirOx orders', one: 'order',
      help: 'Chemical orders placed through the Ops Hub EnvirOx order guide.',
      ss: function () { return supSS_(); }, tab: 'EnvirOx Orders',
      idCol: 'order_id', titleCol: 'requester', dateCol: 'received',
      list: ['order_id', 'received', 'region', 'requester', 'po', 'chem_lbs', 'total', 'min_met'],
      search: ['order_id', 'requester', 'email', 'po', 'region', 'items'],
      readonly: ['order_id', 'received'],
      types: { chem_lbs: 'number', total: 'number', min_met: 'bool', items: 'long', notes: 'long', email: 'email' },
      options: { region: ['Las Vegas', 'Northern Nevada'] },
      labels: { order_id: 'Order ID', po: 'PO number', chem_lbs: 'Chemical pounds', min_met: 'Minimum met' },
      sections: [
        { name: 'Order', fields: ['order_id', 'received', 'region', 'po', 'total', 'chem_lbs', 'min_met'] },
        { name: 'Ordered by', fields: ['requester', 'email', 'phone'] },
        { name: 'Items', fields: ['items', 'notes'] }
      ]
    },
    {
      key: 'shop', group: 'Supplies', label: 'Vendor shop orders', one: 'order',
      help: 'Orders from the vendor shop (uniforms and approved apparel). Tick Order Placed when it goes to the supplier and Picked Up when the vendor collects it. The Ops Hub alerts card reads the same boxes.',
      ss: function () { return SpreadsheetApp.openById(AL_SHOP_ID); }, tab: 'Orders',
      idCol: '', titleCol: 'Vendor Name', dateCol: 'Date',
      list: ['Date', 'Vendor Name', 'Company', 'Total', 'Order Placed', 'Picked Up'],
      search: ['Vendor Name', 'Company', 'Email', 'Primary Account', 'Items'],
      readonly: ['Date'],
      types: { 'Order Placed': 'bool', 'Picked Up': 'bool', Total: 'number', Items: 'long', Notes: 'long', Email: 'email' },
      sections: [
        { name: 'Status', fields: ['Order Placed', 'Picked Up', 'Date', 'Total'] },
        { name: 'Vendor', fields: ['Vendor Name', 'Company', 'Email', 'Primary Account'] },
        { name: 'Order', fields: ['Items', 'Notes'] }
      ],
      quick: [{ label: 'Not placed', col: 'Order Placed', is: 'FALSE' }, { label: 'Not picked up', col: 'Picked Up', is: 'FALSE' }]
    },
    {
      key: 'vendors_lv', group: 'Vendors', label: 'Vendors, Las Vegas', one: 'vendor',
      help: 'The Las Vegas vendor directory, one vendor per page. Status and service types drive what the Ops Hub and the violation pickers show. Do Not Email and hiding live on the Ops Hub Do Not Email page.',
      ss: function () { return vdSS_(); }, tab: 'Vendors Las Vegas',
      idCol: 'vendor_id', titleCol: 'dba_name', dateCol: 'updated',
      list: vendorList, search: vendorSearch, readonly: ['vendor_id', 'updated'],
      types: vendorTypes, options: { status: VSTAT, region: ['Las Vegas', 'Northern Nevada', 'Both'] }, labels: vendorLabels, sections: vendorSections,
      stamp: { col: 'updated', fmt: 'yyyy-MM-dd' },
      quick: [{ label: 'Active', col: 'status', is: 'Active' }, { label: 'In Progress', col: 'status', is: 'In Progress' }, { label: 'Waiting for Account', col: 'status', is: 'Waiting for Account' }, { label: 'Prospect', col: 'status', is: 'Prospect' }]
    },
    {
      key: 'vendors_nnv', group: 'Vendors', label: 'Vendors, Northern Nevada', one: 'vendor',
      help: 'The Northern Nevada (Reno, Sparks, Carson City) vendor directory, one vendor per page.',
      ss: function () { return vdSS_(); }, tab: 'Vendors Northern Nevada',
      idCol: 'vendor_id', titleCol: 'dba_name', dateCol: 'updated',
      list: vendorList, search: vendorSearch, readonly: ['vendor_id', 'updated'],
      types: vendorTypes, options: { status: VSTAT, region: ['Las Vegas', 'Northern Nevada', 'Both'] }, labels: vendorLabels, sections: vendorSections,
      stamp: { col: 'updated', fmt: 'yyyy-MM-dd' },
      quick: [{ label: 'Active', col: 'status', is: 'Active' }, { label: 'In Progress', col: 'status', is: 'In Progress' }, { label: 'Waiting for Account', col: 'status', is: 'Waiting for Account' }, { label: 'Prospect', col: 'status', is: 'Prospect' }]
    },
    {
      key: 'staff', group: 'Team', label: 'Team roster', one: 'person',
      help: 'The internal staff roster the hubs read for FSM pickers, issuers and recognition. Set Active to FALSE to retire someone; rows are never removed because code reads this tab by position.',
      ss: function () { return staffSS_(); }, tab: 'Staff',
      idCol: '', titleCol: 'name', dateCol: '',
      list: ['name', 'role', 'market', 'territory', 'phone', 'email', 'active'],
      search: ['name', 'role', 'market', 'territory', 'email'],
      readonly: [], add: true, positional: true,
      types: { active: 'bool', email: 'email' },
      options: { role: ROLES, market: MARKETS, territory: [''].concat(TERR) },
      sections: [{ name: 'Person', fields: ['name', 'role', 'market', 'territory', 'phone', 'email', 'active'] }],
      quick: [{ label: 'Active', col: 'active', is: 'TRUE' }, { label: 'Retired', col: 'active', is: 'FALSE' }]
    }
  ];
}

function adrSurface_(key) {
  var list = adrSurfaces_();
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}

// ---------- plumbing ----------
function adrOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function adrPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function adrStr_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return adrDateStr_(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function adrDateStr_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  var hm = Utilities.formatDate(d, ADR_TZ, 'HH:mm');
  return Utilities.formatDate(d, ADR_TZ, 'yyyy-MM-dd') + (hm === '00:00' ? '' : ' ' + hm);
}
function adrNow_() { return Utilities.formatDate(new Date(), ADR_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function adrWho_(d) { return adrStr_(d.who || d.by || '').slice(0, 80) || 'unknown'; }
function adrTruthy_(v) { var s = adrStr_(v).trim().toUpperCase(); return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y'; }
function adrOpen_(surf) {
  var ss = surf.ss();
  var sh = ss.getSheetByName(surf.tab);
  if (!sh) throw new Error('Tab "' + surf.tab + '" was not found on its book.');
  return { ss: ss, sh: sh };
}
function adrHeaders_(sh) {
  var lastC = sh.getLastColumn();
  if (lastC < 1) return [];
  return sh.getRange(1, 1, 1, lastC).getValues()[0].map(function (h) { return adrStr_(h).trim(); });
}
function adrLabel_(surf, col) {
  if (surf.labels && surf.labels[col]) return surf.labels[col];
  var s = String(col).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// The editor type for a column: declared wins, then options, then the cell itself.
function adrTypeOf_(surf, col, v) {
  if (surf.types && surf.types[col]) return surf.types[col];
  if (surf.options && surf.options[col]) return 'select';
  if (/^(active|hide|hidden|live|star|filled)$/i.test(col)) return 'bool';
  if (v instanceof Date) return Utilities.formatDate(v, ADR_TZ, 'HH:mm') === '00:00' ? 'date' : 'datetime';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  var s = adrStr_(v);
  if (/^https?:\/\//i.test(s)) return 'url';
  if (s.length > 90 || s.indexOf('\n') >= 0) return 'long';
  return 'text';
}
// What the editor sees for a cell, normalised so old/new comparisons are stable.
function adrNorm_(v, type) {
  if (type === 'bool') return adrTruthy_(v) ? 'TRUE' : 'FALSE';
  if (type === 'number') { var s = adrStr_(v).trim(); if (s === '') return ''; var n = Number(s.replace(/[$,\s]/g, '')); return isNaN(n) ? s : String(n); }
  if (type === 'date' || type === 'datetime') { if (v instanceof Date) return adrDateStr_(v); return adrStr_(v).trim(); }
  return adrStr_(v);
}
// The value written back. cur is the cell's current raw value, so a checkbox stays a checkbox.
function adrCoerce_(v, type, cur) {
  if (type === 'bool') { var b = adrTruthy_(v); return typeof cur === 'boolean' ? b : (b ? 'TRUE' : 'FALSE'); }
  if (type === 'number') { var s = adrStr_(v).trim(); if (s === '') return ''; var n = Number(s.replace(/[$,\s]/g, '')); return isNaN(n) ? s : n; }
  if (type === 'date' || type === 'datetime') {
    var t = adrStr_(v).trim(); if (t === '') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
    if (!m) return t;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0);
  }
  return String(v === null || v === undefined ? '' : v);
}
function adrLog_(who, action, surf, row, field, oldv, newv) {
  return saLog_(who, action, ADR_PREFIX + surf.key, surf.tab, row, field, oldv, newv);
}
function adrUrl_(o, row) {
  var u = o.ss.getUrl().replace(/\/edit.*$/, '/edit') + '#gid=' + o.sh.getSheetId();
  return row ? u + '&range=A' + row + ':' + String.fromCharCode(64 + Math.min(26, Math.max(1, o.sh.getLastColumn()))) + row : u;
}
function adrMeta_(surf) {
  return { key: surf.key, group: surf.group, label: surf.label, one: surf.one || 'record', tab: surf.tab, help: surf.help || '', idCol: surf.idCol || '', titleCol: surf.titleCol || '', dateCol: surf.dateCol || '', list: surf.list, search: surf.search || [], quick: surf.quick || [], add: !!surf.add, positional: !!surf.positional, internal: surf.internal || [] };
}

// ---------- dispatcher ----------
function adrDispatch(d) {
  var kind = String(d.kind || '');
  if ((d.passcode || '') !== adrPass_()) return adrOut_({ ok: false, error: 'Wrong passcode.' });
  try {
    if (kind === 'adr_surfaces') return adrOut_({ ok: true, surfaces: adrSurfaces_().map(adrMeta_) });
    if (kind === 'adr_list') return adrList_(d);
    if (kind === 'adr_get') return adrGet_(d);
    if (kind === 'adr_save') return adrSave_(d);
    if (kind === 'adr_add') return adrAdd_(d);
    if (kind === 'adr_log') return adrLogList_(d);
    if (kind === 'adr_undo') return adrUndo_(d);
    return adrOut_({ ok: false, error: 'Unknown adr kind: ' + kind });
  } catch (err) {
    return adrOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------- list: light rows, list columns only ----------
function adrList_(d) {
  var surf = adrSurface_(String(d.surface || ''));
  if (!surf) return adrOut_({ ok: false, error: 'Not a record type this page can open.' });
  var o = adrOpen_(surf), sh = o.sh;
  var head = adrHeaders_(sh);
  var last = sh.getLastRow();
  var cols = surf.list.filter(function (c) { return head.indexOf(c) >= 0; });
  var extra = (surf.search || []).filter(function (c) { return head.indexOf(c) >= 0 && cols.indexOf(c) < 0; });
  var take = cols.concat(extra);
  var idx = take.map(function (c) { return head.indexOf(c); });
  var titleC = head.indexOf(surf.titleCol), idC = head.indexOf(surf.idCol);
  var rows = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
    for (var r = 0; r < vals.length; r++) {
      var v = vals[r];
      var anchor = idC >= 0 ? v[idC] : (titleC >= 0 ? v[titleC] : v[0]);
      if (adrStr_(anchor).trim() === '') {
        // a row with no id and no title is a blank or a spacer; skip it. Setup paints
        // checkbox rules far down these tabs, so an unchecked box (false) is not content.
        var any = false;
        for (var k = 0; k < idx.length; k++) { var cell = v[idx[k]]; if (cell !== false && adrStr_(cell).trim() !== '') { any = true; break; } }
        if (!any) continue;
      }
      var row = { _row: r + 2 };
      for (var i = 0; i < take.length; i++) row[take[i]] = adrNorm_(v[idx[i]], adrTypeOf_(surf, take[i], v[idx[i]]));
      rows.push(row);
    }
  }
  return adrOut_({ ok: true, surface: adrMeta_(surf), cols: cols, rows: rows, count: rows.length, url: adrUrl_(o), last_row: last, generated: adrNow_() });
}

// ---------- get: one full record with field metadata ----------
function adrGet_(d) {
  var surf = adrSurface_(String(d.surface || ''));
  if (!surf) return adrOut_({ ok: false, error: 'Not a record type this page can open.' });
  var row = Number(d.row);
  if (!(row >= 2)) return adrOut_({ ok: false, error: 'Bad row.' });
  var o = adrOpen_(surf), sh = o.sh;
  var head = adrHeaders_(sh);
  if (row > sh.getLastRow()) return adrOut_({ ok: false, error: 'That row is past the end of the tab.' });
  var vals = sh.getRange(row, 1, 1, head.length).getValues()[0];
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
  var id = surf.idCol ? rec[surf.idCol] : '';
  var title = surf.titleCol ? rec[surf.titleCol] : '';
  return adrOut_({ ok: true, surface: adrMeta_(surf), row: row, id: id, title: title, rec: rec, fields: fields, url: adrUrl_(o, row) });
}

// ---------- save: only the fields that changed, only if nobody changed them first ----------
function adrSave_(d) {
  var surf = adrSurface_(String(d.surface || ''));
  if (!surf) return adrOut_({ ok: false, error: 'Not a record type this page can open.' });
  var row = Number(d.row);
  if (!(row >= 2)) return adrOut_({ ok: false, error: 'Bad row.' });
  var changes = d.changes || {};
  var o = adrOpen_(surf), sh = o.sh;
  var head = adrHeaders_(sh);
  if (row > sh.getLastRow()) return adrOut_({ ok: false, error: 'That row is past the end of the tab.' });
  var cur = sh.getRange(row, 1, 1, head.length).getValues()[0];
  if (surf.idCol) {
    var ic = head.indexOf(surf.idCol);
    if (ic >= 0 && d.id !== undefined && adrStr_(cur[ic]) !== adrStr_(d.id)) return adrOut_({ ok: false, error: 'The rows moved since you loaded this ' + (surf.one || 'record') + ' (row ' + row + ' is now ' + adrStr_(cur[ic]) + '). Reload the list.' });
  }
  var who = adrWho_(d);
  var written = [], stale = [], skipped = [], ids = [];
  Object.keys(changes).forEach(function (col) {
    var c = head.indexOf(col);
    if (c < 0) { skipped.push(col + ' (no such column)'); return; }
    if ((surf.readonly || []).indexOf(col) >= 0) { skipped.push(col + ' (read only)'); return; }
    var ch = changes[col] || {};
    var type = adrTypeOf_(surf, col, cur[c]);
    var oldSeen = adrNorm_(ch.old, type), now = adrNorm_(cur[c], type);
    if (oldSeen !== now) { stale.push(col); return; }
    var nv = adrCoerce_(ch['new'], type, cur[c]);
    if (adrNorm_(nv, type) === now) return;
    sh.getRange(row, c + 1).setValue(nv);
    ids.push(adrLog_(who, 'edit', surf, row, col, adrStr_(cur[c]), adrStr_(nv)));
    written.push(col);
  });
  if (written.length && surf.stamp) {
    var sc = head.indexOf(surf.stamp.col);
    if (sc >= 0) sh.getRange(row, sc + 1).setValue(Utilities.formatDate(new Date(), ADR_TZ, surf.stamp.fmt || 'yyyy-MM-dd'));
  }
  if (stale.length && !written.length) return adrOut_({ ok: false, error: 'Changed by someone else since you opened it: ' + stale.join(', ') + '. Reload and try again.', stale: stale, skipped: skipped });
  return adrOut_({ ok: true, written: written, stale: stale, skipped: skipped, log_ids: ids });
}

// ---------- add: only where the surface allows it ----------
function adrAdd_(d) {
  var surf = adrSurface_(String(d.surface || ''));
  if (!surf) return adrOut_({ ok: false, error: 'Not a record type this page can open.' });
  if (!surf.add) return adrOut_({ ok: false, error: 'New ' + (surf.one || 'record') + 's are not added here. Use the form the hub links for that.' });
  var values = d.values || {};
  var o = adrOpen_(surf), sh = o.sh;
  var head = adrHeaders_(sh);
  var row = sh.getLastRow() + 1;
  // an existing row shows how each column stores its values (checkbox or text)
  var sample = row > 2 ? sh.getRange(2, 1, 1, head.length).getValues()[0] : head.map(function () { return ''; });
  var out = head.map(function (col, i) {
    if (!col) return '';
    var type = adrTypeOf_(surf, col, sample[i]);
    if (values[col] === undefined) return type === 'bool' ? adrCoerce_('TRUE', type, sample[i]) : '';
    return adrCoerce_(values[col], type, sample[i]);
  });
  var titleC = head.indexOf(surf.titleCol);
  if (titleC >= 0 && adrStr_(out[titleC]).trim() === '') return adrOut_({ ok: false, error: adrLabel_(surf, surf.titleCol) + ' is required.' });
  if (titleC >= 0 && sh.getLastRow() >= 2) {
    var existing = sh.getRange(2, titleC + 1, sh.getLastRow() - 1, 1).getValues();
    var want = adrStr_(out[titleC]).trim().toLowerCase();
    for (var i = 0; i < existing.length; i++) if (adrStr_(existing[i][0]).trim().toLowerCase() === want) return adrOut_({ ok: false, error: 'There is already a row for "' + out[titleC] + '" (row ' + (i + 2) + '). Edit that one.' });
  }
  sh.getRange(row, 1, 1, head.length).setValues([out]);
  var id = adrLog_(adrWho_(d), 'add', surf, row, '', '', JSON.stringify(out.map(adrStr_)));
  return adrOut_({ ok: true, row: row, log_id: id });
}

// ---------- log and undo (shared Site Admin Log tab) ----------
function adrLogList_(d) {
  var sh = saLogSheet_();
  var last = sh.getLastRow();
  var limit = Math.min(Math.max(Number(d.limit) || 60, 1), 400);
  var want = d.surface ? ADR_PREFIX + String(d.surface) : '';
  var rows = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, SA_LOG_HEADERS.length).getValues();
    for (var i = vals.length - 1; i >= 0 && rows.length < limit; i--) {
      var surface = adrStr_(vals[i][SA_LOG_HEADERS.indexOf('surface')]);
      if (surface.indexOf(ADR_PREFIX) !== 0) continue;
      if (want && surface !== want) continue;
      var o = { _row: i + 2 };
      SA_LOG_HEADERS.forEach(function (h, c) { var v = adrStr_(vals[i][c]); if ((h === 'old' || h === 'new') && v.length > 400) v = v.slice(0, 400) + '...'; o[h] = v; });
      o.surface = surface.slice(ADR_PREFIX.length);
      rows.push(o);
    }
  }
  return adrOut_({ ok: true, rows: rows });
}
function adrUndo_(d) {
  var e = saLogFind_(String(d.log_id || ''));
  if (!e) return adrOut_({ ok: false, error: 'Log entry not found.' });
  if (adrStr_(e.undone)) return adrOut_({ ok: false, error: 'Already undone.' });
  var surface = adrStr_(e.surface);
  if (surface.indexOf(ADR_PREFIX) !== 0) return adrOut_({ ok: false, error: 'That entry was not made by this page.' });
  var surf = adrSurface_(surface.slice(ADR_PREFIX.length));
  if (!surf) return adrOut_({ ok: false, error: 'That record type is no longer editable here.' });
  var who = adrWho_(d), action = adrStr_(e.action), row = Number(e.row);
  var o = adrOpen_(surf), sh = o.sh, head = adrHeaders_(sh);
  var logSh = saLogSheet_();
  function markUndone(newId) { logSh.getRange(e._row, SA_LOG_HEADERS.indexOf('undone') + 1).setValue(newId); }
  if (action === 'edit') {
    var col = adrStr_(e.field), c = head.indexOf(col);
    if (c < 0) return adrOut_({ ok: false, error: 'Column ' + col + ' no longer exists.' });
    var curv = sh.getRange(row, c + 1).getValue();
    var type = adrTypeOf_(surf, col, curv);
    if (adrNorm_(curv, type) !== adrNorm_(e['new'], type)) return adrOut_({ ok: false, error: 'That field has changed again since (now "' + adrStr_(curv) + '"). Edit it directly instead.' });
    var back = adrCoerce_(e.old, type, curv);
    sh.getRange(row, c + 1).setValue(back);
    var uid = adrLog_(who, 'undo', surf, row, col, adrStr_(curv), adrStr_(back));
    markUndone(uid); return adrOut_({ ok: true, log_id: uid });
  }
  if (action === 'add') {
    if (surf.positional) return adrOut_({ ok: false, error: 'This tab is read by position, so an added row is never removed. Set Active to FALSE instead.' });
    var cur2 = sh.getRange(row, 1, 1, head.length).getValues()[0].map(adrStr_);
    var was = JSON.parse(adrStr_(e['new'])).map(adrStr_);
    if (cur2.join('\x1f') !== was.join('\x1f')) return adrOut_({ ok: false, error: 'That row has been edited since it was added.' });
    sh.getRange(row, 1, 1, head.length).clearContent();
    var aid = adrLog_(who, 'undo', surf, row, '', adrStr_(e['new']), '');
    markUndone(aid); return adrOut_({ ok: true, log_id: aid });
  }
  return adrOut_({ ok: false, error: 'Cannot undo a ' + action + ' entry.' });
}

// ---------- editor helper: confirm every surface opens and log its headers ----------
function adrCheckSurfacesRun() {
  adrSurfaces_().forEach(function (s) {
    try { var o = adrOpen_(s); Logger.log(s.key + ' -> ' + s.tab + ': ' + o.sh.getLastRow() + ' rows; ' + adrHeaders_(o.sh).join(', ')); }
    catch (e) { Logger.log(s.key + ' FAILED: ' + e.message); }
  });
}
