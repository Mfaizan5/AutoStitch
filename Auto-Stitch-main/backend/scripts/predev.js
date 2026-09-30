const { execSync } = require('child_process');

const PORT = Number(process.env.PORT || 5000);

function normalizePids(raw) {
  if (!raw) return [];
  return [...new Set(raw
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function getWindowsPids() {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${PORT}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pids = [];
    const lines = output.split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/\s+(\d+)\s*$/);
      if (match) pids.push(Number(match[1]));
    }

    return pids;
  } catch {
    return [];
  }
}

function getUnixPids() {
  try {
    const output = execSync(`lsof -t -i TCP:${PORT} -s TCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return normalizePids(output);
  } catch {
    try {
      const output = execSync(`fuser -n tcp ${PORT} 2>/dev/null || ss -lntp '( sport = :${PORT} )' 2>/dev/null`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const pids = [];
      const pidMatches = output.matchAll(/pid=(\d+)/g);
      for (const match of pidMatches) pids.push(Number(match[1]));
      return pids;
    } catch {
      return [];
    }
  }
}

function getPidsOnPort() {
  if (process.platform === 'win32') return getWindowsPids();
  return getUnixPids();
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function main() {
  const pids = getPidsOnPort().filter((pid) => pid !== process.pid);

  if (!pids.length) {
    console.log(`Port ${PORT} is free. Starting dev server...`);
    return;
  }

  console.log(`Port ${PORT} is occupied by PID(s): ${pids.join(', ')}. Clearing stale process...`);

  let killed = 0;
  for (const pid of pids) {
    if (killPid(pid)) killed += 1;
  }

  console.log(`Cleared ${killed} stale process(es) on port ${PORT}.`);
}

main();
