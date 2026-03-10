// popup.js — Configuration UI logic

const PATTERNS = ['Vibrate', 'Pulse', 'Wave', 'Fireworks', 'Earthquake'];

const DEFAULT_MAPPING = [
  { minTokens: 1,   maxTokens: 9,   strength: 5,  duration: 3 },
  { minTokens: 10,  maxTokens: 24,  strength: 10, duration: 5 },
  { minTokens: 25,  maxTokens: 49,  strength: 15, duration: 7 },
  { minTokens: 50,  maxTokens: 99,  strength: 18, duration: 10 },
  { minTokens: 100, maxTokens: 999, strength: 20, duration: 15 }
];

const DEFAULT_SPECIAL = [
  { tokens: 2222, pattern: 'Earthquake', duration: 222,  strengthMin: 20, strengthMax: 20, randomDuration: false, durationMin: 222, durationMax: 222 },
  { tokens: 888,  pattern: 'Fireworks',  duration: 77,   strengthMin: 20, strengthMax: 20, randomDuration: false, durationMin: 77,  durationMax: 77  },
  { tokens: 444,  pattern: 'Pulse',      duration: 66,   strengthMin: 20, strengthMax: 20, randomDuration: false, durationMin: 66,  durationMax: 66  },
  { tokens: 322,  pattern: 'Vibrate',    duration: 30,   strengthMin: 14, strengthMax: 20, randomDuration: false, durationMin: 30,  durationMax: 30  },
  { tokens: 222,  pattern: 'Vibrate',    duration: 15,   strengthMin: 20, strengthMax: 20, randomDuration: true,  durationMin: 15,  durationMax: 99  },
  { tokens: 111,  pattern: 'Wave',       duration: 30,   strengthMin: 20, strengthMax: 20, randomDuration: false, durationMin: 30,  durationMax: 30  },
];

// --- Active tip display ---

function refreshActiveTip() {
  chrome.storage.local.get(['activeTip'], (result) => {
    const el = document.getElementById('tipDisplay');
    const tip = result.activeTip;

    if (!tip || !tip.endsAt) {
      el.innerHTML = '<span class="tip-idle">No active tip</span>';
      return;
    }

    const remaining = Math.max(0, Math.round((tip.endsAt - Date.now()) / 1000));
    const elapsed = tip.duration - remaining;
    const pct = Math.min(100, Math.round((elapsed / tip.duration) * 100));
    const isSpecial = tip.pattern && tip.pattern !== 'Vibrate';

    el.innerHTML = `
      <div class="tip-details">
        <div class="tip-stat"><span class="value">${tip.tokens}</span><span class="label">tokens</span></div>
        <div class="tip-separator">·</div>
        <div class="tip-stat"><span class="value">${tip.strength}</span><span class="label">strength</span></div>
        <div class="tip-separator">·</div>
        <div class="tip-stat"><span class="value">${tip.duration}s</span><span class="label">duration</span></div>
      </div>
      ${isSpecial ? `<div class="tip-pattern">✨ Pattern: ${tip.pattern}</div>` : ''}
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${remaining}s remaining</div>
    `;
  });
}

setInterval(refreshActiveTip, 1000);
refreshActiveTip();

// --- Pause button ---

function updatePauseButton(paused, queueLength) {
  const btn = document.getElementById('btnPause');
  const info = document.getElementById('queueInfo');
  btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  btn.classList.toggle('paused', paused);
  info.innerHTML = (paused && queueLength > 0)
    ? `<span>${queueLength}</span> tip${queueLength > 1 ? 's' : ''} waiting`
    : '';
}

function loadPauseState() {
  chrome.storage.local.get(['paused', 'queueLength'], (r) => updatePauseButton(!!r.paused, r.queueLength || 0));
}

document.getElementById('btnPause').addEventListener('click', () => {
  chrome.storage.local.get(['paused', 'queueLength'], (r) => {
    const newPaused = !r.paused;
    chrome.storage.local.set({ paused: newPaused }, () => {
      updatePauseButton(newPaused, r.queueLength || 0);
      // Notify content script of pause state change
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'PAUSE_STATE', paused: newPaused }, () => { void chrome.runtime.lastError; });
      });
      // If resuming, tell background to start processing
      if (!newPaused) {
        chrome.runtime.sendMessage({ type: 'RESUME' }, () => { void chrome.runtime.lastError; });
      }
    });
  });
});

// Refresh queue count every second while paused
setInterval(() => {
  chrome.storage.local.get(['paused', 'queueLength'], (r) => {
    if (r.paused) updatePauseButton(true, r.queueLength || 0);
  });
}, 1000);

// --- Special commands ---

