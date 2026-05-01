// src/daemon.js
// Background blocker daemon - spawned as a detached process
// Runs independently, kills blocked apps every few seconds until timer expires

const { loadSession, clearSession } = require('./session');
const { killProcess } = require('./scanner');
const { getRemainingSeconds } = require('./time');

const CHECK_INTERVAL_MS = 2500; // Check every 2.5 seconds

function log(msg) {
  const ts = new Date().toISOString();
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const logFile = path.join(os.homedir(), '.focusblock', 'daemon.log');
    fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);
  } catch {
    // ignore log errors
  }
}

function runDaemon() {
  log('Daemon started');

  const tick = () => {
    const session = loadSession();

    if (!session) {
      log('No active session, daemon exiting');
      process.exit(0);
    }

    const remaining = getRemainingSeconds(session.endTime);

    if (remaining <= 0) {
      log('Session expired, daemon exiting');
      clearSession();
      process.exit(0);
    }

    // Kill all blocked apps
    session.apps.forEach(app => {
      const killed = killProcess(app.processName);
      if (killed) {
        log(`Killed: ${app.processName} (${app.displayName})`);
      }
    });
  };

  // Run immediately then on interval
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

runDaemon();
