// sidepanel.js - UI, Queue, and Vault Controller

document.addEventListener("DOMContentLoaded", async () => {
  const DEFAULT_KEY = "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";
  const DEFAULT_MODEL = "auto";
  const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

  // Elements
  const elVaultPass = document.getElementById("setting-vault-pass");
  const elKey = document.getElementById("setting-key");
  const elBaseUrl = document.getElementById("setting-base-url");
  const elModel = document.getElementById("setting-model");
  const elSpeed = document.getElementById("setting-speed");
  const speedVal = document.getElementById("speed-val");
  const elDomainLock = document.getElementById("setting-domain-lock");
  const elBypassHoneypot = document.getElementById("setting-bypass-honeypot");
  const elGoCrazy = document.getElementById("setting-go-crazy");
  const elRules = document.getElementById("setting-rules");

  const btnToggleSettings = document.getElementById("btn-toggle-settings");
  const settingsPanel = document.getElementById("settings-panel");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const promptInput = document.getElementById("prompt-input");
  const btnSelectorGrab = document.getElementById("btn-selector-grab");
  const btnAddQueue = document.getElementById("btn-add-queue");
  const queueList = document.getElementById("queue-list");

  const runModePlan = document.querySelector('input[value="plan"]');
  const btnStart = document.getElementById("btn-start");
  const btnKill = document.getElementById("btn-kill");
  const btnExportLogs = document.getElementById("btn-export-logs");
  const btnClearConsole = document.getElementById("btn-clear-console");
  
  const planPanel = document.getElementById("plan-approval-panel");
  const planTextarea = document.getElementById("plan-proposal-textarea");
  const btnApprove = document.getElementById("btn-approve");
  const btnReject = document.getElementById("btn-reject");
  const logConsole = document.getElementById("console");

  // State
  let queue = [];
  let isRunning = false;
  let activeAgent = null;
  let logsMarkdown = "# Execution Logs\n";

  // Initialize UI Values from Storage
  chrome.storage.local.get([
    "apiKey", "encryptedKey", "model", "baseUrl", "speed", "domainLock", "bypassHoneypot", "goCrazy", "routingRules", "queue"
  ], (data) => {
    elKey.value = data.apiKey || (data.encryptedKey ? "" : DEFAULT_KEY);
    if (data.encryptedKey) {
      elVaultPass.placeholder = "Enter passphrase to UNLOCK encrypted key";
      elKey.placeholder = "Locked (encrypted)";
    }
    elModel.value = data.model || DEFAULT_MODEL;
    elBaseUrl.value = data.baseUrl || DEFAULT_BASE_URL;
    elSpeed.value = data.speed || "500";
    speedVal.textContent = `${elSpeed.value}ms`;
    elDomainLock.checked = !!data.domainLock;
    elBypassHoneypot.checked = !!data.bypassHoneypot;
    elGoCrazy.checked = !!data.goCrazy;
    elRules.value = data.routingRules ? JSON.stringify(data.routingRules) : "";
    
    if (data.queue) {
      queue = data.queue;
      renderQueue();
    }
  });

  // Slider change display
  elSpeed.addEventListener("input", (e) => {
    speedVal.textContent = `${e.target.value}ms`;
  });

  // Toggle settings
  btnToggleSettings.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  // Crypto Helpers
  async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptData(plainText, passphrase) {
    const enc = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(plainText)
    );

    return {
      salt: btoa(String.fromCharCode(...salt)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    };
  }

  async function decryptData(encryptedObj, passphrase) {
    const salt = new Uint8Array(atob(encryptedObj.salt).split("").map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(encryptedObj.iv).split("").map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(encryptedObj.ciphertext).split("").map(c => c.charCodeAt(0)));
    
    const key = await deriveKey(passphrase, salt);
    const dec = new TextDecoder();
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
    return dec.decode(decrypted);
  }

  // Save Settings
  btnSaveSettings.addEventListener("click", async () => {
    const rawKey = elKey.value.trim();
    const passphrase = elVaultPass.value.trim();
    const model = elModel.value.trim();
    const baseUrl = elBaseUrl.value.trim();
    const speed = elSpeed.value;
    const domainLock = elDomainLock.checked;
    const bypassHoneypot = elBypassHoneypot.checked;
    const goCrazy = elGoCrazy.checked;
    
    let rules = {};
    try {
      if (elRules.value.trim()) {
        rules = JSON.parse(elRules.value);
      }
    } catch(e) {
      writeLog("Error: Invalid JSON syntax in Custom Routing Rules.");
      return;
    }

    const payload = { model, baseUrl, speed, domainLock, bypassHoneypot, goCrazy, routingRules: rules };

    if (passphrase) {
      // Key encryption
      if (!rawKey) {
        writeLog("Error: Enter API key to encrypt.");
        return;
      }
      try {
        const encrypted = await encryptData(rawKey, passphrase);
        payload.encryptedKey = encrypted;
        payload.apiKey = ""; // Clear plaintext
        elKey.placeholder = "Locked (encrypted)";
        elKey.value = "";
        elVaultPass.value = "";
      } catch (err) {
        writeLog(`Encryption failed: ${err.message}`);
        return;
      }
    } else {
      // Direct store
      if (rawKey) {
        payload.apiKey = rawKey;
        payload.encryptedKey = null;
      }
    }

    chrome.storage.local.set(payload, () => {
      writeLog("Configuration successfully saved.");
      settingsPanel.classList.add("hidden");
    });
  });

  // Selector Grab Tool injection
  btnSelectorGrab.addEventListener("click", async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab) return;
    
    writeLog("Grab tool active. Hover and click an element in the tab...");

    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        // Overlay and click interceptor
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.pointerEvents = "none";
        overlay.style.border = "2px dashed #fbbf24";
        overlay.style.backgroundColor = "rgba(251, 191, 36, 0.1)";
        overlay.style.zIndex = "999999";
        document.body.appendChild(overlay);

        let activeEl = null;

        const onHover = (e) => {
          activeEl = e.target;
          const rect = activeEl.getBoundingClientRect();
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
        };

        const generateSelector = (el) => {
          if (el.id) return `#${el.id}`;
          let path = [];
          while (el && el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            if (el.className) {
              const classes = Array.from(el.classList).join(".");
              if (classes) selector += `.${classes}`;
            }
            path.unshift(selector);
            el = el.parentNode;
          }
          return path.join(" > ");
        };

        const onClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const selector = generateSelector(activeEl);
          
          // Cleanup
          overlay.remove();
          document.removeEventListener("mouseover", onHover);
          document.removeEventListener("click", onClick, true);
          
          // Send back
          chrome.runtime.sendMessage({ type: "GRABBED_SELECTOR", selector });
        };

        document.addEventListener("mouseover", onHover);
        document.addEventListener("click", onClick, true);
      }
    });
  });

  // Listen for grabbed selector message
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "GRABBED_SELECTOR") {
      promptInput.value += ` "${message.selector}"`;
      writeLog(`Grabbed element: ${message.selector}`);
    }
  });

  // Add to Queue
  btnAddQueue.addEventListener("click", async () => {
    const text = promptInput.value.trim();
    if (!text) return;
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    queue.push({
      text: text,
      tabId: activeTab ? activeTab.id : null,
      tabTitle: activeTab ? activeTab.title.slice(0, 15) : "Tab"
    });
    promptInput.value = "";
    chrome.storage.local.set({ queue });
    renderQueue();
  });

  function renderQueue() {
    queueList.innerHTML = "";
    if (queue.length === 0) {
      queueList.innerHTML = '<div class="text-slate-500 text-xs italic">No prompts queued.</div>';
      return;
    }
    queue.forEach((item, index) => {
      const div = document.createElement("div");
      div.className = "queue-item";
      const textVal = typeof item === "string" ? item : item.text;
      const tabLabel = (item && item.tabTitle) ? `[${item.tabTitle}] ` : "";
      div.innerHTML = `
        <span class="queue-item-text">${index + 1}. <strong style="color: var(--accent-gold);">${escapeHtml(tabLabel)}</strong>${escapeHtml(textVal)}</span>
        <button class="btn-remove" data-index="${index}">✕</button>
      `;
      queueList.appendChild(div);
    });

    document.querySelectorAll(".btn-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-index"));
        queue.splice(idx, 1);
        chrome.storage.local.set({ queue });
        renderQueue();
      });
    });
  }

    async function syncLogToServer(data) {
    try {
      await fetch("http://localhost:5000/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    } catch(e) {}
  }

  function writeLog(text) {
    logConsole.textContent += "\n" + text;
    logConsole.scrollTop = logConsole.scrollHeight;
    logsMarkdown += `\n${text}`;
  }

  function clearLog() {
    logConsole.textContent = "Logs cleared.";
    logsMarkdown = "# Execution Logs\n";
  }

  btnClearConsole.addEventListener("click", clearLog);

  // Start Loop
  btnStart.addEventListener("click", async () => {
    if (isRunning) {
      isRunning = false;
      btnStart.textContent = "Start Agent";
      writeLog("Agent execution paused.");
      return;
    }

    if (queue.length === 0) {
      writeLog("Error: No prompts in the queue.");
      return;
    }

    isRunning = true;
    btnStart.textContent = "Pause Agent";
    btnStart.classList.add("btn-indigo");
    btnStart.classList.remove("btn-gold");

    runQueueLoop();
  });

  async function runQueueLoop() {
    while (queue.length > 0 && isRunning) {
      const promptObj = queue[0];
      const promptText = typeof promptObj === "string" ? promptObj : promptObj.text;
      
      if (promptObj && promptObj.tabId) {
        try {
          await new Promise((resolve, reject) => {
            chrome.tabs.update(promptObj.tabId, { active: true }, (tab) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                if (tab && tab.windowId) {
                  chrome.windows.update(tab.windowId, { focused: true }, () => {
                    resolve(tab);
                  });
                } else {
                  resolve(tab);
                }
              }
            });
          });
          await new Promise(r => setTimeout(r, 400)); // Wait for tab focus
        } catch(e) {
          writeLog("Target tab was closed or focus failed. Running on current active tab.");
        }
      }
      
      const config = await new Promise((resolve) => {
        chrome.storage.local.get([
          "apiKey", "encryptedKey", "model", "baseUrl", "speed", "domainLock", "bypassHoneypot", "goCrazy", "routingRules"
        ], resolve);
      });

      let apiKey = config.apiKey;
      if (config.encryptedKey && !apiKey) {
        // Vault unlock
        const pass = elVaultPass.value.trim();
        if (!pass) {
          writeLog("Error: API Key is encrypted. Enter Vault Passphrase in settings to unlock.");
          isRunning = false;
          btnStart.textContent = "Start Agent";
          return;
        }
        try {
          apiKey = await decryptData(config.encryptedKey, pass);
        } catch (err) {
          writeLog("Error: Incorrect Vault Passphrase.");
          isRunning = false;
          btnStart.textContent = "Start Agent";
          return;
        }
      }

      if (!apiKey) {
        writeLog("Error: No API key found. Open settings and save your key.");
        isRunning = false;
        btnStart.textContent = "Start Agent";
        return;
      }

      const savedState = await new Promise((resolve) => {
        chrome.storage.local.get(["activeAgentState"], (res) => resolve(res.activeAgentState));
      });

      activeAgent = new ChromeAgent(
        apiKey,
        config.model,
        writeLog,
        handleApprovalRequired,
        { 
          ...config, 
          isCancelled: () => !isRunning,
          history: (savedState && savedState.prompt === promptText) ? savedState.history : []
        }
      );
      if (savedState && savedState.prompt === promptText) {
        activeAgent.activeModel = savedState.activeModel;
        writeLog("[Session Resumed] Restored agent execution history.");
      }

      const mode = runModePlan.checked ? "plan" : "auto";
      activeAgent.currentMode = mode;

      // Sync Go Crazy Mode flag with page sessionStorage
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            args: [!!config.goCrazy],
            func: (val) => {
              sessionStorage.setItem('goCrazy', val ? 'true' : 'false');
            }
          });
        } catch(e) {}
      }

      try {
        const result = await activeAgent.runPrompt(promptText, mode);
        
        // Sync log with local server
        await syncLogToServer({
          timestamp: Date.now(),
          prompt: promptText,
          action: activeAgent.pendingAction ? activeAgent.pendingAction.action : "step_execution",
          model: activeAgent.activeModel,
          logs: logConsole.textContent.slice(-1000),
          screenshot: activeAgent.lastScreenshot || null,
          status: "success"
        });

        if (result === "aborted") {
          isRunning = false;
          btnStart.textContent = "Start Agent";
          return;
        }
        if (result === "finish") {
          queue.shift();
          chrome.storage.local.set({ queue });
          renderQueue();
          writeLog(">>> Task complete! Moving to next queue item.");
          
          // Display screenshot link if captured
          if (activeAgent.lastScreenshot) {
            writeLog(`[Finished Screenshot Captured]`);
            logsMarkdown += `\n\n![Screenshot](${activeAgent.lastScreenshot})`;
          }
        }
      } catch (err) {
        writeLog(`Stopped loop due to error: ${err.message}`);
        
        // Sync failure log with local server
        await syncLogToServer({
          timestamp: Date.now(),
          prompt: promptText,
          action: "error_catch",
          logs: logConsole.textContent.slice(-1000),
          status: "error",
          errorMessage: err.message
        });

        isRunning = false;
        btnStart.textContent = "Start Agent";
        return;
      }
    }

    if (queue.length === 0) {
      writeLog("\nAll queued tasks have finished.");
      isRunning = false;
      btnStart.textContent = "Start Agent";
      btnStart.classList.add("btn-gold");
      btnStart.classList.remove("btn-indigo");
    }
  }

  // Interactive Plan Handlers
  function handleApprovalRequired(plan) {
    planPanel.classList.remove("hidden");
    planTextarea.value = JSON.stringify(plan, null, 2);
  }

  btnApprove.addEventListener("click", async () => {
    planPanel.classList.add("hidden");
    if (activeAgent) {
      try {
        // Parse the edited JSON textarea plan
        const editedPlan = JSON.parse(planTextarea.value);
        activeAgent.pendingAction = editedPlan;

        const res = await activeAgent.executePending();
        
        // Sync approved step details with local server
        await syncLogToServer({
          timestamp: Date.now(),
          action: "approve_step",
          logs: logConsole.textContent.slice(-1000),
          screenshot: activeAgent.lastScreenshot || null,
          status: "success"
        });

        if (res === "aborted") {
          isRunning = false;
          btnStart.textContent = "Start Agent";
          return;
        }
        if (res === "finish") {
          queue.shift();
          chrome.storage.local.set({ queue });
          renderQueue();
          writeLog(">>> Task complete!");
          
          if (activeAgent.lastScreenshot) {
            logsMarkdown += `\n\n![Screenshot](${activeAgent.lastScreenshot})`;
          }
          
          if (isRunning) runQueueLoop();
        }
      } catch (err) {
        writeLog(`Execution or JSON parse error: ${err.message}`);
        isRunning = false;
        btnStart.textContent = "Start Agent";
      }
    }
  });

  btnReject.addEventListener("click", () => {
    planPanel.classList.add("hidden");
    writeLog("Action proposal rejected. Execution paused.");
    isRunning = false;
    btnStart.textContent = "Start Agent";
    activeAgent = null;
  });

  // Export logs to Markdown
  btnExportLogs.addEventListener("click", () => {
    const blob = new Blob([logsMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-execution-log-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    writeLog("Markdown log report exported successfully.");
  });

    // Kill Agent Switch
  btnKill.addEventListener("click", () => {
    isRunning = false;
    queue = [];
    chrome.storage.local.set({ queue });
    renderQueue();
    planPanel.classList.add("hidden");
    btnStart.textContent = "Start Agent";
    btnStart.classList.add("btn-gold");
    btnStart.classList.remove("btn-indigo");
    writeLog("⚠️ AGENT KILLED: Execution terminated and prompt queue cleared.");
    activeAgent = null;
  });

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});
