// Runner.gs - maintenance runner for the CW Solicitations project (Sep 5 2026).
// The editor's function picker is unreliable under automation, so this file's FIRST function is
// what the Run button fires when Runner.gs is open. Edit the body, save, Run, then put it back to
// the no-op. Never deploy anything that depends on it. Live copy currently calls cwInstallDigestTrigger()
// so TJ can arm the exact-time 8am/4pm triggers with one Run + one OAuth approval.
function cwRunNow() {
  var out = [];
  out.push(cwInstallDigestTrigger());
  Logger.log(out.join('\n'));
  return out.join('\n');
}
