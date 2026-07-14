// sidepanel.js - Conversational Chat UI & Controller

document.addEventListener("DOMContentLoaded", async () => {
  const DEFAULT_KEY = "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";
  const DEFAULT_MODEL = "auto";
  const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

  // Elements
  const elKey = document.getElementById("setting-key");
  const elGithubToken = document.getElementById("setting-github-token");
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
  const btnStart = document.getElementById("btn-start");
  const btnKill = document.getElementById("btn-kill");
  const btnExportLogs = document.getElementById("btn-export-logs");
  const modelSelectHeader = document.getElementById("model-select-header");
  const runModeSelect = document.getElementById("run-mode-select");
  const btnTeachWorkflow = document.getElementById("btn-teach-workflow");
  const btnNewAgent = document.getElementById("btn-new-agent");
  const agentsListContainer = document.getElementById("agents-list");
  
  const planPanel = document.getElementById("plan-approval-panel");
  const planTextarea = document.getElementById("plan-proposal-textarea");
  const btnApprove = document.getElementById("btn-approve");
  const btnReject = document.getElementById("btn-reject");
  const chatContainer = document.getElementById("chat-container");
  const btnGroupTabs = document.getElementById("btn-group-tabs");
  const hudStatus = document.getElementById("hud-status");
  const footerHint = document.getElementById("footer-hint");

  const HUD_HINTS = {
    ready: "Enter to send • Shift+Enter for new line • Ctrl+C to stop",
    running: "Agent running — click Stop or press Ctrl+C to abort",
    waiting: "Waiting for your approval — review the step above",
    paused: "Paused — send a new message or switch mode to continue"
  };

  function setHudStatus(state) {
    if (!hudStatus) return;
    hudStatus.classList.remove("running", "paused", "waiting");
    if (state === "running" || state === "paused" || state === "waiting") {
      hudStatus.classList.add(state);
    }
    const labels = {
      ready: "Ready — Enter to send",
      running: "Running — Stop or Ctrl+C to abort",
      waiting: "Awaiting approval — Approve or Reject above",
      paused: "Paused — send a new message to continue"
    };
    hudStatus.textContent = labels[state] || labels.ready;
    if (footerHint && HUD_HINTS[state]) {
      footerHint.textContent = HUD_HINTS[state];
    }
  }

  // State
  let isRunning = false;
  let activeAgent = null;
  let logsMarkdown = "# Execution Logs\n";
  let currentActionBlock = null;

  let agentsList = [];
  let activeAgentIndex = 0;

  // Get active tab and group it under "🐒 MonkeyPilot"
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && activeTab.url && !activeTab.url.startsWith("chrome")) {
      if (!activeTab.groupId || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        chrome.tabs.group({ tabIds: [activeTab.id] }, (groupId) => {
          chrome.tabGroups.update(groupId, { title: "🐒 MonkeyPilot", color: "orange" });
          chrome.storage.local.set({ monkeyPilotGroupId: groupId });
        });
      } else {
        chrome.storage.local.set({ monkeyPilotGroupId: activeTab.groupId });
      }
    }
  } catch(e) {}

  // Initialize UI Values from Storage
  chrome.storage.local.get([
    "apiKey", "model", "baseUrl", "speed", "domainLock", "bypassHoneypot", "goCrazy", "routingRules", "githubToken", "agentsList", "activeAgentIndex"
  ], (data) => {
    elKey.value = data.apiKey || DEFAULT_KEY;
    elGithubToken.value = data.githubToken || "";
    elModel.value = data.model || DEFAULT_MODEL;
    modelSelectHeader.value = data.model || DEFAULT_MODEL;
    elBaseUrl.value = data.baseUrl || DEFAULT_BASE_URL;
    elSpeed.value = data.speed || "500";
    speedVal.textContent = `${elSpeed.value}ms`;
    elDomainLock.checked = !!data.domainLock;
    elBypassHoneypot.checked = !!data.bypassHoneypot;
    elGoCrazy.checked = !!data.goCrazy;
    elRules.value = data.routingRules ? JSON.stringify(data.routingRules) : "";
    
    // Load sessions
    if (data.agentsList && data.agentsList.length > 0) {
      agentsList = data.agentsList;
      activeAgentIndex = data.activeAgentIndex || 0;
      if (activeAgentIndex >= agentsList.length) activeAgentIndex = 0;
    } else {
      // Create initial monkey agent session
      agentsList = [{
        id: Date.now(),
        emoji: "🐒",
        history: [],
        currentPrompt: "",
        targetTabId: null,
        logsMarkdown: "# Execution Logs\n"
      }];
      activeAgentIndex = 0;
    }
    
    renderAgentsList();
    restoreActiveAgentSession();
  });

  // Sync header model change
  modelSelectHeader.addEventListener("change", (e) => {
    const selectedModel = e.target.value;
    chrome.storage.local.set({ model: selectedModel });
    elModel.value = selectedModel;
  });

  // Teach Workflow Click Handler
  btnTeachWorkflow.addEventListener("click", async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab) return;
    
    appendSystemBubble("🎙️ Teach Mode Active: Click any element in your tab to record it as an instruction step...");
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const onTeachClick = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            let desc = e.target.textContent.trim().slice(0, 30) || e.target.placeholder || e.target.value || "element";
            let tag = e.target.tagName.toLowerCase();
            let id = e.target.id ? `#${e.target.id}` : "";
            let selector = tag + id;
            
            chrome.runtime.sendMessage({
              type: "TEACH_STEP",
              selector,
              desc
            });
            
            const origOutline = e.target.style.outline;
            e.target.style.outline = "2px dashed #fbbf24";
            setTimeout(() => {
              e.target.style.outline = origOutline;
            }, 800);
            
            document.removeEventListener("click", onTeachClick, true);
          };
          document.addEventListener("click", onTeachClick, true);
        }
      });
    } catch(e) {}
  });

  // Slider change display
  elSpeed.addEventListener("input", (e) => {
    speedVal.textContent = `${e.target.value}ms`;
  });

  // Toggle settings
  btnToggleSettings.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  // Save Settings
  btnSaveSettings.addEventListener("click", async () => {
    const rawKey = elKey.value.trim();
    const githubToken = elGithubToken.value.trim();
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
      appendSystemBubble("Error: Invalid JSON syntax in Custom Routing Rules.");
      return;
    }

    const payload = { apiKey: rawKey, model, baseUrl, speed, domainLock, bypassHoneypot, goCrazy, routingRules: rules, githubToken };

    chrome.storage.local.set(payload, () => {
      appendSystemBubble("Configuration successfully saved.");
      settingsPanel.classList.add("hidden");
    });
  });

  // Selector Grab Tool injection
  btnSelectorGrab.addEventListener("click", async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab) return;
    
    appendSystemBubble("Selector grab tool active. Hover and click an element in the active tab...");

    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          // Pre-existing elements cleanup
          const existingOverlay = document.getElementById("monkeypilot-grab-overlay");
          if (existingOverlay) existingOverlay.remove();
          const existingTooltip = document.getElementById("monkeypilot-grab-tooltip");
          if (existingTooltip) existingTooltip.remove();

          // Highlight overlay element
          const overlay = document.createElement("div");
          overlay.id = "monkeypilot-grab-overlay";
          overlay.style.position = "fixed";
          overlay.style.pointerEvents = "none";
          overlay.style.border = "2px solid #fbbf24";
          overlay.style.backgroundColor = "rgba(251, 191, 36, 0.15)";
          overlay.style.boxShadow = "0 0 8px rgba(251, 191, 36, 0.5)";
          overlay.style.zIndex = "999999";
          overlay.style.transition = "all 0.1s ease";
          document.body.appendChild(overlay);

          // Info tooltip element
          const tooltip = document.createElement("div");
          tooltip.id = "monkeypilot-grab-tooltip";
          tooltip.style.position = "fixed";
          tooltip.style.pointerEvents = "none";
          tooltip.style.backgroundColor = "#0f172a";
          tooltip.style.color = "#fbbf24";
          tooltip.style.padding = "4px 8px";
          tooltip.style.borderRadius = "4px";
          tooltip.style.fontSize = "11px";
          tooltip.style.fontFamily = "monospace";
          tooltip.style.zIndex = "999999";
          tooltip.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
          tooltip.style.border = "1px solid #334155";
          document.body.appendChild(tooltip);

          let activeEl = null;

          const onHover = (e) => {
            activeEl = e.target;
            if (activeEl.id === "monkeypilot-grab-overlay" || activeEl.id === "monkeypilot-grab-tooltip") return;
            
            const rect = activeEl.getBoundingClientRect();
            overlay.style.left = rect.left + "px";
            overlay.style.top = rect.top + "px";
            overlay.style.width = rect.width + "px";
            overlay.style.height = rect.height + "px";

            // Render tooltip text
            let tagStr = activeEl.tagName.toLowerCase();
            if (activeEl.id) tagStr += `#${activeEl.id}`;
            else if (activeEl.className && typeof activeEl.className === "string") {
              const classes = activeEl.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
              if (classes) tagStr += `.${classes}`;
            }
            tooltip.textContent = tagStr;
            
            const tooltipX = rect.left;
            const tooltipY = rect.top - 24 > 5 ? rect.top - 24 : rect.bottom + 5;
            tooltip.style.left = tooltipX + "px";
            tooltip.style.top = tooltipY + "px";
          };

          const generateSelector = (el) => {
            if (el.id) return `#${el.id}`;
            if (el.tagName === "BODY") return "body";
            if (el.tagName === "HTML") return "html";
            
            // Try unique attributes
            const uniqueAttrs = ["name", "placeholder", "aria-label", "data-testid", "role"];
            for (const attr of uniqueAttrs) {
              const val = el.getAttribute(attr);
              if (val) {
                const sel = `${el.tagName.toLowerCase()}[${attr}="${val}"]`;
                try {
                  if (document.querySelectorAll(sel).length === 1) return sel;
                } catch(err) {}
              }
            }

            // Fallback path
            let path = [];
            let current = el;
            while (current && current.nodeType === Node.ELEMENT_NODE) {
              let selector = current.nodeName.toLowerCase();
              if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break;
              } else {
                let cleanClasses = [];
                if (current.classList && current.classList.length > 0) {
                  current.classList.forEach(cls => {
                    if (cls && !cls.includes(":") && !cls.includes("[") && !cls.includes("]")) {
                      cleanClasses.push(cls);
                    }
                  });
                }
                if (cleanClasses.length > 0) {
                  selector += "." + cleanClasses.join(".");
                }
                
                let sibling = current.previousElementSibling;
                let nth = 1;
                while (sibling) {
                  if (sibling.nodeName === current.nodeName) {
                    nth++;
                  }
                  sibling = sibling.previousElementSibling;
                }
                if (nth > 1 || (current.nextElementSibling && [...current.parentNode.children].filter(c => c.nodeName === current.nodeName).length > 1)) {
                  selector += `:nth-of-type(${nth})`;
                }
              }
              path.unshift(selector);
              current = current.parentNode;
            }
            return path.join(" > ");
          };

          const onClick = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const selector = generateSelector(activeEl);
            
            overlay.style.backgroundColor = "rgba(16, 185, 129, 0.4)";
            overlay.style.border = "2px solid #10b981";
            overlay.style.boxShadow = "0 0 12px rgba(16, 185, 129, 0.7)";
            tooltip.style.color = "#10b981";
            tooltip.style.borderColor = "#10b981";
            tooltip.textContent = "Selected!";

            setTimeout(() => {
              overlay.remove();
              tooltip.remove();
            }, 300);

            document.removeEventListener("mouseover", onHover, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("mousedown", onMouseDown, true);
            document.removeEventListener("mouseup", onMouseUp, true);
            
            try {
              chrome.runtime.sendMessage({ type: "GRABBED_SELECTOR", selector });
            } catch (err) {}
          };

          const onMouseDown = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
          };

          const onMouseUp = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
          };

          document.addEventListener("mouseover", onHover, true);
          document.addEventListener("click", onClick, true);
          document.addEventListener("mousedown", onMouseDown, true);
          document.addEventListener("mouseup", onMouseUp, true);
        }
      });
    } catch(err) {
      appendSystemBubble(`Grab tool error: ${err.message}. Make sure you are on a normal website tab (not chrome:// or a local file)`);
    }
  });

  // Listen for grabbed selector and teaching messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "GRABBED_SELECTOR") {
      promptInput.value += ` "${message.selector}"`;
      appendSystemBubble(`Grabbed element selector: ${message.selector}`);
    } else if (message.type === "TEACH_STEP") {
      promptInput.value += ` click on "${message.desc}" (${message.selector})`;
      appendSystemBubble(`Recorded teaching step: Clicked on "${message.desc}"`);
    } else if (message.type === "STOP_AGENT") {
      btnKill.click();
    }
  });

  // UI Bubble Helpers
  function appendUserBubble(text) {
    const row = document.createElement("div");
    row.className = "message-row user";
    row.innerHTML = `<div class="chat-bubble user">${escapeHtml(text)}</div>`;
    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    logsMarkdown += `\n\n**User:** ${text}`;
  }

  function appendAgentBubble(text) {
    const row = document.createElement("div");
    row.className = "message-row agent";
    row.innerHTML = `<div class="chat-bubble agent">${escapeHtml(text)}</div>`;
    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    logsMarkdown += `\n\n**MonkeyPilot:** ${text}`;
  }

  function appendSystemBubble(text) {
    const row = document.createElement("div");
    row.className = "message-row agent";
    row.innerHTML = `<div class="chat-bubble agent" style="border-color: var(--accent-gold); color: var(--accent-gold); font-size:11px;">⚠️ ${escapeHtml(text)}</div>`;
    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    logsMarkdown += `\n\n**System:** ${text}`;
  }

  function appendActionBlock(actionText, detail) {
    const block = document.createElement("div");
    block.className = "action-block";
    block.innerHTML = `
      <div class="action-header">
        <span>⚙️ ${escapeHtml(actionText.toUpperCase())}</span>
      </div>
      <div class="action-detail" style="color: var(--text-muted); margin-bottom: 4px;">${escapeHtml(detail)}</div>
      <div class="action-result" style="color: var(--accent-gold);">Executing...</div>
    `;
    chatContainer.appendChild(block);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    logsMarkdown += `\n\n*Action:* ${actionText} - ${detail}`;
    return block;
  }

  function restoreConversation(history) {
    // Clear initial greeting and render saved history
    chatContainer.innerHTML = "";
    history.forEach(item => {
      if (item.role === "user") {
        appendUserBubble(item.content);
      } else if (item.role === "assistant") {
        try {
          const plan = JSON.parse(item.content);
          if (plan.message) {
            appendAgentBubble(plan.message);
          }
          if (plan.action && plan.action !== "chat_response") {
            let details = plan.url || plan.selector || "";
            if (plan.action === "github_api" && plan.github_api_opts) {
              details = `${plan.github_api_opts.method} ${plan.github_api_opts.path}`;
            }
            const block = appendActionBlock(plan.action, details);
            const resEl = block.querySelector(".action-result");
            if (resEl) {
              resEl.textContent = "Completed";
              resEl.style.color = "var(--accent-emerald)";
            }
          }
        } catch(e) {
          appendAgentBubble(item.content);
        }
      }
    });
  }

  const transparentCache = {};

  function getTransparentImage(imgUrl) {
    if (transparentCache[imgUrl]) {
      return Promise.resolve(transparentCache[imgUrl]);
    }
    
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imgUrl;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        
        // Loop through pixels and convert solid black/near-black pixels to transparent
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          
          // Threshold check: R, G, B below 40 are treated as background
          if (r < 40 && g < 40 && b < 40) {
            data[i+3] = 0;
          }
        }
        
        ctx.putImageData(imgData, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        transparentCache[imgUrl] = dataUrl;
        resolve(dataUrl);
      };
      img.onerror = () => {
        resolve(imgUrl); // Fallback to raw path
      };
    });
  }

  function renderAgentsList() {
    agentsListContainer.innerHTML = "";
    agentsList.forEach((agent, index) => {
      const el = document.createElement("div");
      el.className = `agent-item ${index === activeAgentIndex ? 'active' : ''}`;
      el.title = `Switch to Monkey Agent ${index + 1}`;
      el.innerHTML = `
        <img class="monkey-sprite" src="" style="width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: none;">
        <button class="delete-agent-btn" title="Delete Agent">×</button>
      `;
      
      const imgPath = agent.image || 'assets/monkey_cyan.png';
      if (imgPath.includes("cyan")) {
        el.classList.add("style-cyan");
      } else if (imgPath.includes("magenta")) {
        el.classList.add("style-magenta");
      } else if (imgPath.includes("gold")) {
        el.classList.add("style-gold");
      }

      getTransparentImage(imgPath).then(transparentUrl => {
        const sprite = el.querySelector(".monkey-sprite");
        if (sprite) {
          sprite.src = transparentUrl;
          sprite.style.display = "block";
        }
      });
      
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-agent-btn")) {
          e.stopPropagation();
          deleteAgentSession(index);
          return;
        }
        switchActiveAgentSession(index);
      });
      agentsListContainer.appendChild(el);
    });
  }

  function switchActiveAgentSession(index) {
    if (index === activeAgentIndex) return;
    
    // Save current session properties
    if (activeAgent) {
      agentsList[activeAgentIndex].history = activeAgent.history;
      agentsList[activeAgentIndex].targetTabId = activeAgent.targetTabId;
    }
    agentsList[activeAgentIndex].logsMarkdown = logsMarkdown;
    
    activeAgentIndex = index;
    activeAgent = null; // Instantiated fresh on next send
    
    saveSessionsToStorage();
    renderAgentsList();
    restoreActiveAgentSession();
  }

  function deleteAgentSession(index) {
    const deleted = agentsList.splice(index, 1)[0];
    
    // Clean up webpage stop overlay if it's the active one
    if (index === activeAgentIndex && activeAgent) {
      try {
        activeAgent.removeStopOverlay();
      } catch(e) {}
      activeAgent = null;
    }
    
    if (agentsList.length === 0) {
      agentsList = [{
        id: Date.now(),
        emoji: "🐒",
        image: "assets/monkey_cyan.png",
        history: [],
        currentPrompt: "",
        targetTabId: null,
        logsMarkdown: "# Execution Logs\n"
      }];
      activeAgentIndex = 0;
    } else {
      if (activeAgentIndex >= agentsList.length) {
        activeAgentIndex = agentsList.length - 1;
      }
    }
    
    saveSessionsToStorage();
    renderAgentsList();
    restoreActiveAgentSession();
  }

  function restoreActiveAgentSession() {
    const session = agentsList[activeAgentIndex];
    logsMarkdown = session.logsMarkdown || "# Execution Logs\n";
    isRunning = false;
    btnKill.classList.add("hidden");
    btnStart.innerHTML = "↑";
    setHudStatus("ready");
    planPanel.classList.add("hidden");
    
    // Set target tab to settings if stored
    chrome.storage.local.set({ targetTabId: session.targetTabId });
    
    restoreConversation(session.history || []);
  }

  function saveSessionsToStorage() {
    const serializable = agentsList.map(a => ({
      id: a.id,
      emoji: a.emoji,
      image: a.image,
      history: a.history,
      currentPrompt: a.currentPrompt,
      targetTabId: a.targetTabId,
      logsMarkdown: a.logsMarkdown
    }));
    chrome.storage.local.set({
      agentsList: serializable,
      activeAgentIndex: activeAgentIndex
    });
  }

  // Spawn New Monkey Agent Button Listener
  const monkeyAssets = ["assets/monkey_cyan.png", "assets/monkey_magenta.png", "assets/monkey_gold.png"];
  btnNewAgent.addEventListener("click", () => {
    if (activeAgent) {
      agentsList[activeAgentIndex].history = activeAgent.history;
      agentsList[activeAgentIndex].targetTabId = activeAgent.targetTabId;
    }
    agentsList[activeAgentIndex].logsMarkdown = logsMarkdown;

    const newImage = monkeyAssets[agentsList.length % monkeyAssets.length];
    const newSession = {
      id: Date.now(),
      emoji: "🐒",
      image: newImage,
      history: [],
      currentPrompt: "",
      targetTabId: null,
      logsMarkdown: "# Execution Logs\n"
    };
    agentsList.push(newSession);
    activeAgentIndex = agentsList.length - 1;
    activeAgent = null;

    saveSessionsToStorage();
    renderAgentsList();
    restoreActiveAgentSession();
  });

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
    console.log(text);
    logsMarkdown += `\n${text}`;
    
    if (text.startsWith("Proposed action: ")) {
      try {
        const jsonStr = text.substring("Proposed action: ".length);
        const plan = JSON.parse(jsonStr);
        if (plan.action && plan.action !== "chat_response") {
          let details = "";
          if (plan.action === "navigate" || plan.action === "open_tab") details = plan.url;
          else if (plan.action === "click_element" || plan.action === "type_text") details = `${plan.selector} ${plan.text ? `("${plan.text}")` : ""}`;
          else if (plan.action === "github_api" && plan.github_api_opts) details = `${plan.github_api_opts.method} ${plan.github_api_opts.path}`;
          else if (plan.action === "group_tabs") details = plan.title;
          else details = JSON.stringify(plan);
          
          currentActionBlock = appendActionBlock(plan.action, details);
        }
      } catch(e) {}
    } else if (text.startsWith("Result: ") || text.startsWith("Execution Blocked: ")) {
      if (currentActionBlock) {
        const resEl = currentActionBlock.querySelector(".action-result");
        if (resEl) {
          resEl.textContent = text;
          if (text.includes("Error") || text.includes("Blocked") || text.includes("not found")) {
            resEl.style.color = "#ef4444";
          } else {
            resEl.style.color = "var(--accent-emerald)";
          }
        }
        currentActionBlock = null;
      }
    }
  }

  let promptQueue = [];

  // Submit / Send action
  btnStart.addEventListener("click", async () => {
    const promptText = promptInput.value.trim();
    if (!promptText) return;

    appendUserBubble(promptText);
    promptInput.value = "";

    if (isRunning) {
      promptQueue.push(promptText);
      appendSystemBubble(`Prompt queued: "${promptText}"`);
      return;
    }

    isRunning = true;
    btnKill.classList.remove("hidden");
    btnStart.innerHTML = "⏳";
    setHudStatus("running");
    runAgentTurn(promptText);
  });

  // Handle Enter key inside textarea and Ctrl+C shortcut to abort
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      btnStart.click();
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      resetAgentSession();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || planPanel.classList.contains("hidden")) return;
    e.preventDefault();
    btnReject.click();
  });

  async function runAgentTurn(promptText) {
    const config = await new Promise((resolve) => {
      chrome.storage.local.get([
        "apiKey", "encryptedKey", "model", "baseUrl", "speed", "domainLock", "bypassHoneypot", "goCrazy", "routingRules", "githubToken"
      ], resolve);
    });

    let apiKey = config.apiKey || DEFAULT_KEY;

    const session = agentsList[activeAgentIndex];

    // Create or retain existing agent session for stateful memory
    if (!activeAgent) {
      activeAgent = new ChromeAgent(
        apiKey,
        config.model,
        writeLog,
        handleApprovalRequired,
        { 
          ...config, 
          isCancelled: () => !isRunning,
          history: session.history || [],
          targetTabId: session.targetTabId || null
        }
      );
    } else {
      // Append new message manually if the agent is already instantiated
      activeAgent.history.push({
        role: "user",
        content: promptText
      });
    }

    const mode = runModeSelect.value;
    activeAgent.currentMode = mode;

    try {
      let result = await activeAgent.runPrompt(promptText, mode);
      
      while (isRunning) {
        if (result === "chat_response") {
          if (activeAgent.lastMessage) {
            appendAgentBubble(activeAgent.lastMessage);
          }
          isRunning = false;
          btnKill.classList.add("hidden");
          btnStart.innerHTML = "↑";
          setHudStatus("ready");
          
          session.history = activeAgent.history;
          session.targetTabId = activeAgent.targetTabId;
          session.logsMarkdown = logsMarkdown;
          saveSessionsToStorage();
          break;
        }
        if (result === "finish") {
          if (activeAgent.lastMessage) {
            appendAgentBubble(activeAgent.lastMessage);
          } else {
            appendAgentBubble("Task completed!");
          }
          
          session.history = activeAgent.history;
          session.targetTabId = activeAgent.targetTabId;
          session.logsMarkdown = logsMarkdown;
          saveSessionsToStorage();

          if (promptQueue.length > 0) {
            const nextPrompt = promptQueue.shift();
            appendSystemBubble(`Starting next queued prompt: "${nextPrompt}"`);
            
            // Clear current agent state to create a fresh new instance for the next prompt
            activeAgent = null;
            setTimeout(() => runAgentTurn(nextPrompt), 1000);
          } else {
            isRunning = false;
            btnKill.classList.add("hidden");
            btnStart.innerHTML = "↑";
            setHudStatus("ready");
          }
          break;
        }
        if (result === "pending_approval" || result === "aborted") {
          isRunning = false;
          btnKill.classList.add("hidden");
          btnStart.innerHTML = "↑";
          setHudStatus(result === "pending_approval" ? "waiting" : "ready");
          
          session.history = activeAgent.history;
          session.targetTabId = activeAgent.targetTabId;
          session.logsMarkdown = logsMarkdown;
          saveSessionsToStorage();
          break;
        }
      }
      
      // Sync log
      try {
        await syncLogToServer({
          timestamp: Date.now(),
          prompt: promptText,
          action: activeAgent.pendingAction ? activeAgent.pendingAction.action : "step_complete",
          status: "success"
        });
      } catch(e) {}
    } catch (err) {
      appendSystemBubble(`Stopped due to error: ${err.message}`);
      isRunning = false;
      btnKill.classList.add("hidden");
      btnStart.innerHTML = "↑";
      setHudStatus("ready");
      try {
        await syncLogToServer({
          timestamp: Date.now(),
          prompt: promptText,
          action: "error",
          status: "failure",
          message: err.message
        });
      } catch(e) {}
    }
  }

  // Interactive Plan Handlers (Approval Mode)
  function handleApprovalRequired(plan) {
    planPanel.classList.remove("hidden");
    planTextarea.value = JSON.stringify(plan, null, 2);
    setHudStatus("waiting");
  }

  btnApprove.addEventListener("click", async () => {
    planPanel.classList.add("hidden");
    if (activeAgent) {
      try {
        const editedPlan = JSON.parse(planTextarea.value);
        activeAgent.pendingAction = editedPlan;

        const res = await activeAgent.executePending();
        
        if (res === "chat_response") {
          appendAgentBubble(activeAgent.lastMessage);
          isRunning = false;
          btnKill.classList.add("hidden");
          btnStart.innerHTML = "↑";
          setHudStatus("ready");
          
          const session = agentsList[activeAgentIndex];
          session.history = activeAgent.history;
          session.targetTabId = activeAgent.targetTabId;
          session.logsMarkdown = logsMarkdown;
          saveSessionsToStorage();
        }
        else if (res === "finish") {
          appendAgentBubble(activeAgent.lastMessage || "Task completed!");
          isRunning = false;
          btnKill.classList.add("hidden");
          btnStart.innerHTML = "↑";
          setHudStatus("ready");
          
          const session = agentsList[activeAgentIndex];
          session.history = activeAgent.history;
          session.targetTabId = activeAgent.targetTabId;
          session.logsMarkdown = logsMarkdown;
          saveSessionsToStorage();
        }
        else if (isRunning) {
          // If we had more steps, keep running
          btnKill.classList.remove("hidden");
          btnStart.innerHTML = "⏳";
          setHudStatus("running");
          runAgentTurn(activeAgent.currentPrompt);
        }
      } catch (err) {
        appendSystemBubble(`Execution or JSON parse error: ${err.message}`);
        isRunning = false;
        btnKill.classList.add("hidden");
        btnStart.innerHTML = "↑";
        setHudStatus("ready");
      }
    }
  });

  btnReject.addEventListener("click", () => {
    planPanel.classList.add("hidden");
    appendSystemBubble("Action proposal rejected. Execution paused.");
    isRunning = false;
    btnKill.classList.add("hidden");
    btnStart.innerHTML = "↑";
    setHudStatus("paused");
  });

  // Export logs to Markdown
  btnExportLogs.addEventListener("click", () => {
    const blob = new Blob([logsMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-chat-log-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    appendSystemBubble("Logs exported successfully.");
  });

  // Manual Tab Grouping
  btnGroupTabs.addEventListener("click", async () => {
    appendSystemBubble("Grouping open tabs by domain name...");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = {};
    tabs.forEach(tab => {
      try {
        if (!tab.url) return;
        const domain = new URL(tab.url).hostname;
        if (domain && !domain.startsWith("chrome")) {
          if (!groups[domain]) groups[domain] = [];
          groups[domain].push(tab.id);
        }
      } catch(e) {}
    });
    let groupedCount = 0;
    for (const [domain, tabIds] of Object.entries(groups)) {
      if (tabIds.length > 1) {
        try {
          const groupId = await chrome.tabs.group({ tabIds });
          const colors = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
          const randomColor = colors[Math.floor(Math.random() * colors.length)];
          await chrome.tabGroups.update(groupId, { title: domain, color: randomColor });
          groupedCount += tabIds.length;
        } catch(e) {}
      }
    }
    appendSystemBubble(`Successfully grouped ${groupedCount} tabs by domain.`);
  });

  function resetAgentSession() {
    isRunning = false;
    promptQueue = []; // Reset queue
    promptInput.value = ""; // Clear input textarea
    planPanel.classList.add("hidden");
    btnKill.classList.add("hidden");
    btnStart.innerHTML = "↑";
    setHudStatus("ready");
    
    // Clear chat UI and reset log markdown
    chatContainer.innerHTML = `
      <div class="message-row agent">
        <div class="chat-bubble agent">
          Hi! I'm MonkeyPilot. Tell me what you'd like to do, and I'll talk back and coordinate the browser or GitHub API to make it happen! 🐒
        </div>
      </div>
    `;
    logsMarkdown = "# Execution Logs\n";
    
    if (activeAgent) {
      try {
        activeAgent.removeStopOverlay();
      } catch(e) {}
    }

    activeAgent = null;

    const session = agentsList[activeAgentIndex];
    session.history = [];
    session.targetTabId = null;
    session.logsMarkdown = "# Execution Logs\n";
    saveSessionsToStorage();
  }

  // Stop/Kill Agent
  btnKill.addEventListener("click", resetAgentSession);

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function syncLogToServer(logData) {
    try {
      await fetch("http://localhost:5000/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(logData)
      });
    } catch(err) {
      console.warn("Failed to sync log to server:", err);
    }
  }

  // Poll state to dynamically sync the 'working' class for active running agent
  setInterval(() => {
    const agentItems = agentsListContainer.querySelectorAll(".agent-item");
    agentItems.forEach((el, index) => {
      const isCurrentlyWorking = (index === activeAgentIndex && isRunning);
      if (isCurrentlyWorking && !el.classList.contains("working")) {
        el.classList.add("working");
      } else if (!isCurrentlyWorking && el.classList.contains("working")) {
        el.classList.remove("working");
      }
    });
  }, 100);
});
