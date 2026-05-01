// src/scanner.js
// Scan for installed & running apps on Windows

const { execSync } = require('child_process');

/**
 * Get list of currently running processes on Windows
 * Returns array of { name, pid, exe }
 */
function getRunningProcesses() {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-Process | Select-Object Name, Id, @{N=\'Exe\';E={$_.MainModule.FileName}} | ConvertTo-Json -Compress" 2>nul',
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
  } catch (e) {
    // Fallback: tasklist
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
 * Get installed applications from Windows registry & Start Menu
 * Returns array of { name, exe, source }
 */
function getInstalledApps() {
  const apps = [];

  // Registry paths for installed apps
  const regPaths = [
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  ];

  try {
    const query = regPaths.map(p =>
      `Get-ItemProperty '${p}' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayIcon`
    ).join('; ');

    const output = execSync(
      `powershell -NoProfile -Command "& { ${query} } | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const items = JSON.parse(output);
    const arr = Array.isArray(items) ? items : [items];
    arr.forEach(item => {
      if (item?.DisplayName) {
        apps.push({
          name: item.DisplayName,
          exe: item.DisplayIcon ? item.DisplayIcon.split(',')[0].replace(/"/g, '') : '',
          source: 'registry'
        });
      }
    });
  } catch (e) {
    // Silent fail - registry scan is optional
  }

  return apps;
}

/**
 * Build combined app list with fuzzy matching support
 * Returns array of display names for autocomplete
 */
function buildAppList() {
  const running = getRunningProcesses();
  const installed = getInstalledApps();

  const seen = new Set();
  const combined = [];

  // Add running processes first (most relevant)
  running.forEach(p => {
    const key = p.name.toLowerCase();
    if (!seen.has(key) && p.name.length > 1) {
      seen.add(key);
      combined.push({
        displayName: p.name,
        processName: p.name,
        source: 'running',
        isRunning: true
      });
    }
  });

  // Add installed apps
  installed.forEach(app => {
    const key = app.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      combined.push({
        displayName: app.name,
        processName: guessProcessName(app.name, app.exe),
        source: 'installed',
        isRunning: false
      });
    }
  });

  return combined.sort((a, b) => {
    // Running apps first
    if (a.isRunning && !b.isRunning) return -1;
    if (!a.isRunning && b.isRunning) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Guess process name from app display name or exe path
 */
function guessProcessName(displayName, exePath) {
  if (exePath) {
    const exeFile = exePath.split('\\').pop().split('/').pop();
    return exeFile.replace('.exe', '').replace('.lnk', '');
  }
  // Common known mappings
  const knownMappings = {
    'roblox': 'RobloxPlayerBeta',
    'discord': 'Discord',
    'youtube': 'chrome',
    'spotify': 'Spotify',
    'steam': 'steam',
    'epic games': 'EpicGamesLauncher',
    'minecraft': 'javaw',
    'valorant': 'VALORANT',
    'league of legends': 'LeagueClient',
    'tiktok': 'TikTok',
    'instagram': 'Instagram',
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
 * Find running processes matching a target name
 * Returns array of PIDs to kill
 */
function findProcessPids(targetName) {
  try {
    const out = execSync(
      `tasklist /fi "IMAGENAME eq ${targetName}.exe" /fo csv /nh 2>nul`,
      { encoding: 'utf8', timeout: 3000 }
    );
    const pids = [];
    out.trim().split('\n').forEach(line => {
      const parts = line.replace(/"/g, '').split(',');
      if (parts[0]?.toLowerCase().includes(targetName.toLowerCase())) {
        const pid = parseInt(parts[1]);
        if (pid > 0) pids.push(pid);
      }
    });
    return pids;
  } catch {
    return [];
  }
}

/**
 * Kill all processes matching the name
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
  findProcessPids,
  killProcess
};
