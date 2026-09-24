// ============================================================
// Supply.gs - splits the supply and inventory tabs off the
// CW Solicitations book into their own spreadsheet.
// Idempotent: safe to run more than once. Never deletes a
// source tab; the source tabs are archived by hand afterwards.
// ============================================================

function cwSupplySplit() {
  var SRC_ID = '1ymbqR7LMvA7sbgZe2Ro5o2dNiXhP08Tn9Hw1b-H5AeQ';
  var TABS = ['EnvirOx Catalog', 'EnvirOx Orders', 'Supply Orders'];
  var NEW_NAME = 'CW Supply and Inventory';

  var props = PropertiesService.getScriptProperties();
  var src = SpreadsheetApp.openById(SRC_ID);

  var dest = null;
  var destId = props.getProperty('SUPPLY_SHEET_ID');
  if (destId) { try { dest = SpreadsheetApp.openById(destId); } catch (e) { dest = null; } }

  if (!dest) {
    dest = SpreadsheetApp.create(NEW_NAME);
    props.setProperty('SUPPLY_SHEET_ID', dest.getId());
    try {
      var it = DriveApp.getFoldersByName('Team Portal');
      if (it.hasNext()) {
        var folder = it.next();
        var file = DriveApp.getFileById(dest.getId());
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      }
    } catch (e) {}
  }

  var report = [];
  for (var i = 0; i < TABS.length; i++) {
    var name = TABS[i];
    var s = src.getSheetByName(name);
    if (!s) { report.push(name + ' :: MISSING IN SOURCE'); continue; }
    var already = dest.getSheetByName(name);
    if (already) { dest.deleteSheet(already); }
    var copied = s.copyTo(dest);
    copied.setName(name);
    var a = s.getDataRange();
    var b = dest.getSheetByName(name).getDataRange();
    var ok = (a.getNumRows() === b.getNumRows() && a.getNumColumns() === b.getNumColumns());
    report.push(name + ' :: src ' + a.getNumRows() + 'x' + a.getNumColumns() +
                ' dest ' + b.getNumRows() + 'x' + b.getNumColumns() + ' match=' + ok);
  }

  var def = dest.getSheetByName('Sheet1');
  if (def && dest.getSheets().length > 1) { dest.deleteSheet(def); }

  var names = [];
  var all = dest.getSheets();
  for (var j = 0; j < all.length; j++) { names.push(all[j].getName()); }
  report.push('DEST TABS :: ' + names.join(' | '));
  report.push('DEST ID :: ' + dest.getId());
  report.push('DEST URL :: ' + dest.getUrl());

  var text = report.join('\n');
  Logger.log(text);
  return text;
}

// ------------------------------------------------------------
// supSS_() is the ONLY door into the supply and inventory book.
// Code.gs supply handlers call this instead of opening the
// solicitations book. The id lives in ScriptProperties
// (SUPPLY_SHEET_ID) so it can be repointed without a code edit.
// ------------------------------------------------------------
function supSS_() {
  // Router over the supplies family (Books.gs): CW Building Supplies Reports,
  // with the two EnvirOx tabs answered by CW EnvirOx Orders.
  return cwRouter_('sup');
}
