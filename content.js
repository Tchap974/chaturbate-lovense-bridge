// content.js — Runs on Chaturbate pages
// Observes the chat, detects tips, manages the queue and pause state

(function () {
  const TIP_REGEX = /tipped\s+(\d+)\s+tokens?/i;

  let tipQueue = [];
  let isProcessing = false;
  let isPaused = false;

  // Sync pause state from storage on startup
  chrome.storage.local.get(['paused'], (result) => {
    isPaused = !!result.paused;
  });

  // Listen for pause state changes sent from popup.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PAUSE_STATE') {
      isPaused = message.paused;
      console.log(`[Lovense Bridge] ${isPaused ? '⏸ Paused' : '▶ Resumed — processing queue'}`);
      syncQueueLength();
      if (!isPaused && !isProcessing) {
        processQueue();
      }
    }
  });

  // Write queue length to storage so the popup can display it
  function syncQueueLength() {
    chrome.storage.local.set({ queueLength: tipQueue.length });
  }

  // Find the chat container in the DOM
  function findChatContainer() {
    // Confirmed via browser inspector: single div with both classes
    return document.querySelector('div.msg-list-fvm.message-list');
  }

  // Extract token count from a .roomNotice.isTip element
  function parseTipElement(el) {
    const text = el.textContent || '';
    const match = text.match(TIP_REGEX);
    return match ? parseInt(match[1], 10) : null;
  }

  // Add a tip to the queue and start processing if idle
  function enqueueTip(tokens) {
    tipQueue.push(tokens);
    syncQueueLength();
    console.log(`[Lovense Bridge] Tip detected: ${tokens} tokens. Queue: ${tipQueue.length}${isPaused ? ' (paused)' : ''}`);
    if (!isProcessing && !isPaused) {
      processQueue();
    }
  }

  // Process the queue one tip at a time
  function processQueue() {
    // Do nothing while paused
    if (isPaused) {
      isProcessing = false;
      return;
    }

    if (tipQueue.length === 0) {
      isProcessing = false;
      syncQueueLength();
      return;
    }

    isProcessing = true;
    const tokens = tipQueue.shift();
    syncQueueLength();

    // Send tip to the service worker (background.js)
    chrome.runtime.sendMessage({ type: 'TIP', tokens }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Lovense Bridge] Messaging error:', chrome.runtime.lastError.message);
      }

      // Wait for the vibration to finish before processing the next tip
      const delay = (response && response.duration) ? response.duration : 3000;
      setTimeout(processQueue, delay);
    });
  }

  // Start observing the chat container for new messages
  function startObserver(container) {
    console.log('[Lovense Bridge] Chat observation started ✓');

    const observer = new MutationObserver((mutations) => {
      // Collect all tip nodes found across this batch of mutations
      // then sort them by data-ts (oldest first) before enqueuing.
      // This ensures that historical tips inserted in reverse order
      // (Chaturbate prepends past messages when entering a room)
      // are processed oldest-first, matching their original order.
      const collected = [];

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Single chat message node
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

          // Batch insert — check all descendants
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

      // Sort oldest first (ascending timestamp)
      collected.sort((a, b) => a.ts - b.ts);

      for (const { tokens } of collected) {
        enqueueTip(tokens);
      }
    });

    observer.observe(container, { childList: true, subtree: true });
  }

  // Wait for the chat container to appear in the DOM
  // Uses a MutationObserver on body — more reliable than setTimeout retries
  // since the script injects before the chat is rendered
  function waitForChat() {
    const existing = findChatContainer();
    if (existing) {
      startObserver(existing);
      return;
    }

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