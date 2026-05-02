// src/daemon.js
// Background blocker daemon
// Strategy (3 layers):
//   1. Rename .exe → .exe.blocked  — file doesn't exist, can't launch at all
//   2. Registry DisallowRun        — fallback if rename fails (no admin on exe dir)
//   3. WMI process watcher         — kill anything that still slips through

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { loadSession, clearSession } = require('./session');
const { getRemainingSeconds } = require('./time');

const LOG_FILE = path.join(os.homedir(), '.blockcli', 'daemon.log');

function log(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ─── LAYER 1: EXE RENAME ──────────────────────────────────────────────────────

/**
 * Rename app.exe → app.exe.blocked so it cannot be launched at all.
 * Returns the blocked path if successful, null otherwise.
 */
function renameToBlocked(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return null;
  const blockedPath = exePath + '.blocked';
  try {
    fs.renameSync(exePath, blockedPath);
    log(`Renamed: ${exePath} → ${blockedPath}`);
    return blockedPath;
  } catch (e) {
    log(`Rename failed (${exePath}): ${e.message}`);
    return null;
  }
}

/**
 * Restore app.exe.blocked → app.exe
 */
function restoreFromBlocked(blockedPath) {
  if (!blockedPath || !fs.existsSync(blockedPath)) return;
  const exePath = blockedPath.replace(/\.blocked$/, '');
  try {
    fs.renameSync(blockedPath, exePath);
    log(`Restored: ${blockedPath} → ${exePath}`);
  } catch (e) {
    log(`Restore failed (${blockedPath}): ${e.message}`);
  }
}

// ─── LAYER 2: REGISTRY DISALLOWRUN ───────────────────────────────────────────

const REG_PATH = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer';

function addRegistryBlock(apps) {
  try {
    execSync(`powershell -NoProfile -Command "
      $p = '${REG_PATH}'
      if (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
      Set-ItemProperty -Path $p -Name DisallowRun -Value 1 -Type DWord -Force
      $dp = '$p\\DisallowRun'
      if (!(Test-Path $dp)) { New-Item -Path $dp -Force | Out-Null }
    "`, { timeout: 8000 });

    apps.forEach((app, i) => {
      const exeName = app.processName.endsWith('.exe')
        ? app.processName
        : app.processName + '.exe';
      execSync(`powershell -NoProfile -Command "
        Set-ItemProperty -Path '${REG_PATH}\\DisallowRun' -Name '${i + 1}' -Value '${exeName}' -Type String -Force
      "`, { timeout: 5000 });
      log(`Registry block added: ${exeName}`);
    });
  } catch (e) {
    log(`Registry block failed: ${e.message}`);
  }
}

function removeRegistryBlock() {
  try {
    execSync(`powershell -NoProfile -Command "
      $p = '${REG_PATH}'
      if (Test-Path '$p\\DisallowRun') { Remove-Item -Path '$p\\DisallowRun' -Recurse -Force }
      Remove-ItemProperty -Path '$p' -Name DisallowRun -ErrorAction SilentlyContinue
    "`, { timeout: 8000 });
    log('Registry block removed');
  } catch (e) {
    log(`Registry block removal failed: ${e.message}`);
  }
}

// ─── LAYER 3: WMI PROCESS WATCHER ────────────────────────────────────────────

function buildWmiWatcher(apps) {
  const conditions = apps.map(app => {
    const exeName = (app.processName.endsWith('.exe')
      ? app.processName
      : app.processName + '.exe').toLowerCase();
    return `$e.NewEvent.TargetInstance.Name.ToLower() -eq '${exeName}'`;
  }).join(' -or ');

  return `
$watcher = New-Object System.Management.ManagementEventWatcher
$watcher.Query = New-Object System.Management.WqlEventQuery(
  "__InstanceCreationEvent",
  (New-Object System.TimeSpan(0,0,1)),
  "TargetInstance ISA 'Win32_Process'"
)
$watcher.Start()
Write-Host "WATCHER_READY"
while ($true) {
  try {
    $e = $watcher.WaitForNextEvent()
    if (${conditions}) {
      $pid = $e.NewEvent.TargetInstance.ProcessId
      $name = $e.NewEvent.TargetInstance.Name
      try {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Write-Host "KILLED:$name:$pid"
      } catch {
        Write-Host "KILL_FAILED:$name:$pid"
      }
    }
  } catch {
    Write-Host "WATCHER_ERROR:$_"
    Start-Sleep -Seconds 1
  }
}
`;
}

function startWmiWatcher(apps, onKill) {
  const psScript = buildWmiWatcher(apps);
  const scriptPath = path.join(os.homedir(), '.blockcli', 'watcher.ps1');
  fs.writeFileSync(scriptPath, psScript);

  const proc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  proc.stdout.on('data', data => {
    data.toString().trim().split('\n').forEach(line => {
      line = line.trim();
      if (line.startsWith('KILLED:')) {
        const [, name, pid] = line.split(':');
        log(`WMI killed: ${name} (PID ${pid})`);
        if (onKill) onKill(name);
      } else if (line === 'WATCHER_READY') {
        log('WMI watcher ready');
      } else if (line.startsWith('WATCHER_ERROR')) {
        log(`WMI error: ${line}`);
      }
    });
  });

  proc.stderr.on('data', data => log(`WMI stderr: ${data.toString().trim()}`));
  proc.on('exit', code => log(`WMI watcher exited (code ${code})`));

  return proc;
}

// ─── KILL RUNNING INSTANCES ───────────────────────────────────────────────────

function killRunningInstances(apps) {
  apps.forEach(app => {
    try {
      execSync(`taskkill /f /im "${app.processName}.exe" 2>nul`, { timeout: 3000 });
      log(`Killed running: ${app.processName}`);
    } catch {}
    // Also try without .exe suffix in case processName already has it
    try {
      execSync(`taskkill /f /im "${app.processName}" 2>nul`, { timeout: 3000 });
    } catch {}
  });
}

// ─── SESSION TIMER ────────────────────────────────────────────────────────────

function waitForExpiry(session, watcherProc, blockedPaths) {
  const remaining = getRemainingSeconds(session.endTime);
  log(`Session expires in ${remaining}s`);

  setTimeout(() => {
    log('Session expired — cleaning up');

    // Kill watcher
    try { watcherProc.kill(); } catch {}

    // Layer 1: Restore renamed exes
    blockedPaths.forEach(p => restoreFromBlocked(p));

    // Layer 2: Remove registry block
    removeRegistryBlock();

    // Clear session file
    clearSession();

    log('All blocks removed. Session ended.');
    process.exit(0);
  }, remaining * 1000);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function runDaemon() {
  log('Daemon started');

  const session = loadSession();
  if (!session) {
    log('No session found, exiting');
    process.exit(0);
  }

  const remaining = getRemainingSeconds(session.endTime);
  if (remaining <= 0) {
    log('Session already expired');
    removeRegistryBlock();
    clearSession();
    process.exit(0);
  }

  // Step 1: Kill any already-running instances
  killRunningInstances(session.apps);

  // Step 2: Layer 1 — rename exe to .blocked
  const blockedPaths = [];
  session.apps.forEach(app => {
    const exePath = app.exePath;
    if (exePath) {
      const blockedPath = renameToBlocked(exePath);
      if (blockedPath) {
        blockedPaths.push(blockedPath);
        log(`Layer 1 active: ${app.processName} exe renamed`);
      } else {
        log(`Layer 1 skipped for ${app.processName}: rename failed, falling back`);
      }
    } else {
      log(`Layer 1 skipped for ${app.processName}: no exePath in session`);
    }
  });

  // Step 3: Layer 2 — registry DisallowRun (backup)
  addRegistryBlock(session.apps);

  // Step 4: Layer 3 — WMI watcher (catch anything that slips through)
  const watcher = startWmiWatcher(session.apps, name => {
    log(`Bypass attempt killed: ${name}`);
  });

  // Step 5: Wait for session to expire, then clean up
  waitForExpiry(session, watcher, blockedPaths);
}

runDaemon();