function patternOptions(selected) {
  return PATTERNS.map(p => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
}

function renderSpecial(list) {
  const tbody = document.getElementById('specialBody');
  tbody.innerHTML = '';

  list.forEach((s, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" min="1" value="${s.tokens}" /></td>
      <td><select>${patternOptions(s.pattern)}</select></td>
      <td>
        <div class="dual-input">
          <input type="number" min="1" max="20" value="${s.strengthMin}" placeholder="min" />
          <span>–</span>
          <input type="number" min="1" max="20" value="${s.strengthMax}" placeholder="max" />
        </div>
      </td>
      <td>
        <div class="dual-input">
          <input type="number" min="1" value="${s.durationMin}" placeholder="min" />
          <span>–</span>
          <input type="number" min="1" value="${s.durationMax}" placeholder="max" />
        </div>
      </td>
      <td>
        <div class="rand-wrap">
          <input type="checkbox" ${s.randomDuration ? 'checked' : ''} title="Random duration" />
          <span>rand.</span>
        </div>
      </td>
      <td><button class="btn-remove" data-index="${index}">✕</button></td>
      <td><button class="btn-test-row" data-index="${index}" data-type="special">▶</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = readSpecialFromDOM();
      current.splice(parseInt(btn.dataset.index), 1);
      renderSpecial(current);
    });
  });

  tbody.querySelectorAll('.btn-test-row[data-type="special"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = readSpecialFromDOM();
      const s = list[parseInt(btn.dataset.index)];
      const strength = s.strengthMax;
      const duration = s.randomDuration
        ? Math.floor(Math.random() * (s.durationMax - s.durationMin + 1)) + s.durationMin
        : s.durationMin;
      testVibration({ pattern: s.pattern, strength, duration });
    });
  });
}

function readSpecialFromDOM() {
  const rows = document.querySelectorAll('#specialBody tr');
  const list = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input[type="number"], input[type="checkbox"]');
    const select = row.querySelector('select');
    const tokens      = parseInt(inputs[0].value) || 1;
    const strengthMin = parseInt(inputs[1].value) || 1;
    const strengthMax = parseInt(inputs[2].value) || 20;
    const durationMin = parseInt(inputs[3].value) || 5;
    const durationMax = parseInt(inputs[4].value) || 5;
    const randomDuration = inputs[5].checked;
    list.push({ tokens, pattern: select.value, strengthMin, strengthMax, durationMin, durationMax, duration: durationMin, randomDuration });
  });
  return list;
}

document.getElementById('btnAddSpecial').addEventListener('click', () => {
  const current = readSpecialFromDOM();
  current.push({ tokens: 100, pattern: 'Vibrate', strengthMin: 20, strengthMax: 20, durationMin: 10, durationMax: 10, duration: 10, randomDuration: false });
  renderSpecial(current);
});

// --- Standard mapping ---

function renderMapping(mapping) {
  const tbody = document.getElementById('mappingBody');
  tbody.innerHTML = '';
  mapping.forEach((rule, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" min="1" value="${rule.minTokens}" /></td>
      <td><input type="number" min="1" value="${rule.maxTokens}" /></td>
      <td><input type="number" min="1" max="20" value="${rule.strength}" /></td>
      <td><input type="number" min="1" max="600" value="${rule.duration}" /></td>
      <td><button class="btn-remove" data-index="${index}">✕</button></td>
      <td><button class="btn-test-row" data-index="${index}" data-type="mapping">▶</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = readMappingFromDOM();
      current.splice(parseInt(btn.dataset.index), 1);
      renderMapping(current);
    });
  });

  tbody.querySelectorAll('.btn-test-row[data-type="mapping"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mapping = readMappingFromDOM();
      const r = mapping[parseInt(btn.dataset.index)];
      testVibration({ pattern: 'Vibrate', strength: r.strength, duration: r.duration });
    });
  });
}

function readMappingFromDOM() {
  return Array.from(document.querySelectorAll('#mappingBody tr')).map(row => {
    const inputs = row.querySelectorAll('input');
    return {
      minTokens: parseInt(inputs[0].value) || 1,
      maxTokens: parseInt(inputs[1].value) || 999,
      strength:  parseInt(inputs[2].value) || 10,
      duration:  parseInt(inputs[3].value) || 5
    };
  });
}

document.getElementById('btnAddRow').addEventListener('click', () => {
  const current = readMappingFromDOM();
  current.push({ minTokens: 1, maxTokens: 9, strength: 10, duration: 5 });
  renderMapping(current);
});

// --- Test a specific vibration row ---

const PRESET_PATTERNS_POPUP = ['Pulse', 'Wave', 'Fireworks', 'Earthquake'];
let testActive = false;      // true while a test is running
let testTimer = null;        // setTimeout handle for auto-reset

function setAllTestButtons(disabled) {
  document.querySelectorAll('.btn-test-row').forEach(b => b.disabled = disabled);
  const stopBtn = document.getElementById('btnStopTest');
  if (stopBtn) stopBtn.classList.toggle('visible', disabled);
}

