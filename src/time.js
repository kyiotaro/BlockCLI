// src/time.js
// Parse time formats like "1.20.00" -> seconds

/**
 * Parse time string in format H.MM.SS or MM.SS or SS
 * Examples:
 *   "1.20.00" -> 4800 seconds (1h 20m 0s)
 *   "30.00"   -> 1800 seconds (30m)
 *   "45"      -> 45 seconds
 *   "1h30m"   -> 5400 seconds
 *   "45m"     -> 2700 seconds
 */
function parseTime(input) {
  if (!input) return null;

  const str = String(input).trim();

  // Format: H.MM.SS or MM.SS or SS (dot-separated)
  if (/^\d+(\.\d+){0,2}$/.test(str)) {
    const parts = str.split('.').map(Number);
    if (parts.length === 3) {
      // H.MM.SS
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      // MM.SS
      const [m, s] = parts;
      return m * 60 + s;
    } else {
      // SS
      return parts[0];
    }
  }

  // Format: 1h30m, 45m, 2h, etc.
  const humanMatch = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (humanMatch && (humanMatch[1] || humanMatch[2] || humanMatch[3])) {
    const h = parseInt(humanMatch[1] || 0);
    const m = parseInt(humanMatch[2] || 0);
    const s = parseInt(humanMatch[3] || 0);
    return h * 3600 + m * 60 + s;
  }

  return null;
}

/**
 * Format seconds into human readable string
 * 4800 -> "1h 20m 00s"
 */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  } else if (m > 0) {
    return `${m}m ${String(s).padStart(2, '0')}s`;
  } else {
    return `${s}s`;
  }
}

/**
 * Format seconds into countdown display
 * 4800 -> "01:20:00"
 */
function formatCountdown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Get end time from now + duration in seconds
 */
function getEndTime(durationSeconds) {
  return Date.now() + durationSeconds * 1000;
}

/**
 * Get remaining seconds from end time
 */
function getRemainingSeconds(endTime) {
  return Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
}

module.exports = {
  parseTime,
  formatDuration,
  formatCountdown,
  getEndTime,
  getRemainingSeconds
};
