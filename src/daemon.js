// src/daemon.js
// Background blocker daemon
// Strategy:
//   1. Registry DisallowRun  — blocks app from opening normally
//   2. WMI process watcher   — event-based kill if app bypasses registry
//   No polling loop needed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { loadSession, clearSession, saveSession } = require('./session');
const { getRemainingSeconds } = require('./time');

const LOG_FILE = path.join(os.homedir(), '.blockcli', 'daemon.log');

function log(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ─── REGISTRY BLOCK ───────────────────────────────────────────────────────────

const REG_PATH = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer';

function addRegistryBlock(apps) {
  try {
    // Ensure Explorer key and DisallowRun DWORD = 1 exist
    execSync(`powershell -NoProfile -Command "
      $p = '${REG_PATH}'
      if (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
      Set-ItemProperty -Path $p -Name DisallowRun -Value 1 -Type DWord -Force
      $dp = '$p\\DisallowRun'
      if (!(Test-Path $dp)) { New-Item -Path $dp -Force | Out-Null }
    "`, { timeout: 8000 });

    // Add each app exe as a numbered string value
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

// ─── WMI PROCESS WATCHER ──────────────────────────────────────────────────────

function buildWmiWatcher(apps) {
  // Build PowerShell condition for each app
  const conditions = apps.map(app => {
    const exeName = (app.processName.endsWith('.exe')
      ? app.processName
      : app.processName + '.exe').toLowerCase();
    return `$e.NewEvent.TargetInstance.Name.ToLower() -eq '${exeName}'`;
  }).join(' -or ');

  // PowerShell script: watch for process creation, kill if it's a blocked app
  const ps = `
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
  return ps;
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
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      line = line.trim();
      if (line.startsWith('KILLED:')) {
        const [, name, pid] = line.split(':');
        log(`WMI watcher killed: ${name} (PID ${pid})`);
        if (onKill) onKill(name);
      } else if (line === 'WATCHER_READY') {
        log('WMI watcher ready');
      } else if (line.startsWith('WATCHER_ERROR')) {
        log(`WMI error: ${line}`);
      }
    });
  });

  proc.stderr.on('data', data => {
    log(`WMI stderr: ${data.toString().trim()}`);
  });

  proc.on('exit', code => {
    log(`WMI watcher exited (code ${code})`);
  });

  return proc;
}

// ─── SESSION TIMER ────────────────────────────────────────────────────────────

function waitForExpiry(session, watcherProc) {
  const remaining = getRemainingSeconds(session.endTime);
  log(`Session will expire in ${remaining}s`);

  setTimeout(() => {
    log('Session expired — cleaning up');

    // Kill watcher
    try { watcherProc.kill(); } catch {}

    // Remove registry block
    removeRegistryBlock();

    // Clear session
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

  // 1. Kill any already-running instances of blocked apps
  session.apps.forEach(app => {
    try {
      execSync(`taskkill /f /im "${app.processName}.exe" 2>nul`, { timeout: 3000 });
      log(`Killed existing: ${app.processName}`);
    } catch {}
  });

  // 2. Add registry block (prevents normal launch)
  addRegistryBlock(session.apps);

  // 3. Start WMI watcher (event-based kill for bypass attempts)
  const watcher = startWmiWatcher(session.apps, (name) => {
    log(`Bypass attempt blocked: ${name}`);
  });

  // 4. Set timer to clean up when session expires
  waitForExpiry(session, watcher);
}

runDaemon();
