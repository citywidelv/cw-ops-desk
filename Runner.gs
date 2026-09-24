// Runner.gs - maintenance runner for the CW Team Portal backend (was CW Solicitations). Sep 5 2026.
// The editor's function picker is unreliable under automation, so this file's FIRST function is
// what the Run button fires when Runner.gs is open. Edit the body, save, Run, then put it back to
// the no-op. Never deploy anything that depends on it.
// Sep 24 2026: used for the one-workbook-per-subject split (cwBooksMigrate / cwBooksVerify /
// cwBooksArchiveOld in Books.gs). Body is the no-op again.
function cwRunNow() {
  Logger.log('cwRunNow: nothing to do');
  return 'nothing to do';
}
