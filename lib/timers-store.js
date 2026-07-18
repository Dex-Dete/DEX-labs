// Timers/alarms subsystem storage. Deliberately SERVER-authoritative
// (not just a browser countdown with setTimeout) - timers live in
// data/timers.json and the server itself tracks expiry with its own
// interval loop. This matters because the whole point of "beep loudly
// through the system" is that it happens on the machine running the
// server even if nobody currently has the browser page open.
//
// Kept fully separate from Lesson Tracker/AirDrop - its own file, own
// data file, own everything - per the "don't integrate subsystems"
// requirement.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'timers.json');

const MAX_ACTIVE_TIMERS = 10;
// While a timer is "ringing" (expired but not yet dismissed), re-beep on
// this interval so it stays loud/annoying until someone deals with it,
// rather than beeping once and going silent.
const RING_REPEAT_MS = 4000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ timers: [] }, null, 2));

let writeQueue = Promise.resolve();

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { timers: [] };
  }
}

function write(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function update(mutator) {
  writeQueue = writeQueue.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeQueue;
}

function genId() {
  return `timer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Loudly beeps the SERVER machine's speakers. Windows-only, no extra
// npm dependencies - same "no extra dependencies" philosophy as the
// rest of this project. On any other platform this just logs instead
// of throwing, so the app never crashes over a missing beep capability.
//
// v1.1.1: this USED to call PowerShell's built-in [console]::beep(),
// which drives the low-level Win32 Beep() API. The user reported the
// alarm going silent when their PC's default audio output was a
// Bluetooth speaker/headset - Beep() is a legacy API that on many
// systems is only guaranteed to reach the motherboard's own PC speaker
// (or gets silently dropped when there isn't one), and does NOT
// reliably route through the normal Windows audio mixer/output-device
// selection the way real playback does. So it can be completely
// inaudible on a Bluetooth (or even some USB) output device while
// working fine on built-in speakers - the exact bug reported.
//
// Fixed by generating a short tone as an actual in-memory WAV and
// playing it with .NET's System.Media.SoundPlayer, which goes through
// the normal multimedia audio stack and therefore the currently
// selected default playback device - Bluetooth included. Still zero
// extra dependencies (System.Media/System.IO are built into .NET, no
// npm audio package). Falls back to the old [console]::beep() inside
// the same PowerShell script if SoundPlayer ever throws (e.g. no audio
// device at all), so this never regresses to total silence.
//
// v1.1.2: user reported the alarm was too quiet. The WAV samples were
// scaled to +/-12000 out of a possible +/-32767 for 16-bit PCM (~37%
// of full scale) - turned up to +/-32000 (~98% of full scale, just
// shy of clipping at 32767) for a much louder tone, and the beep
// duration was bumped from 350ms to 500ms so it's harder to miss.
function ringServerBeep() {
  if (process.platform !== 'win32') {
    console.log('[timers] (alarm would beep here - server beep is Windows-only, this platform is ' + process.platform + ')');
    return;
  }
  try {
    const script = [
      "$ErrorActionPreference = 'Stop';",
      '$rate = 44100; $freq = 1500; $durMs = 500; $gapMs = 120; $reps = 4;',
      'try {',
      '  $samples = [int]($rate * $durMs / 1000);',
      '  $dataLen = $samples * 2;',
      '  $ms = New-Object System.IO.MemoryStream;',
      '  $bw = New-Object System.IO.BinaryWriter($ms);',
      "  $bw.Write([Text.Encoding]::ASCII.GetBytes('RIFF'));",
      '  $bw.Write([int](36 + $dataLen));',
      "  $bw.Write([Text.Encoding]::ASCII.GetBytes('WAVE'));",
      "  $bw.Write([Text.Encoding]::ASCII.GetBytes('fmt '));",
      '  $bw.Write([int]16);',
      '  $bw.Write([int16]1);',
      '  $bw.Write([int16]1);',
      '  $bw.Write([int]$rate);',
      '  $bw.Write([int]($rate * 2));',
      '  $bw.Write([int16]2);',
      '  $bw.Write([int16]16);',
      "  $bw.Write([Text.Encoding]::ASCII.GetBytes('data'));",
      '  $bw.Write([int]$dataLen);',
      '  for ($i = 0; $i -lt $samples; $i++) {',
      '    $t = $i / $rate;',
      '    $env = [Math]::Min(1.0, [Math]::Min($i, $samples - $i) / ($rate * 0.01));', // quick fade in/out to avoid clicks
      '    $v = [Math]::Sin(2 * [Math]::PI * $freq * $t) * $env;',
      '    $bw.Write([int16]($v * 32000));',
      '  }',
      '  $bw.Flush();',
      '  $wavBytes = $ms.ToArray();',
      '  for ($r = 0; $r -lt $reps; $r++) {',
      '    $playStream = New-Object System.IO.MemoryStream(, $wavBytes);',
      '    $player = New-Object System.Media.SoundPlayer($playStream);',
      '    $player.PlaySync();',
      '    Start-Sleep -Milliseconds $gapMs;',
      '  }',
      '} catch {',
      // Fallback: better an old-style beep than total silence.
      '  for ($i = 0; $i -lt $reps; $i++) { [console]::beep($freq, $durMs); Start-Sleep -Milliseconds $gapMs }',
      '}',
    ].join(' ');
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true });
    p.on('error', (e) => console.error('[timers] server beep failed to launch:', e.message));
  } catch (e) {
    console.error('[timers] server beep failed:', e.message);
  }
}

async function listAll() {
  const data = read();
  return data.timers;
}

async function countActive() {
  const data = read();
  return data.timers.filter((t) => t.status === 'running' || t.status === 'ringing').length;
}

async function create(entry) {
  return update((data) => {
    data.timers.push(entry);
    return entry;
  });
}

async function dismiss(id) {
  return update((data) => {
    const t = data.timers.find((x) => x.id === id);
    if (t) t.status = 'dismissed';
    return t || null;
  });
}

async function remove(id) {
  return update((data) => {
    data.timers = data.timers.filter((x) => x.id !== id);
  });
}

// Called once a second by server.js. Flips any expired "running" timer
// to "ringing" (triggering an immediate beep), and re-beeps any timer
// that's still ringing every RING_REPEAT_MS so the alarm doesn't go
// silent after one beep. Also drops old dismissed timers after a while
// so the list doesn't grow forever.
let lastRepeatBeepAt = 0;
async function tick() {
  const now = Date.now();
  let shouldBeep = false;

  await update((data) => {
    for (const t of data.timers) {
      if (t.status === 'running' && t.expiresAt <= now) {
        t.status = 'ringing';
        t.ringingSince = now;
        shouldBeep = true;
      }
    }
    // Drop dismissed timers older than 1 hour - just tidy-up, not a
    // meaningful limit on anything.
    data.timers = data.timers.filter((t) => !(t.status === 'dismissed' && (now - (t.dismissedAt || 0)) > 60 * 60 * 1000));
  });

  const data = read();
  const anyRinging = data.timers.some((t) => t.status === 'ringing');
  if (anyRinging && (shouldBeep || now - lastRepeatBeepAt >= RING_REPEAT_MS)) {
    ringServerBeep();
    lastRepeatBeepAt = now;
  }
}

module.exports = {
  MAX_ACTIVE_TIMERS,
  genId,
  listAll,
  countActive,
  create,
  dismiss,
  remove,
  tick,
};
