'use strict';

/**
 * Minimal leveled logger. Silent by default so the library never pollutes a
 * host application's output; enable with AGENT_OS_LOG=debug|info|warn|error.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function resolveLevel() {
  const env = (process.env.AGENT_OS_LOG || 'silent').toLowerCase();
  return LEVELS[env] != null ? LEVELS[env] : LEVELS.silent;
}

function make(level) {
  return (...args) => {
    if (LEVELS[level] >= resolveLevel()) {
      const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
      stream.write(`[agent-os:${level}] ${args.map(String).join(' ')}\n`);
    }
  };
}

module.exports = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
};
