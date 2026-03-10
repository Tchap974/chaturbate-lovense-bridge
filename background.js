// background.js — Service worker
// Owns the tip queue. Reads from storage, processes one tip at a time.
// Tips are written to storage by content.js — this avoids unreliable
// sendMessage callbacks that cause tips to be silently dropped in MV3.

const DEFAULT_MAPPING = [
  { minTokens: 1,   maxTokens: 9,   strength: 5,  duration: 3000  },
  { minTokens: 10,  maxTokens: 24,  strength: 10, duration: 5000  },
  { minTokens: 25,  maxTokens: 49,  strength: 15, duration: 7000  },
  { minTokens: 50,  maxTokens: 99,  strength: 18, duration: 10000 },
  { minTokens: 100, maxTokens: Infinity, strength: 20, duration: 15000 }
];

const DEFAULT_SPECIAL = [
  { tokens: 2222, pattern: 'Earthquake', duration: 222000, strengthMin: 20, strengthMax: 20 },
  { tokens: 888,  pattern: 'Fireworks',  duration: 77000,  strengthMin: 20, strengthMax: 20 },
  { tokens: 444,  pattern: 'Pulse',      duration: 66000,  strengthMin: 20, strengthMax: 20 },
  { tokens: 322,  pattern: 'Vibrate',    duration: 30000,  strengthMin: 14, strengthMax: 20 },
  { tokens: 222,  pattern: 'Vibrate',    duration: 15000,  strengthMin: 20, strengthMax: 20, randomDuration: true, durationMin: 15000, durationMax: 99000 },
  { tokens: 111,  pattern: 'Wave',       duration: 30000,  strengthMin: 20, strengthMax: 20 },
];

const PRESET_PATTERNS = ['Pulse', 'Wave', 'Fireworks', 'Earthquake'];

let isProcessing = false;

// Retrieve config from Chrome storage
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lovenseIP', 'lovensePort', 'mapping', 'specialCommands'], (result) => {
      resolve({
        ip: result.lovenseIP || '192.168.1.1',
        port: result.lovensePort || '20010',
        mapping: result.mapping || DEFAULT_MAPPING,
        specialCommands: result.specialCommands || DEFAULT_SPECIAL
      });
    });
  });
}

// Find the standard mapping rule for a token amount
function findRule(tokens, mapping) {
  for (const rule of mapping) {
    if (tokens >= rule.minTokens && tokens <= rule.maxTokens) return rule;
  }
  return mapping[mapping.length - 1];
}

// Find a special command for an exact token amount
function findSpecial(tokens, specialCommands) {
  return specialCommands.find(s => s.tokens === tokens) || null;
}

// Helper: POST JSON
async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

// Send a command with one automatic retry on failure
async function postWithRetry(url, body, label) {
  const attempt = async () => {
    const data = await postJSON(url, body);
    if (data.code !== 200 && data.result !== true) throw new Error(`code ${data.code}`);
    return data;
  };
  try {
    return await attempt();
  } catch (err) {
    console.warn(`[Lovense Bridge] ${label} failed (${err.message}), retrying in 500ms…`);
    await new Promise(r => setTimeout(r, 500));
    try { return await attempt(); }
    catch (err2) { console.error(`[Lovense Bridge] ${label} retry failed:`, err2); return null; }
  }
}

// Send a vibration command to Lovense Remote
async function sendLovenseCommand(ip, port, { pattern, strength, durationSec }) {
  const url = `http://${ip}:${port}/command`;
  if (PRESET_PATTERNS.includes(pattern)) {
    // Rotate first, then Preset 100ms later — required order for Ridge
    const rotateBody = { command: "Function", action: `Rotate:${strength}`, timeSec: durationSec, toy: "", apiVer: 1 };
    const presetBody = { command: "Preset", name: pattern.toLowerCase(), timeSec: durationSec, toy: "", apiVer: 1 };
    await postWithRetry(url, rotateBody, `Rotate:${strength}`);
    await new Promise(r => setTimeout(r, 100));
    return postWithRetry(url, presetBody, `Preset:${pattern}`);
  } else {
    const body = { command: "Function", action: `Vibrate:${strength},Rotate:${strength}`, timeSec: durationSec, toy: "", apiVer: 1 };
    return postWithRetry(url, body, `Vibrate+Rotate:${strength}`);
  }
}

// Send explicit stop to clear residual vibration
async function sendLovenseStop(ip, port) {
  const url = `http://${ip}:${port}/command`;
  try {
    await postJSON(url, { command: "Function", action: "Vibrate:0,Rotate:0", timeSec: 0, toy: "", apiVer: 1 });
    console.log('[Lovense Bridge] Stop sent');
  } catch (err) {
    console.error('[Lovense Bridge] Stop error:', err);
  }
}

// Process the next tip in the queue
async function processNextTip() {
  if (isProcessing) return;

  const state = await new Promise(resolve =>
    chrome.storage.local.get(['tipQueue', 'paused', 'lovenseIP', 'lovensePort'], resolve)
  );

  if (state.paused) { console.log('[Lovense Bridge] Paused, skipping'); return; }

  const queue = state.tipQueue || [];
  if (queue.length === 0) { console.log('[Lovense Bridge] Queue empty'); return; }

  isProcessing = true;
  const tokens = queue.shift();

  // Write updated queue back immediately
  await new Promise(resolve => chrome.storage.local.set({ tipQueue: queue, queueLength: queue.length }, resolve));

  console.log(`[Lovense Bridge] Processing tip: ${tokens} tokens. Remaining: ${queue.length}`);

  const config = await getConfig();
  let pattern, strength, duration;

  const special = findSpecial(tokens, config.specialCommands);
  if (special) {
    pattern = special.pattern;
    strength = (special.strengthMin !== special.strengthMax)
      ? Math.floor(Math.random() * (special.strengthMax - special.strengthMin + 1)) + special.strengthMin
      : special.strengthMax || 20;
    duration = (special.randomDuration && special.durationMin !== special.durationMax)
      ? Math.floor(Math.random() * (special.durationMax - special.durationMin + 1)) + special.durationMin
      : special.duration;
    console.log(`[Lovense Bridge] Special: ${tokens} → ${pattern} strength ${strength} for ${duration/1000}s`);
  } else {
    const rule = findRule(tokens, config.mapping);
    pattern = 'Vibrate';
    strength = rule.strength;
    duration = rule.duration;
  }

  const durationSec = Math.round(duration / 1000);
  const endsAt = Date.now() + duration;

  chrome.storage.local.set({ activeTip: { tokens, strength, duration: durationSec, pattern, endsAt } });

  await sendLovenseCommand(config.ip, config.port, { pattern, strength, durationSec });

  // Wait for the vibration to finish, then process the next tip
  await new Promise(resolve => setTimeout(resolve, duration));

  chrome.storage.local.set({ activeTip: null });
  await sendLovenseStop(config.ip, config.port);

  isProcessing = false;
  console.log(`[Lovense Bridge] Tip done. Processing next…`);

  // Process next tip if any
  processNextTip();
}

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ alive: true });
    return;
  }
  if (message.type === 'TIP_QUEUED' || message.type === 'RESUME') {
    processNextTip();
    sendResponse({ ok: true });
    return;
  }
});

// Also trigger processing when storage changes (fallback if sendMessage is missed)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tipQueue) {
    const newQueue = changes.tipQueue.newValue || [];
    if (newQueue.length > 0 && !isProcessing) {
      chrome.storage.local.get(['paused'], (r) => {
        if (!r.paused) processNextTip();
      });
    }
  }
});