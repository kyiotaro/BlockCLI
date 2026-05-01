# BlockCLI

> Block distracting apps while you study. No escape until the timer runs out.

A terminal-based app blocker for Windows. Once you start a session, there is **no way to stop it early** — by design.

---

## Requirements

- Windows 10 / 11
- [Node.js](https://nodejs.org) v16 or newer

---

## Install

```bash
npm install -g kyiotaro/BlockCLI
```

Then try it out:
```bash
block help
```

---

## Usage

```bash
block <app-name> <duration>
```

### Duration format

| Input | Meaning |
|-------|---------|
| `1.20.00` | 1 hour 20 minutes |
| `30.00` | 30 minutes |
| `45` | 45 seconds |
| `1h30m` | 1 hour 30 minutes |
| `45m` | 45 minutes |

### Examples

```bash
# Block Roblox for 1 hour 20 minutes
block roblox 1.20.00

# Block Discord for 45 minutes
block discord 45.00

# Block Spotify for 2 hours
block spotify 2.00.00

# Check remaining time in active session
block status

# See what apps are being blocked
block list
```

---

## How it works

1. You run `block roblox 1.20.00`
2. BlockCLI scans all installed and running apps, then shows a selection list
3. You pick the app to block
4. A background daemon starts and kills the app every 2.5 seconds for the full duration
5. Once the timer runs out, the session ends automatically

**There is no `block stop` command.** Once you commit, you're committed.

---

## Permissions

For certain apps (especially games), run your terminal as **Administrator**:

- Right-click Command Prompt / PowerShell → "Run as administrator"
- Then run the `block` command as usual

---

## Notes

- Active session is saved to `C:\Users\<name>\.focusblock\session.json`
- Daemon logs are at `C:\Users\<name>\.focusblock\daemon.log`
- If you restart your PC mid-session, the daemon stops but the timer keeps counting down

---

## License

MIT © kyiotaro
