# Chaturbate × Lovense Bridge

A Chrome extension that connects Chaturbate tips to your Lovense toy in real time.

When a viewer sends tokens on Chaturbate, the extension detects the tip and automatically sends a vibration (and rotation) command to your Lovense device over your local network.

---

## Requirements

- A compatible **Lovense** device (tested with the Ridge)
- The **Lovense Remote** app on your smartphone
- Your smartphone and PC connected to the **same Wi-Fi network**
- **Google Chrome** or a Chromium-based browser

---

## Installation

### 1. Download the extension

Download or clone this repository and place the `chaturbate-lovense/` folder somewhere on your PC.

```bash
git clone https://github.com/your-username/chaturbate-lovense.git
```

Or download the ZIP via **Code → Download ZIP** on GitHub and extract it.

### 2. Enable Developer Mode in Chrome

1. Open `chrome://extensions/` in Chrome
2. Toggle **"Developer mode"** on (top right)

### 3. Load the extension

1. Click **"Load unpacked"**
2. Select the `chaturbate-lovense/` folder
3. The extension appears in the list ✅

---

## Setup

### Step 1 — Enable Game Mode in Lovense Remote

1. Open **Lovense Remote** on your smartphone
2. Go to **Discover** → **Game Mode**
3. Note the information displayed:
   - **Local IP** (e.g. `192.168.1.42`)
   - **Port** (e.g. `20010`)

### Step 2 — Configure the extension

1. Open a Chaturbate room page in Chrome
2. Click the extension icon in the toolbar
3. Enter the **Local IP** and **Port** from Lovense Remote
4. Click **"Test connection"** — your device should vibrate for 2 seconds ✅
5. Click **"Save"**

---

## Features

### Standard mapping

Maps token ranges to a vibration intensity and duration. Defaults:

| Tokens | Strength (1–20) | Duration |
|--------|-----------------|----------|
| 1–9 | 5 | 3s |
| 10–24 | 10 | 5s |
| 25–49 | 15 | 7s |
| 50–99 | 18 | 10s |
| 100+ | 20 | 15s |

### Special commands

Maps an **exact** token amount to a specific pattern. Special commands take priority over the standard mapping.

Available patterns: `Vibrate`, `Pulse`, `Wave`, `Fireworks`, `Earthquake`

For each special command, you can configure:
- **Strength min–max**: if min ≠ max, the intensity is picked randomly within that range
- **Duration min–max** + **"rand. dur."** checkbox: if checked, the duration is random within that range

Default special commands:

| Tokens | Pattern | Strength | Duration |
|--------|---------|----------|----------|
| 111 | Wave | 20 | 30s |
| 222 | Vibrate | 20 | 15–99s random |
| 322 | Vibrate | 14–20 random | 30s |
| 444 | Pulse | 20 | 66s |
| 888 | Fireworks | 20 | 77s |
| 2222 | Earthquake | 20 | 222s |

### Queue

Tips are processed **in order of arrival**. If multiple tips come in while a vibration is active, they are queued and executed one after another.

### Pause button

The **⏸ Pause** button suspends queue processing without losing queued tips. Click **▶ Resume** to restart processing from the front of the queue. The number of pending tips is shown in real time.

### Live display

The popup shows the currently active tip with:
- Token amount
- Applied strength
- Total duration, pattern
- A progress bar with countdown

---

## Project structure

```
chaturbate-lovense/
├── manifest.json      — Extension declaration (permissions, scripts)
├── content.js         — Tip detection in the Chaturbate chat
├── background.js      — Tip processing and Lovense command dispatch
├── popup.html         — Configuration UI
└── popup.js           — UI logic
```

---

## Troubleshooting

**The extension does not detect tips**
- Make sure you are on `chaturbate.com` or a subdomain like `fr.chaturbate.com`
- Reload the Chaturbate page after reloading the extension
- Open DevTools (F12) → "top" dropdown → select the extension context to see `[Lovense Bridge]` logs

**Test connection fails**
- Make sure Game Mode is active in Lovense Remote
- Make sure your PC and smartphone are on the same Wi-Fi network
- Double-check the IP and Port entered in the popup

**Vibration lasts longer than expected**
- An explicit stop command is sent at the end of each activation. If the issue persists, make sure the Lovense Remote app is in the foreground on your smartphone.

---

## Legal

This is an independent open source project, not affiliated with Chaturbate or Lovense. It uses the Lovense Remote local API (Game Mode) and the Chaturbate public chat interface.

Free to use, modify, and distribute.