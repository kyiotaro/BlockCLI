// src/block.js
// Main block command - handles app selection + session start

const inquirer = require('inquirer');
const { spawn } = require('child_process');
const path = require('path');

const { buildAppList, guessProcessName } = require('./scanner');
const { parseTime, formatDuration, getEndTime } = require('./time');
const { saveSession, loadSession } = require('./session');
const {
  C,
  printError,
  printSessionStarted,
  printScanningApps,
  printScanDone
} = require('./ui');

const { execSync } = require('child_process');

/**
 * Check if running as Administrator on Windows
 */
function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a block session
 * @param {string} appQuery - app name from command line (can be partial)
 * @param {string} timeStr - time string like "1.20.00"
 */
async function startBlock(appQuery, timeStr) {
  // 0. Check administrator privileges
  if (!isAdmin()) {
    printError(
      'BlockCLI requires Administrator privileges to kill processes.\n\n' +
      `  ${C.white('How to fix:')}\n` +
      `    1. Close this terminal\n` +
      `    2. Search for "PowerShell" or "Command Prompt" in Start Menu\n` +
      `    3. Right-click → ${C.yellow('"Run as administrator"')}\n` +
      `    4. Run your command again`
    );
    process.exit(1);
  }

  // 1. Parse duration first
  const durationSeconds = parseTime(timeStr);
  if (!durationSeconds || durationSeconds < 10) {
    printError(
      `Invalid duration: "${timeStr}"\n\n` +
      `  Use format:  ${C.green('H.MM.SS')}  or  ${C.green('MM.SS')}\n` +
      `  Examples:    ${C.yellow('1.20.00')}  (1h 20m)   ${C.yellow('30.00')}  (30m)`
    );
    process.exit(1);
  }

  // 2. Check no active session already running
  const existing = loadSession();
  if (existing) {
    const apps = existing.apps.map(a => a.displayName).join(', ');
    printError(
      `A session is already active blocking: ${C.yellow(apps)}\n\n` +
      `  Run ${C.cyan('block status')} to see remaining time.`
    );
    process.exit(1);
  }

  // 3. Scan apps
  printScanningApps();
  const appList = buildAppList();
  printScanDone();

  // 4. Filter based on query
  const query = appQuery.toLowerCase().trim();
  const filtered = appList.filter(app =>
    app.displayName.toLowerCase().includes(query) ||
    app.processName.toLowerCase().includes(query)
  );

  let selectedApp;

  if (filtered.length === 0) {
    // No match - allow manual input
    console.log(C.dim(`  No apps found matching "${appQuery}". Using as process name directly.\n`));
    selectedApp = {
      displayName: appQuery,
      processName: appQuery,
      source: 'manual'
    };
  } else if (filtered.length === 1) {
    // Exact single match
    selectedApp = filtered[0];
    console.log(`  ${C.dim('Found:')} ${C.white(selectedApp.displayName)} ${C.dim('(' + selectedApp.processName + ')')}\n`);
  } else {
    // Multiple matches - show autocomplete list
    const choices = filtered.slice(0, 30).map(app => ({
      name: app.isRunning
        ? `${app.displayName} ${C.dim('(running)')}`
        : app.displayName,
      value: app,
      short: app.displayName
    }));

    // Add separator + manual option at end
    choices.push(new inquirer.Separator());
    choices.push({
      name: C.dim(`Use "${appQuery}" directly as process name`),
      value: { displayName: appQuery, processName: appQuery, source: 'manual' },
      short: appQuery
    });

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'app',
        message: `  ${C.white('Select app to block:')}`,
        choices,
        pageSize: 12,
        loop: false
      }
    ]);

    selectedApp = answer.app;
  }

  // 5. Confirm & start session
  const endTime = getEndTime(durationSeconds);
  const startTime = Date.now();

  const session = {
    apps: [selectedApp],
    endTime,
    startTime,
    duration: durationSeconds
  };

  // Save session before spawning daemon
  saveSession(session);

  // 6. Spawn background daemon using wscript to suppress any window on Windows
  const daemonPath = path.join(__dirname, 'daemon.js');
  const vbsScript = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & "${daemonPath.replace(/\\/g, '\\\\')}" & """", 0, False
`.trim();

  const vbsPath = path.join(require('os').homedir(), '.focusblock', 'run-daemon.vbs');
  require('fs').writeFileSync(vbsPath, vbsScript);

  const daemon = spawn('wscript.exe', [vbsPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false
  });
  daemon.unref();

  // 7. Show confirmation
  printSessionStarted([selectedApp], durationSeconds, endTime);
}

module.exports = { startBlock };
