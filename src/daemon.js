// src/daemon.js
// Background blocker daemon
// Strategy: rename .exe to .exe.blocked so app cannot launch at all
// Also kill any already-running instances

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadSession, clearSession, saveSession } = require('./session');
const { findExePath, blockExe, unblockExe, killProcess } = require('./scanner');
const { getRemainingSeconds } = require('./time');

const CHECK_INTERVAL_MS = 3000;
const LOG_FILE = path.join(os.homedir(), '.blockcli', 'daemon.log');

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

/**
 * Block an app:
 * 1. Kill any running instance
 * 2. Find the exe path
 * 3. Rename to .blocked
 */
function applyBlock(app) {
  // Always kill first
  killProcess(app.processName);

  // If we already have the blocked path saved, done
  if (app.blockedPath && fs.existsSync(app.blockedPath)) {
    log(`Already blocked: ${app.blockedPath}`);
    return app;
  }

  // If we have exePath saved, try to rename it
  if (app.exePath && fs.existsSync(app.exePath)) {
    const result = blockExe(app.exePath);
    if (result.success) {
      log(`Renamed to .blocked: ${app.exePath}`);
      app.blockedPath = result.blockedPath;
      app.exePath = null;
      return app;
    } else {
      log(`Failed to rename ${app.exePath}: ${result.error}`);
    }
  }

  // Try to find the exe now
  const found = findExePath(app.processName);
  if (found) {
    const result = blockExe(found);
    if (result.success) {
      log(`Found & renamed: ${found}`);
      app.blockedPath = result.blockedPath;
      app.exePath = null;
      return app;
    } else {
      log(`Found but failed to rename ${found}: ${result.error}`);
    }
  } else {
    log(`Could not find exe for: ${app.processName} — falling back to kill only`);
  }

  return app;
}

/**
 * Restore all blocked apps at end of session
 */
function restoreAll(session) {
  session.apps.forEach(app => {
    if (app.blockedPath) {
      const result = unblockExe(app.blockedPath);
      if (result.success) {
        log(`Restored: ${result.exePath}`);
      } else {
        log(`Failed to restore ${app.blockedPath}: ${result.error}`);
      }
    }
  });
}

function runDaemon() {
  log('Daemon started');
  let initialized = false;

  const tick = () => {
    const session = loadSession();

    if (!session) {
      log('No active session, daemon exiting');
      process.exit(0);
    }

    const remaining = getRemainingSeconds(session.endTime);

    if (remaining <= 0) {
      log('Session expired — restoring all apps');
      restoreAll(session);
      clearSession();
      process.exit(0);
    }

    // First tick: apply rename block to all apps
    if (!initialized) {
      initialized = true;
      let changed = false;
      session.apps = session.apps.map(app => {
        const updated = applyBlock(app);
        if (updated.blockedPath !== app.blockedPath) changed = true;
        return updated;
      });
      // Save updated paths back to session
      if (changed) saveSession(session);
    } else {
      // Subsequent ticks: just kill in case they bypassed the rename
      session.apps.forEach(app => {
        killProcess(app.processName);
      });
    }
  };

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

runDaemon();
