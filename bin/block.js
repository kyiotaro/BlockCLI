#!/usr/bin/env node
// bin/block.js
// Main CLI entry point

// Compatibility shim for chalk v4 (CommonJS)
process.env.FORCE_COLOR = '1';

const { program } = require('commander');
const { startBlock } = require('../src/block');
const { loadSession } = require('../src/session');
const { printHelp, printError, printStatus, logo, C } = require('../src/ui');

program
  .name('block')
  .version('1.0.0')
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
      console.log(C.green('  ✓  No active session. You\'re free.\n'));
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

// === COMMAND: block help ===
program
  .command('help')
  .description('Show help')
  .action(() => printHelp());

// === DEFAULT: block <app> <time> ===
// Parse positional args manually if no subcommand matched
program
  .command('*', { isDefault: true, hidden: true })
  .allowUnknownOption(true)
  .action(() => {});

program.parse(process.argv);

// Handle positional: block <app> <time>
const args = process.argv.slice(2);
const knownCommands = ['status', 'list', 'help', '--version', '-V', '--help', '-h'];

if (args.length === 0) {
  printHelp();
} else if (!knownCommands.includes(args[0])) {
  // Treat as: block <app> <duration>
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
