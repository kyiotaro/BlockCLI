// src/session.js
// Manage active block sessions using a JSON file

const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_DIR = path.join(os.homedir(), '.blockcli');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Save active session to disk
 * @param {Object} session - { apps: [{displayName, processName}], endTime, startTime, duration }
 */
function saveSession(session) {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
}

/**
 * Load active session from disk
 * Returns null if no session or session expired
 */
function loadSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!data || !data.endTime) return null;
    // If expired, clean up
    if (Date.now() > data.endTime) {
      clearSession();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Delete active session file
 */
function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {
    // ignore
  }
}

/**
 * Check if a session is currently active
 */
function hasActiveSession() {
  return loadSession() !== null;
}

module.exports = {
  saveSession,
  loadSession,
  clearSession,
  hasActiveSession,
  SESSION_DIR
};
