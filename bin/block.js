#!/usr/bin/env node
// bin/block.js
// Main CLI entry point

process.env.FORCE_COLOR = '1';

const https = require('https');
const { program } = require('commander');
const { startBlock } = require('../src/block');
const { loadSession } = require('../src/session');
const { printHelp, printError, printStatus, logo, C } = require('../src/ui');

// === UPDATE CHECKER ===
const currentVersion = require('../package.json').version;

function checkForUpdates() {
  const options = {
    hostname: 'raw.githubusercontent.com',
    path: '/kyiotaro/BlockCLI/main/package.json',
    timeout: 3000,
    headers: { 'User-Agent': 'BlockCLI' }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).version;
        if (latest && latest !== currentVersion) {
          console.log('');
          console.log(C.yellow(`  ↑  Update available: v${currentVersion} → v${latest}`));
          console.log(C.dim('     Run: block update'));
          console.log('');
        }
      } catch { /* silent */ }
    });
  }).on('error', () => { /* silent - no internet, skip */ });
}

checkForUpdates();

program
  .name('block')
  .version(currentVersion)
  .description('Block distracting apps while you study.')
  .helpOption(false)
  .allowUnknownOption(true);

// === COMMAND: block status ===
program
  .command('status')
  .description('Show current block session status')
  .action(() => {
    const session = loadSession();
    if (!session) {
      logo();
      console.log(C.green("  ✓  No active session. You're free.\n"));
    } else {
      printStatus(session);
    }
  });

// === COMMAND: block list ===
program
  .command('list')
  .description('List blocked apps in current session')
  .action(() => {
    const session = loadSession();
    if (!session) {
      console.log('');
      console.log(C.dim('  No active session.'));
      console.log('');
    } else {
      console.log('');
      console.log(C.cyan.bold('  Currently blocking:'));
      session.apps.forEach(app => {
        console.log(`    ${C.red('▶')} ${C.white(app.displayName)} ${C.dim('→ ' + app.processName)}`);
      });
      console.log('');
    }
  });

// === COMMAND: block update ===
program
  .command('update')
  .description('Update BlockCLI to the latest version')
  .action(() => {
    const { execSync } = require('child_process');
    console.log('');
    console.log(C.cyan('  Updating BlockCLI...'));
    console.log('');
    try {
      execSync('npm install -g kyiotaro/BlockCLI', { stdio: 'inherit' });
      console.log('');
      console.log(C.green('  ✓  BlockCLI updated successfully!'));
      console.log('');
    } catch {
      printError('Update failed. Try running manually:\n\n  npm install -g kyiotaro/BlockCLI');
    }
  });

// === COMMAND: block help ===
program
  .command('help')
  .description('Show help')
  .action(() => printHelp());

program
  .command('*', { isDefault: true, hidden: true })
  .allowUnknownOption(true)
  .action(() => {});

program.parse(process.argv);

const args = process.argv.slice(2);
const knownCommands = ['status', 'list', 'help', 'update', '--version', '-V', '--help', '-h'];

if (args.length === 0) {
  printHelp();
} else if (!knownCommands.includes(args[0])) {
  if (args.length < 2) {
    printError(
      `Missing duration.\n\n` +
      `  Usage: ${C.white('block')} ${C.yellow('<app>')} ${C.green('<duration>')}\n` +
      `  Example: ${C.white('block roblox')} ${C.green('1.30.00')}`
    );
    process.exit(1);
  }

  const appQuery = args[0];
  const timeStr = args[1];

  startBlock(appQuery, timeStr).catch(err => {
    printError('Unexpected error: ' + err.message);
    process.exit(1);
  });
}