function stopTest(ip, port) {
  if (testTimer) { clearTimeout(testTimer); testTimer = null; }
  testActive = false;
  setAllTestButtons(false);
  const url = `http://${ip}:${port}/command`;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: "Function", action: "Vibrate:0,Rotate:0", timeSec: 0, toy: "", apiVer: 1 }) })
    .catch(() => {});
  showStatus('⏹ Test stopped');
}

function testVibration({ pattern, strength, duration }) {
  const ip = document.getElementById('lovenseIP').value.trim();
  const port = document.getElementById('lovensePort').value.trim();
  if (!ip || !port) { showStatus('⚠️ Please enter IP and Port first', true); return; }
  if (testActive) { showStatus('⚠️ A test is already running — stop it first', true); return; }

  const url = `http://${ip}:${port}/command`;
  const durationSec = duration;
  const postJSON = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

  testActive = true;
  setAllTestButtons(true);
  showStatus(`▶ Testing: ${pattern} strength ${strength} for ${durationSec}s…`);

  const onDone = () => {
    testActive = false;
    setAllTestButtons(false);
    testTimer = null;
    showStatus(`✅ Test finished: ${pattern}`);
  };

  const onError = (err) => {
    testActive = false;
    setAllTestButtons(false);
    testTimer = null;
    showStatus(`❌ ${err.message}`, true);
  };

  let promise;
  if (PRESET_PATTERNS_POPUP.includes(pattern)) {
    promise = postJSON({ command: "Function", action: `Rotate:${strength}`, timeSec: durationSec, toy: "", apiVer: 1 })
      .then(() => new Promise(resolve => setTimeout(resolve, 100)))
      .then(() => postJSON({ command: "Preset", name: pattern.toLowerCase(), timeSec: durationSec, toy: "", apiVer: 1 }));
  } else {
    promise = postJSON({ command: "Function", action: `Vibrate:${strength},Rotate:${strength}`, timeSec: durationSec, toy: "", apiVer: 1 });
  }

  promise
    .then(() => { testTimer = setTimeout(onDone, durationSec * 1000); })
    .catch(onError);

  // Expose stop function for the Stop button
  document._currentTestStop = () => stopTest(ip, port);
}

// --- Load config from storage ---

function loadConfig() {
  chrome.storage.local.get(['lovenseIP', 'lovensePort', 'mapping', 'specialCommands'], (result) => {
    document.getElementById('lovenseIP').value = result.lovenseIP || '';
    document.getElementById('lovensePort').value = result.lovensePort || '20010';

    const mapping = result.mapping
      ? result.mapping.map(r => ({ ...r, duration: Math.round(r.duration / 1000) }))
      : DEFAULT_MAPPING;
    renderMapping(mapping);

    const special = result.specialCommands
      ? result.specialCommands.map(s => ({
          ...s,
          durationMin: Math.round((s.durationMin || s.duration) / 1000),
          durationMax: Math.round((s.durationMax || s.duration) / 1000),
          duration: Math.round(s.duration / 1000)
        }))
      : DEFAULT_SPECIAL;
    renderSpecial(special);
  });
}

// --- Save ---

document.getElementById('btnSave').addEventListener('click', () => {
  const ip = document.getElementById('lovenseIP').value.trim();
  const port = document.getElementById('lovensePort').value.trim();
  if (!ip || !port) { showStatus('⚠️ Please enter IP and Port', true); return; }

  const mapping = readMappingFromDOM().map(r => ({ ...r, duration: r.duration * 1000 }));
  const specialCommands = readSpecialFromDOM().map(s => ({
    ...s,
    duration:    s.durationMin * 1000,
    durationMin: s.durationMin * 1000,
    durationMax: s.durationMax * 1000,
  }));

  chrome.storage.local.set({ lovenseIP: ip, lovensePort: port, mapping, specialCommands }, () => {
    showStatus('✅ Configuration saved!');
  });
});

// --- Test connection ---

document.getElementById('btnTest').addEventListener('click', () => {
  const ip = document.getElementById('lovenseIP').value.trim();
  const port = document.getElementById('lovensePort').value.trim();
  if (!ip || !port) { showStatus('⚠️ Please enter IP and Port first', true); return; }
  showStatus('⏳ Testing...');
  fetch(`http://${ip}:${port}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: "Function", action: "Vibrate:10,Rotate:10", timeSec: 2, toy: "", apiVer: 1 })
  })
    .then(r => r.json())
    .then(data => showStatus(data.result === true || data.code === 200 ? '✅ Connection OK!' : `⚠️ ${JSON.stringify(data)}`, !(data.result || data.code === 200)))
    .catch(err => showStatus(`❌ ${err.message}`, true));
});

// --- Stop test button ---
document.getElementById('btnStopTest').addEventListener('click', () => {
  if (document._currentTestStop) document._currentTestStop();
});

// --- Status helper ---

function showStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  setTimeout(() => { el.textContent = ''; }, 4000);
}

// --- Init ---
loadConfig();
loadPauseState();