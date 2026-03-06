// background.js — Service worker
// Receives tips from content.js and sends commands to Lovense Remote via the local API

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

// Find the standard mapping rule matching a token amount
function findRule(tokens, mapping) {
  for (const rule of mapping) {
    if (tokens >= rule.minTokens && tokens <= rule.maxTokens) return rule;
  }
  return mapping[mapping.length - 1];
}

// Find a special command matching an exact token amount
function findSpecial(tokens, specialCommands) {
  return specialCommands.find(s => s.tokens === tokens) || null;
}

// Build the Lovense action string based on pattern and strength
function buildAction(pattern, strength) {
  const patternMap = {
    'Vibrate':    `Vibrate:${strength},Rotate:${strength}`,
    'Rotate':     `Rotate:${strength}`,
    'Pulse':      `Vibrate:${strength};Pulse`,
    'Wave':       `Vibrate:${strength};Wave`,
    'Fireworks':  `Vibrate:${strength};Fireworks`,
    'Earthquake': `Vibrate:${strength};Earthquake`,
  };
  return patternMap[pattern] || `Vibrate:${strength},Rotate:${strength}`;
}

// Send a vibration command to Lovense Remote (Game Mode local API)
async function sendLovenseCommand(ip, port, { pattern, strength, durationSec }) {
  const url = `http://${ip}:${port}/command`;
  const action = buildAction(pattern, strength);
  const body = { command: "Function", action, timeSec: durationSec, toy: "", apiVer: 1 };

  console.log('[Lovense Bridge] Sending command →', body);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    console.log('[Lovense Bridge] Response:', data);
    return data;
  } catch (err) {
    console.error('[Lovense Bridge] Command error:', err);
    return null;
  }
}

// Send an explicit stop to Lovense to clear any residual vibration
async function sendLovenseStop(ip, port) {
  const url = `http://${ip}:${port}/command`;
  const body = { command: "Function", action: "Vibrate:0,Rotate:0", timeSec: 0, toy: "", apiVer: 1 };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('[Lovense Bridge] Stop sent');
  } catch (err) {
    console.error('[Lovense Bridge] Stop error:', err);
  }
}

// Listen for tip messages from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TIP') {
    const tokens = message.tokens;

    getConfig().then(async (config) => {
      let pattern, strength, duration;

      // Special command takes priority over standard mapping
      const special = findSpecial(tokens, config.specialCommands);

      if (special) {
        pattern = special.pattern;

        // Random strength if a range is defined
        if (special.strengthMin !== undefined && special.strengthMax !== undefined && special.strengthMin !== special.strengthMax) {
          strength = Math.floor(Math.random() * (special.strengthMax - special.strengthMin + 1)) + special.strengthMin;
        } else {
          strength = special.strengthMax || 20;
        }

        // Random duration if enabled
        if (special.randomDuration && special.durationMin !== undefined && special.durationMax !== undefined) {
          duration = Math.floor(Math.random() * (special.durationMax - special.durationMin + 1)) + special.durationMin;
        } else {
          duration = special.duration;
        }

        console.log(`[Lovense Bridge] Special command: ${tokens} tokens → ${pattern} strength ${strength} for ${duration / 1000}s`);
      } else {
        // Standard mapping
        const rule = findRule(tokens, config.mapping);
        pattern = 'Vibrate';
        strength = rule.strength;
        duration = rule.duration;
      }

      const durationSec = Math.round(duration / 1000);
      const endsAt = Date.now() + duration;

      // Write active tip to storage so the popup can display it
      chrome.storage.local.set({
        activeTip: { tokens, strength, duration: durationSec, pattern, endsAt }
      });

      await sendLovenseCommand(config.ip, config.port, { pattern, strength, durationSec });

      // Clear active tip and send stop after duration ends
      setTimeout(() => {
        chrome.storage.local.set({ activeTip: null });
        getConfig().then(cfg => sendLovenseStop(cfg.ip, cfg.port));
      }, duration);

      sendResponse({ duration });
    });

    return true; // Keep message channel open for async response
  }
});