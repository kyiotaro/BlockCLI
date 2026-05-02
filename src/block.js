// src/block.js
// Main block command - handles app selection + session start

const inquirer = require('inquirer');
const { spawn, execSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const { parseTime, formatDuration, getEndTime } = require('./time');
const { saveSession, loadSession } = require('./session');
const {
  C,
  printError,
  printSessionStarted,
} = require('./ui');

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
 * Get snapshot of all currently running process names
 * Returns a Set of lowercase process names (without .exe)
 */
function getProcessSnapshot() {
  try {
    const out = execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 5000 });
    const names = new Set();
    out.trim().split('\n').forEach(line => {
      const parts = line.replace(/"/g, '').split(',');
      const name = parts[0]?.replace(/\.exe$/i, '').trim();
      if (name) names.add(name.toLowerCase());
    });
    return names;
  } catch {
    return new Set();
  }
}

/**
 * Get full process info for a given process name (exe path, pid)
 */
function getProcessInfo(processName) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object -First 1 Name,Id,@{N='Exe';E={try{$_.MainModule.FileName}catch{''}}} | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!out) return null;
    const p = JSON.parse(out);
    return {
      processName: p.Name,
      pid: p.Id,
      exePath: p.Exe || null,
      displayName: p.Name
    };
  } catch {
    return null;
  }
}

/**
 * Simple fuzzy match — does the new process name relate to the query?
 * Returns a score 0-1
 */
function matchScore(query, processName) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const p = processName.toLowerCase().replace(/\s+/g, '');

  if (p === q) return 1;
  if (p.includes(q) || q.includes(p)) return 0.9;

  // Check word overlap
  const qWords = query.toLowerCase().split(/\s+/);
  const matched = qWords.filter(w => w.length > 2 && p.includes(w));
  if (matched.length > 0) return 0.7;

  // Check partial prefix
  if (p.startsWith(q.slice(0, 4)) || q.startsWith(p.slice(0, 4))) return 0.6;

  return 0;
}

/**
 * Watch for new processes that match the query.
 * Polls every 800ms, compares against baseline snapshot.
 * Resolves with the detected process info.
 */
function watchForNewProcess(query, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const baseline = getProcessSnapshot();
    const deadline = Date.now() + timeoutMs;

    const interval = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error('TIMEOUT'));
        return;
      }

      const current = getProcessSnapshot();

      // Find new processes not in baseline
      const newProcs = [];
      for (const name of current) {
        if (!baseline.has(name)) {
          newProcs.push(name);
          baseline.add(name); // add to baseline so we don't re-detect
        }
      }

      if (newProcs.length === 0) return;

      // Score each new process against query
      const scored = newProcs
        .map(name => ({ name, score: matchScore(query, name) }))
        .filter(x => x.score >= 0.6)
        .sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        clearInterval(interval);
        const best = scored[0];
        const info = getProcessInfo(best.name);
        resolve(info || { processName: best.name, displayName: best.name, exePath: null });
      }
    }, 800);

    // Allow Ctrl+C to cancel
    process.on('SIGINT', () => {
      clearInterval(interval);
      reject(new Error('CANCELLED'));
    });
  });
}

/**
 * Animate a waiting spinner with message
 * Returns a stop function
 */
function startSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write('\n');
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan(frames[i % frames.length])}  ${message}`);
    i++;
  }, 80);

  return () => {
    clearInterval(timer);
    process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
  };
}

/**
 * Ask user to confirm the detected process
 */
async function confirmProcess(proc) {
  console.log(`\n  ${C.green('✓')}  Terdeteksi: ${C.white.bold(proc.processName)} ${proc.exePath ? C.dim('→ ' + proc.exePath) : ''}\n`);

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      message: `  ${C.white('Block app ini?')}`,
      default: true,
      prefix: ' '
    }
  ]);

  return answer.ok;
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

  // 1. Parse duration
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

  // 3. Prompt user to open the app
  console.log('');
  console.log(`  ${C.cyan.bold('Buka app')} ${C.white.bold('"' + appQuery + '"')} ${C.cyan.bold('sekarang...')}`);
  console.log(`  ${C.dim('BlockCLI akan otomatis mendeteksi prosesnya.')}`);
  console.log(`  ${C.dim('Ctrl+C untuk batal.')}\n`);

  // 4. Watch for the process to appear
  const stopSpinner = startSpinner(C.dim('Menunggu app dibuka...'));

  let detectedProc;
  try {
    detectedProc = await watchForNewProcess(appQuery, 60000);
    stopSpinner();
  } catch (err) {
    stopSpinner();
    if (err.message === 'TIMEOUT') {
      printError(
        `Timeout: app "${appQuery}" tidak terdeteksi dalam 60 detik.\n\n` +
        `  Pastikan nama app benar dan coba lagi.`
      );
    } else {
      console.log(`\n  ${C.dim('Dibatalkan.')}\n`);
    }
    process.exit(1);
  }

  // 5. Confirm with user
  const confirmed = await confirmProcess(detectedProc);
  if (!confirmed) {
    console.log(`\n  ${C.dim('Dibatalkan.')}\n`);
    process.exit(0);
  }

  // 6. Build session and save
  const endTime = getEndTime(durationSeconds);
  const startTime = Date.now();

  const selectedApp = {
    displayName: detectedProc.displayName || detectedProc.processName,
    processName: detectedProc.processName,
    exePath: detectedProc.exePath || null,
    source: 'detected'
  };

  const session = {
    apps: [selectedApp],
    endTime,
    startTime,
    duration: durationSeconds
  };

  saveSession(session);

  // 7. Spawn background daemon via VBS (no window)
  const daemonPath = path.join(__dirname, 'daemon.js');
  const vbsScript = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & "${daemonPath.replace(/\\/g, '\\\\')}" & """", 0, False
`.trim();

  const vbsPath = path.join(require('os').homedir(), '.blockcli', 'run-daemon.vbs');
  require('fs').writeFileSync(vbsPath, vbsScript);

  const daemon = spawn('wscript.exe', [vbsPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false
  });
  daemon.unref();

  // 8. Show confirmation
  printSessionStarted([selectedApp], durationSeconds, endTime);
}

module.exports = { startBlock };
