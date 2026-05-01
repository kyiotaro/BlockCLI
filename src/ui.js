// src/ui.js
// Terminal UI helpers - colors, boxes, formatting

const chalk = require('chalk');
const boxen = require('boxen');
const { formatCountdown, formatDuration, getRemainingSeconds } = require('./time');

// Color palette
const C = {
  red:     chalk.hex('#FF4444'),
  orange:  chalk.hex('#FF8C00'),
  yellow:  chalk.hex('#FFD700'),
  green:   chalk.hex('#44FF88'),
  cyan:    chalk.hex('#00D4FF'),
  white:   chalk.hex('#F0F0F0'),
  dim:     chalk.hex('#666666'),
  bold:    chalk.bold,
};

function logo() {
  console.log('');
  console.log(C.red.bold('  ██████╗ ██╗      ██████╗  ██████╗██╗  ██╗'));
  console.log(C.red.bold('  ██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝'));
  console.log(C.orange.bold('  ██████╔╝██║     ██║   ██║██║     █████╔╝ '));
  console.log(C.yellow.bold('  ██╔══██╗██║     ██║   ██║██║     ██╔═██╗ '));
  console.log(C.yellow.bold('  ██████╔╝███████╗╚██████╔╝╚██████╗██║  ██╗'));
  console.log(C.dim('  ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝'));
  console.log(C.dim('                              BLOCK  CLI  v1.0.0'));
  console.log('');
}

function printHelp() {
  logo();
  const lines = [
    C.cyan.bold('USAGE'),
    '',
    `  ${C.white('block')} ${C.yellow('<app>')} ${C.green('<duration>')}    Block an app for a duration`,
    `  ${C.white('block')} ${C.yellow('status')}               Show current session status`,
    `  ${C.white('block')} ${C.yellow('list')}                 List blocked apps in session`,
    '',
    C.cyan.bold('DURATION FORMAT'),
    '',
    `  ${C.green('H.MM.SS')}   →   ${C.dim('1.20.00  =  1 hour 20 minutes')}`,
    `  ${C.green('MM.SS')}     →   ${C.dim('30.00    =  30 minutes')}`,
    `  ${C.green('Xh Ym')}     →   ${C.dim('1h30m    =  1 hour 30 minutes')}`,
    '',
    C.cyan.bold('EXAMPLES'),
    '',
    `  ${C.dim('$')} block roblox ${C.green('1.30.00')}         Block Roblox for 1h 30m`,
    `  ${C.dim('$')} block discord ${C.green('45.00')}           Block Discord for 45m`,
    `  ${C.dim('$')} block status                  Check remaining time`,
    '',
    C.red('  ⚠  Once started, a session CANNOT be stopped early.'),
    C.dim('     Stay focused. You got this.'),
  ].join('\n');

  console.log(boxen(lines, {
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
    borderStyle: 'round',
    borderColor: '#FF4444',
  }));
  console.log('');
}

function printError(msg) {
  console.log('');
  console.log(C.red(`  ✗  ${msg}`));
  console.log('');
}

function printSuccess(msg) {
  console.log('');
  console.log(C.green(`  ✓  ${msg}`));
  console.log('');
}

function printWarning(msg) {
  console.log('');
  console.log(C.orange(`  ⚠  ${msg}`));
  console.log('');
}

/**
 * Show session started confirmation box
 */
function printSessionStarted(apps, durationSeconds, endTime) {
  console.log('');

  const appList = apps.map(a => `    ${C.red('▶')} ${C.white(a.displayName)}`).join('\n');
  const duration = formatDuration(durationSeconds);

  const lines = [
    C.red.bold('  🔒 SESSION ACTIVE — NO TURNING BACK'),
    '',
    C.dim('  Blocking:'),
    appList,
    '',
    C.dim('  Duration:    ') + C.yellow.bold(duration),
    C.dim('  Ends at:     ') + C.white(new Date(endTime).toLocaleTimeString()),
    '',
    C.dim('  The blocker is running in the background.'),
    C.dim('  Any attempt to open blocked apps will be killed.'),
    '',
    C.green('  Now go. Study hard. 📚'),
  ].join('\n');

  console.log(boxen(lines, {
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
    borderStyle: 'double',
    borderColor: '#FF4444',
  }));
  console.log('');
}

/**
 * Show live status with countdown
 */
function printStatus(session) {
  const remaining = getRemainingSeconds(session.endTime);
  const countdown = formatCountdown(remaining);
  const appNames = session.apps.map(a => a.displayName).join(', ');

  // Progress percentage
  const totalDuration = Math.ceil((session.endTime - session.startTime) / 1000);
  const elapsed = totalDuration - remaining;
  const percent = Math.min(100, Math.floor((elapsed / totalDuration) * 100));

  // Progress bar (40 chars wide)
  const barWidth = 38;
  const filled = Math.floor((percent / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = C.red('█'.repeat(filled)) + C.dim('░'.repeat(empty));

  console.log('');

  const lines = [
    C.red.bold('  🔒 FOCUS SESSION ACTIVE'),
    '',
    C.dim('  Blocking:    ') + C.white(appNames),
    C.dim('  Remaining:   ') + C.yellow.bold(countdown),
    C.dim('  Ends at:     ') + C.white(new Date(session.endTime).toLocaleTimeString()),
    '',
    `  [${bar}] ${C.dim(percent + '%')}`,
    '',
    remaining < 300
      ? C.green('  Almost done! Keep going! 🔥')
      : C.dim('  Stay focused. You can do this.'),
  ].join('\n');

  console.log(boxen(lines, {
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
    borderStyle: 'round',
    borderColor: '#FF8C00',
  }));
  console.log('');
}

/**
 * Print app selection header
 */
function printScanningApps() {
  process.stdout.write(C.dim('  Scanning installed apps') + C.dim(' ...'));
}

function printScanDone() {
  process.stdout.write(' ' + C.green('done') + '\n\n');
}

module.exports = {
  logo,
  printHelp,
  printError,
  printSuccess,
  printWarning,
  printSessionStarted,
  printStatus,
  printScanningApps,
  printScanDone,
  C
};
