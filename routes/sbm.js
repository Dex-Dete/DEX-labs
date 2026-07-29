// Standby Mode (SBM) support routes - v1.3.0. Two things live here:
//  - GET /api/sbm/stats: host RAM + CPU usage, for SBM's stats panel.
//    No temperature - not reliably available cross-platform without
//    extra tooling (confirmed with the user, see PROJECT_BRIEFING.md).
//  - GET /api/sbm/fact: the current hour's science fact (lib/facts-store.js).
// SBM's other data (live Study/Rec clock, events list) is deliberately
// NOT duplicated here - it reads straight from /api/study/active,
// /api/study/rec/active, and /api/events/upcoming, the same endpoints
// their owning subsystems already use, so there's exactly one source of
// truth for each and no risk of SBM's mirror drifting out of sync.
const express = require('express');
const os = require('os');
const facts = require('../lib/facts-store');

const router = express.Router();

// CPU usage % since the last time this was called (or, on cold start,
// against a fresh short sample) - the standard "sample os.cpus() twice
// and diff the tick counters" approach. This works cross-platform
// including Windows, unlike os.loadavg() (which Windows doesn't really
// support - it just returns zeros).
let lastCpuSample = os.cpus();
let lastCpuSampleAt = Date.now();

function cpuTotals(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const key in cpu.times) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function sampleCpuPercent() {
  const now = os.cpus();
  const before = cpuTotals(lastCpuSample);
  const after = cpuTotals(now);
  lastCpuSample = now;
  lastCpuSampleAt = Date.now();

  const idleDelta = after.idle - before.idle;
  const totalDelta = after.total - before.total;
  if (totalDelta <= 0) return 0;
  const usedPct = 100 * (1 - idleDelta / totalDelta);
  return Math.max(0, Math.min(100, Math.round(usedPct * 10) / 10));
}

router.get('/stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  res.json({
    ram: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      usedPercent: Math.round((usedMem / totalMem) * 1000) / 10,
    },
    cpu: {
      usedPercent: sampleCpuPercent(),
      cores: os.cpus().length,
    },
  });
});

router.get('/fact', async (req, res) => {
  try {
    const fact = await facts.getCurrentFact();
    res.json(fact);
  } catch (e) {
    res.status(500).json({ error: 'Could not load a fact right now.' });
  }
});

module.exports = router;
