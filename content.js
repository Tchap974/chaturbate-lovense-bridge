// content.js — Runs on Chaturbate pages
// Detects tips and writes them to storage. The service worker reads from storage.
// This avoids the unreliable sendMessage MV3 pattern where callbacks may never fire.

(function () {
  const TIP_REGEX = /tipped\s+(\d+)\s+tokens?/i;

  // Keep-alive ping every 20s to prevent the service worker from sleeping
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'PING' }, () => { void chrome.runtime.lastError; });
  }, 20000);

  // Sync pause state from storage on startup
  let isPaused = false;
  chrome.storage.local.get(['paused'], (result) => { isPaused = !!result.paused; });

  // Listen for pause state changes sent from popup.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PAUSE_STATE') {
      isPaused = message.paused;
      console.log(`[Lovense Bridge] ${isPaused ? '⏸ Paused' : '▶ Resumed'}`);
      if (!isPaused) {
        // Notify background that pause was lifted so it can resume processing
        chrome.storage.local.get(['tipQueue'], (r) => {
          if ((r.tipQueue || []).length > 0) {
            chrome.runtime.sendMessage({ type: 'RESUME' }, () => { void chrome.runtime.lastError; });
          }
        });
      }
    }
  });

  // Find the chat container in the DOM
  function findChatContainer() {
    return document.querySelector('div.msg-list-fvm.message-list');
  }

  // Extract token count from a .roomNotice.isTip element
  function parseTipElement(el) {
    const text = el.textContent || '';
    const match = text.match(TIP_REGEX);
    return match ? parseInt(match[1], 10) : null;
  }

  // Push tips into the shared queue in storage
  // background.js owns processing — content.js only writes
  function pushTipsToQueue(tokens) {
    chrome.storage.local.get(['tipQueue'], (result) => {
      const queue = result.tipQueue || [];
      queue.push(tokens);
      chrome.storage.local.set({ tipQueue: queue, queueLength: queue.length }, () => {
        console.log(`[Lovense Bridge] Tip queued: ${tokens} tokens. Queue: ${queue.length}${isPaused ? ' (paused)' : ''}`);
        // Notify background a new tip arrived (only if not paused)
        if (!isPaused) {
          chrome.runtime.sendMessage({ type: 'TIP_QUEUED' }, () => { void chrome.runtime.lastError; });
        }
      });
    });
  }

  // Start observing the chat container for new messages
  function startObserver(container) {
    console.log('[Lovense Bridge] Chat observation started ✓');

    const observer = new MutationObserver((mutations) => {
      const collected = [];

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.dataset?.testid === 'chat-message') {
            const tipEl = node.querySelector('.roomNotice.isTip');
            if (tipEl) {
              const tokens = parseTipElement(tipEl);
              if (tokens !== null) {
                const ts = parseInt(node.dataset.ts || '0', 10);
                collected.push({ tokens, ts });
              }
            }
            continue;
          }

          const msgNodes = node.querySelectorAll('[data-testid="chat-message"]');
          for (const msgNode of msgNodes) {
            const tipEl = msgNode.querySelector('.roomNotice.isTip');
            if (tipEl) {
              const tokens = parseTipElement(tipEl);
              if (tokens !== null) {
                const ts = parseInt(msgNode.dataset.ts || '0', 10);
                collected.push({ tokens, ts });
              }
            }
          }
        }
      }

      if (collected.length === 0) return;

      // Sort oldest first before queuing
      collected.sort((a, b) => a.ts - b.ts);

      // Push each tip sequentially into storage
      // We chain storage reads/writes to avoid race conditions
      const pushSequentially = (items) => {
        if (items.length === 0) return;
        chrome.storage.local.get(['tipQueue'], (result) => {
          const queue = result.tipQueue || [];
          for (const { tokens } of items) queue.push(tokens);
          chrome.storage.local.set({ tipQueue: queue, queueLength: queue.length }, () => {
            console.log(`[Lovense Bridge] ${items.length} tip(s) queued. Queue: ${queue.length}`);
            if (!isPaused) {
              chrome.runtime.sendMessage({ type: 'TIP_QUEUED' }, () => { void chrome.runtime.lastError; });
            }
          });
        });
      };

      pushSequentially(collected);
    });

    observer.observe(container, { childList: true, subtree: true });
  }

  // Wait for the chat container to appear in the DOM
  function waitForChat() {
    const existing = findChatContainer();
    if (existing) { startObserver(existing); return; }

    console.log('[Lovense Bridge] Container not found, watching body...');
    const bodyObserver = new MutationObserver(() => {
      const container = findChatContainer();
      if (container) {
        bodyObserver.disconnect();
        console.log('[Lovense Bridge] Container appeared in DOM ✓');
        startObserver(container);
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  waitForChat();
})();