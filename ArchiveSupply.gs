// ============================================================
// ArchiveSupply.gs - retires the three supply tabs on the old
// CW Solicitations book AFTER the split has been verified.
// Renames them with an ARCHIVE prefix and hides them.
// Nothing is deleted. Run cwSupplyUnarchive to undo.
// ============================================================

function cwSupplyArchive() {
  var SRC_ID = '1ymbqR7LMvA7sbgZe2Ro5o2dNiXhP08Tn9Hw1b-H5AeQ';
  var TABS = ['EnvirOx Catalog', 'EnvirOx Orders', 'Supply Orders'];
  var PREFIX = 'ARCHIVE ';
  var src = SpreadsheetApp.openById(SRC_ID);
  var report = [];
  for (var i = 0; i < TABS.length; i++) {
    var name = TABS[i];
    var s = src.getSheetByName(name);
    if (!s) { report.push(name + ' :: already archived or missing'); continue; }
    s.setName(PREFIX + name);
    s.hideSheet();
    report.push(name + ' :: renamed to "' + PREFIX + name + '" and hidden');
  }
  var names = [];
  var all = src.getSheets();
  for (var j = 0; j < all.length; j++) {
    names.push(all[j].getName() + (all[j].isSheetHidden() ? ' [hidden]' : ''));
  }
  report.push('SOURCE TABS NOW :: ' + names.join(' | '));
  var text = report.join('\n');
  Logger.log(text);
  return text;
}

// One shot: clears the contents of any row on the new supply book
// whose text contains "safe to delete". Contents only, the row
// itself stays, matching the never-delete-a-row convention.
function cwSupplyTestCleanup() {
  var ss = supSS_();
  var out = [];
  var tabs = ['Supply Orders', 'EnvirOx Orders'];
  for (var t = 0; t < tabs.length; t++) {
    var sh = ss.getSheetByName(tabs[t]);
    if (!sh) continue;
    var rng = sh.getDataRange();
    var vals = rng.getValues();
    for (var r = 1; r < vals.length; r++) {
      var line = vals[r].join(' ').toLowerCase();
      if (line.indexOf('safe to delete') > -1) {
        sh.getRange(r + 1, 1, 1, rng.getNumColumns()).clearContent();
        out.push(tabs[t] + ' row ' + (r + 1) + ' cleared');
      }
    }
  }
  var text = out.length ? out.join('\n') : 'no test rows found';
  Logger.log(text);
  return text;
}
