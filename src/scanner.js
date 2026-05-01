// src/scanner.js
// Scan for installed & running apps on Windows

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Get list of currently running processes with their exe paths
 */
function getRunningProcesses() {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-Process | Select-Object Name, Id, @{N=\'Exe\';E={try{$_.MainModule.FileName}catch{\'\'}} } | ConvertTo-Json -Compress" 2>nul',
      { encoding: 'utf8', timeout: 8000 }
    );
    const processes = JSON.parse(output);
    const arr = Array.isArray(processes) ? processes : [processes];
    return arr
      .filter(p => p && p.Name)
      .map(p => ({
        name: p.Name,
        pid: p.Id,
        exe: p.Exe || ''
      }));
  } catch {
    try {
      const out = execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 5000 });
      return out.trim().split('\n').map(line => {
        const parts = line.replace(/"/g, '').split(',');
        return { name: parts[0]?.replace('.exe', '') || '', pid: parseInt(parts[1]) || 0, exe: '' };
      }).filter(p => p.name);
    } catch {
      return [];
    }
  }
}

/**
 * Get installed apps from registry with their exe paths
 */
function getInstalledApps() {
  const apps = [];
  const regPaths = [
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  ];

  try {
    const query = regPaths.map(p =>
      `Get-ItemProperty '${p}' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayIcon, InstallLocation`
    ).join('; ');

    const output = execSync(
      `powershell -NoProfile -Command "& { ${query} } | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const items = JSON.parse(output);
    const arr = Array.isArray(items) ? items : [items];
    arr.forEach(item => {
      if (item?.DisplayName) {
        const exePath = item.DisplayIcon ? item.DisplayIcon.split(',')[0].replace(/"/g, '').trim() : '';
        apps.push({
          name: item.DisplayName,
          exe: exePath.endsWith('.exe') ? exePath : '',
          installLocation: item.InstallLocation || '',
          source: 'registry'
        });
      }
    });
  } catch {
    // Silent fail
  }

  return apps;
}

/**
 * Find the actual .exe path for a process name on disk
 * Searches common install locations
 */
function findExePath(processName) {
  // First: check running processes (most reliable)
  try {
    const output = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path" 2>nul`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (output && fs.existsSync(output)) return output;
  } catch {}

  // Second: WMIC query
  try {
    const out = execSync(
      `wmic process where "name='${processName}.exe'" get ExecutablePath /value 2>nul`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const match = out.match(/ExecutablePath=(.+)/);
    if (match && match[1].trim() && fs.existsSync(match[1].trim())) {
      return match[1].trim();
    }
  } catch {}

  // Third: search common install directories
  const searchDirs = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
  ].filter(Boolean);

  for (const dir of searchDirs) {
    try {
      const result = searchForExe(dir, processName + '.exe', 3);
      if (result) return result;
    } catch {}
  }

  return null;
}

/**
 * Recursively search for an exe file up to maxDepth levels deep
 */
function searchForExe(dir, exeName, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase()) {
        return path.join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = searchForExe(path.join(dir, entry.name), exeName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

/**
 * Rename exe to .blocked — prevents app from launching at all
 */
function blockExe(exePath) {
  const blockedPath = exePath + '.blocked';
  try {
    fs.renameSync(exePath, blockedPath);
    return { success: true, blockedPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Restore .blocked back to .exe
 */
function unblockExe(blockedPath) {
  const exePath = blockedPath.replace(/\.blocked$/, '');
  try {
    if (fs.existsSync(blockedPath)) {
      fs.renameSync(blockedPath, exePath);
      return { success: true, exePath };
    }
    return { success: false, error: 'Blocked file not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Build combined app list for autocomplete
 */
function buildAppList() {
  const running = getRunningProcesses();
  const installed = getInstalledApps();

  const seen = new Set();
  const combined = [];

  running.forEach(p => {
    const key = p.name.toLowerCase();
    if (!seen.has(key) && p.name.length > 1) {
      seen.add(key);
      combined.push({
        displayName: p.name,
        processName: p.name,
        exePath: p.exe || null,
        source: 'running',
        isRunning: true
      });
    }
  });

  installed.forEach(app => {
    const key = app.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      combined.push({
        displayName: app.name,
        processName: guessProcessName(app.name, app.exe),
        exePath: app.exe || null,
        source: 'installed',
        isRunning: false
      });
    }
  });

  return combined.sort((a, b) => {
    if (a.isRunning && !b.isRunning) return -1;
    if (!a.isRunning && b.isRunning) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Guess process name from display name or exe path
 */
function guessProcessName(displayName, exePath) {
  if (exePath && exePath.endsWith('.exe')) {
    return path.basename(exePath, '.exe');
  }
  const knownMappings = {
    'roblox': 'RobloxPlayerBeta',
    'discord': 'Discord',
    'spotify': 'Spotify',
    'steam': 'steam',
    'epic games': 'EpicGamesLauncher',
    'minecraft': 'javaw',
    'valorant': 'VALORANT',
    'league of legends': 'LeagueClient',
    'tiktok': 'TikTok',
    'whatsapp': 'WhatsApp',
    'telegram': 'Telegram',
  };
  const lower = displayName.toLowerCase();
  for (const [key, val] of Object.entries(knownMappings)) {
    if (lower.includes(key)) return val;
  }
  return displayName.split(' ')[0];
}

/**
 * Kill all running instances of a process
 */
function killProcess(processName) {
  try {
    execSync(`taskkill /f /im "${processName}.exe" 2>nul`, { timeout: 3000 });
    return true;
  } catch {
    try {
      execSync(`taskkill /f /im "${processName}" 2>nul`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  getRunningProcesses,
  getInstalledApps,
  buildAppList,
  guessProcessName,
  findExePath,
  blockExe,
  unblockExe,
  killProcess
};
