const {
  userLikelyNeedsDesktop,
  userLikelyNeedsWeb,
  suggestedDesktopLaunchCommand,
  usedDesktopTools,
  looksLikeDesktopRefusal,
} = require('../packages/agent/dist/model-profile');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(userLikelyNeedsDesktop('open notepad and type hello'), 'notepad');
assert(userLikelyNeedsDesktop("what's on my screen?"), 'screen');
assert(userLikelyNeedsDesktop('click the Start button'), 'click');
assert(userLikelyNeedsDesktop('take a screenshot of the desktop'), 'shot');
assert(!userLikelyNeedsDesktop('list car dealers in Gallatin'), 'dealers not desktop');
assert(!userLikelyNeedsWeb('open notepad and type hello'), 'notepad not web');
assert(userLikelyNeedsWeb('list car dealers in Gallatin'), 'dealers web');
assert(
  suggestedDesktopLaunchCommand('please open Notepad for me') ===
    'Start-Process notepad; Start-Sleep -Seconds 1',
  'launch notepad'
);
assert(usedDesktopTools(['web_search', 'desktop_screenshot']), 'used desktop');
assert(!usedDesktopTools(['web_search']), 'no desktop');
assert(
  looksLikeDesktopRefusal('I do not have the capability to perform this task.'),
  'capability refusal'
);
assert(
  looksLikeDesktopRefusal('I cannot control the mouse or keyboard on your computer.'),
  'mouse refusal'
);
console.log('OK desktop-routing');
