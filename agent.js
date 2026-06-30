// agent.js - AI Browser Reasoning Agent with Advanced Logic

class ChromeAgent {
  constructor(apiKey, model, logCallback, approvalRequiredCallback, settings = {}) {
    this.apiKey = apiKey;
    this.model = model || "auto";
    this.log = logCallback;
    this.approvalRequired = approvalRequiredCallback;
    
    // Settings configuration
    this.baseUrl = settings.baseUrl || "https://openrouter.ai/api/v1";
    this.stepDelay = parseInt(settings.speed || "500");
    this.domainLockEnabled = !!settings.domainLock;
    this.routingRules = settings.routingRules || {};
    this.bypassHoneypot = !!settings.bypassHoneypot;
    this.isCancelled = settings.isCancelled || (() => false);
    this.goCrazy = !!settings.goCrazy;
    
    this.history = [];
    this.pendingAction = null;
    this.actionHistory = [];
    this.lockedDomain = "";
  }

  async runPrompt(prompt, mode) {
    // Custom routing rules check
    let targetModel = this.model;
    if (this.model === "auto") {
      const matchedRule = Object.keys(this.routingRules).find(keyword => 
        prompt.toLowerCase().includes(keyword.toLowerCase())
      );
      if (matchedRule) {
        targetModel = this.routingRules[matchedRule];
        this.log(`Custom routing rule matched keyword "${matchedRule}" -> routed to ${targetModel}`);
      } else {
        targetModel = await this.autoSelectModel(prompt);
      }
    }
    
    this.activeModel = targetModel;
    this.log(`\n>>> [Agent Starting Prompt]: "${prompt}" (using ${this.activeModel})`);
    
    // Save domain focus lock target if enabled
    if (this.domainLockEnabled) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && activeTab.url) {
        try {
          this.lockedDomain = new URL(activeTab.url).hostname;
          this.log(`Domain lock enabled for: ${this.lockedDomain}`);
        } catch(e) {}
      }
    }

    this.currentPrompt = prompt;
    if (!this.history || this.history.length === 0) {
      this.history = [
        {
          role: "system",
          content: `You are an agentic browser assistant. Your task is to achieve the user's objective using available actions.
You must choose exactly ONE action in JSON format per turn.

Available actions:
1. Navigate to URL in the active tab:
   {"action": "navigate", "url": "https://..."}
2. Open a new tab with the specified URL:
   {"action": "open_tab", "url": "https://..."}
3. Group all open tabs:
   {"action": "group_tabs", "title": "Group Name", "color": "blue"|"red"|"yellow"|"green"|"pink"|"purple"|"cyan"|"orange"}
4. Read the visible text content of the active tab:
   {"action": "read_page"}
5. Click a DOM element by selector:
   {"action": "click_element", "selector": "button.submit-class"}
6. Type text into a DOM element by selector:
   {"action": "type_text", "selector": "#input-id", "text": "text to type"}
7. Finalize/Finish the task:
   {"action": "finish", "message": "Explanation of what was accomplished"}

Output ONLY valid JSON matching one of the schemas above. Do not output markdown, code blocks, or explanations outside the JSON.

CRITICAL: Do not attempt to click or type into invisible, honeypot, or hidden elements (elements with opacity: 0, width/height: 0, or display: none). These are bot detection traps.
CRITICAL: Do not repeat passive actions (like 'read_page' or 'navigate') consecutively if the page content did not change. If you are stuck or cannot find further interactive elements, finalize by calling the 'finish' action and explaining the roadblock.`
      },
      {
        role: "user",
        content: `Objective: ${prompt}`
      }
    ];
    }

    return this.step(mode);
  }

  async autoSelectModel(prompt) {
    this.log("Auto-routing task: Fetching available models...");
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      const data = await response.json();
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid models list returned");
      }
      const popularModelIds = [
        "google/gemini-2.5-flash",
        "google/gemini-2.5-pro",
        "anthropic/claude-3.5-sonnet",
        "meta-llama/llama-3.3-70b-instruct",
        "deepseek/deepseek-chat",
        "deepseek/deepseek-reasoner",
        "openai/gpt-4o-mini",
        "openai/gpt-4o"
      ];
      const availablePopular = data.data
        .filter(m => popularModelIds.includes(m.id))
        .map(m => ({ id: m.id, name: m.name, description: m.description }));
      
      this.log("Classifying task complexity...");
      const routerResponse = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a model routing assistant. Given a user objective for a browser automation agent and a list of available models, choose the single best model ID.
If the objective is simple (like grouping tabs, navigation, simple site reads), choose a fast, cheap model (like deepseek/deepseek-chat or google/gemini-2.5-flash).
If the objective requires deep reasoning, multi-step planning, complex page analysis, or custom scripting, choose a high-capacity model (like google/gemini-2.5-pro or anthropic/claude-3.5-sonnet).

Available models:
${JSON.stringify(availablePopular, null, 2)}

Output ONLY the exact chosen model ID string (e.g. google/gemini-2.5-flash) and absolutely nothing else.`
            },
            {
              role: "user",
              content: `Objective: ${prompt}`
            }
          ],
          temperature: 0.0
        })
      });
      
      const routerData = await routerResponse.json();
      const chosenModel = routerData.choices[0].message.content.trim();
      this.log(`Model router selected: "${chosenModel}"`);
      return chosenModel;
    } catch (e) {
      this.log(`Auto-routing failed (${e.message}). Falling back to google/gemini-2.5-flash.`);
      return "google/gemini-2.5-flash";
    }
  }

  async step(mode) {
    if (this.isCancelled()) {
      this.log("Agent execution aborted by user.");
      return "aborted";
    }
    const candidateModels = [
      this.activeModel,
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.5-pro",
      "anthropic/claude-3.5-sonnet"
    ];
    const uniqCandidates = [...new Set(candidateModels.filter(Boolean))];

    let plan = null;
    let lastError = null;

    for (const currentModel of uniqCandidates) {
      try {
        this.log(`Consulting API using model: ${currentModel}...`);
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: currentModel,
            messages: this.history,
            temperature: 0.1
          })
        });

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error.message || "API completion failed");
        }

        const text = data.choices[0].message.content.trim();
        const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
        
        plan = JSON.parse(cleaned);
        this.activeModel = currentModel;
        break;
      } catch (e) {
        this.log(`Model "${currentModel}" failed: ${e.message}. Trying fallback...`);
        lastError = e;
      }
    }

    if (!plan) {
      throw new Error(`All candidate models failed. Last error: ${lastError ? lastError.message : "Unknown"}`);
    }

    try {
      this.pendingAction = plan;
      this.log(`Proposed action: ${JSON.stringify(plan)}`);

      if (mode === "plan") {
        this.approvalRequired(plan);
        return "pending_approval";
      } else {
        return await this.executePending();
      }
    } catch (e) {
      this.log(`Error: ${e.message}`);
      throw e;
    }
  }

  async executePending() {
    if (this.isCancelled()) {
      this.log("Agent execution aborted by user.");
      return "aborted";
    }
    if (!this.pendingAction) return;
    const plan = this.pendingAction;
    this.pendingAction = null;

    // Loop detection to prevent credit waste
    const sig = `${plan.action}-${plan.selector || ""}-${plan.url || ""}-${plan.text || ""}`;
    this.actionHistory.push(sig);
    if (this.actionHistory.length > 5) {
      this.actionHistory.shift();
    }
    if (this.actionHistory.length >= 3 && this.actionHistory.slice(-3).every(val => val === sig)) {
      this.log("⚠️ WARNING: Detected potential infinite loop repeating the exact same action. Pausing execution.");
      throw new Error("Loop detected: The agent is repeating the same browser action.");
    }

    // Jitter delay simulation
    if (this.stepDelay > 0 && !this.goCrazy) {
      await new Promise(r => setTimeout(r, this.stepDelay));
    }

    this.log(`Executing: ${plan.action}...`);
    let resultText = "";

    try {
      if (plan.action === "navigate") {
        // Domain Lock check
        if (this.domainLockEnabled && this.lockedDomain) {
          try {
            const destDomain = new URL(plan.url).hostname;
            if (destDomain !== this.lockedDomain) {
              throw new Error(`Navigation blocked: Target domain "${destDomain}" does not match locked domain "${this.lockedDomain}"`);
            }
          } catch(err) {
            throw new Error(`Navigation blocked: Invalid URL or Domain Focus lock active. ${err.message}`);
          }
        }

        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "NAVIGATE_TAB", tabId: activeTab.id, url: plan.url }, resolve);
          });
          resultText = `Navigated active tab to ${plan.url}`;
        } else {
          resultText = "No active tab found to navigate.";
        }
      }
      else if (plan.action === "open_tab") {
        const tab = await new Promise((resolve) => {
          chrome.tabs.create({ url: plan.url }, resolve);
        });
        resultText = `Opened new tab with URL: ${plan.url} (Tab ID: ${tab.id})`;
      }
      else if (plan.action === "group_tabs") {
        const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
        const tabIds = tabs.map(t => t.id);
        if (tabIds.length > 0) {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: "CREATE_TAB_GROUP",
              tabIds,
              title: plan.title,
              color: plan.color
            }, resolve);
          });
          resultText = `Grouped ${tabIds.length} tabs into group: "${plan.title}" (ID: ${res.groupId})`;
        } else {
          resultText = "No tabs found to group.";
        }
      } 
      else if (plan.action === "read_page") {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) {
          // Recursive Shadow DOM & iframe text scraping script injection
          const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              const scrape = (root) => {
                let text = "";
                // If PDF viewer page
                if (window.location.pathname.endsWith(".pdf") || document.querySelector("embed[type='application/pdf']")) {
                  return "PDF Document page: " + document.title + " (Raw PDF elements visible)";
                }
                
                // Traverse standard children
                const ignoredTags = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"];
                root.childNodes.forEach(node => {
                  if (node.nodeType === Node.TEXT_NODE) {
                    text += node.nodeValue.trim() + " ";
                  } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (ignoredTags.includes(node.tagName)) {
                      return;
                    }
                    if (node.tagName === "IFRAME") {
                      try {
                        text += scrape(node.contentDocument.body) + " ";
                      } catch(e) {}
                    } else {
                      text += scrape(node) + " ";
                      if (node.shadowRoot) {
                        text += scrape(node.shadowRoot) + " ";
                      }
                    }
                  }
                });
                return text;
              };
              return scrape(document.body).replace(/\s+/g, " ").trim();
            }
          });
          const textContent = results[0]?.result || "";
          resultText = `Read page content (recursive DOM). Excerpt:\n"${textContent.slice(0, 400)}..."`;
        } else {
          resultText = "No active tab found to read.";
        }
      } 
      else if (plan.action === "click_element") {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            args: [plan.selector, this.bypassHoneypot || this.goCrazy, this.goCrazy],
            func: (selector, bypassHoneypot, goCrazy) => {
              const deepQuery = (root, sel) => {
                const el = root.querySelector(sel);
                if (el) return el;
                let found = null;
                root.querySelectorAll("*").forEach(node => {
                  if (node.shadowRoot && !found) {
                    found = deepQuery(node.shadowRoot, sel);
                  }
                });
                return found;
              };
              const el = deepQuery(document, selector);
              if (el) {
                // Honeypot visibility check
                if (!bypassHoneypot) {
                  const style = window.getComputedStyle(el);
                  const rect = el.getBoundingClientRect();
                  const isHidden = style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || rect.width === 0 || rect.height === 0;
                  if (isHidden) {
                    return "HONEYPOT_BLOCKED";
                  }
                }
                if (goCrazy) {
                  el.click();
                  return true;
                }
                el.scrollIntoView({ behavior: "instant", block: "center" });
                el.focus();
                const rect = el.getBoundingClientRect();
                const x = rect.left + rect.width / 2 + (Math.random() - 0.5) * 5;
                const y = rect.top + rect.height / 2 + (Math.random() - 0.5) * 5;
                
                const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                el.dispatchEvent(new MouseEvent("mouseover", opts));
                el.dispatchEvent(new MouseEvent("mousemove", opts));
                el.dispatchEvent(new MouseEvent("mousedown", opts));
                el.dispatchEvent(new MouseEvent("mouseup", opts));
                el.dispatchEvent(new MouseEvent("click", opts));
                return true;
              }
              return false;
            }
          });
          const ok = results[0]?.result;
          if (ok === "HONEYPOT_BLOCKED") {
            resultText = `Execution Blocked: Element "${plan.selector}" is hidden/invisible. Action skipped to bypass Honeypot bot detection trap.`;
          } else {
            resultText = ok ? `Successfully clicked "${plan.selector}"` : `Element not found: "${plan.selector}"`;
          }
        } else {
          resultText = "No active tab found to interact with.";
        }
      } 
      else if (plan.action === "type_text") {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            args: [plan.selector, plan.text, this.bypassHoneypot || this.goCrazy, this.goCrazy],
            func: async (selector, val, bypassHoneypot, goCrazy) => {
              const deepQuery = (root, sel) => {
                const el = root.querySelector(sel);
                if (el) return el;
                let found = null;
                root.querySelectorAll("*").forEach(node => {
                  if (node.shadowRoot && !found) {
                    found = deepQuery(node.shadowRoot, sel);
                  }
                });
                return found;
              };
              const el = deepQuery(document, selector);
              if (el) {
                // Honeypot visibility check
                if (!bypassHoneypot) {
                  const style = window.getComputedStyle(el);
                  const rect = el.getBoundingClientRect();
                  const isHidden = style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || rect.width === 0 || rect.height === 0;
                  if (isHidden) {
                    return "HONEYPOT_BLOCKED";
                  }
                }
                if (goCrazy) {
                  el.click();
                  return true;
                }
                el.scrollIntoView({ behavior: "instant", block: "center" });
                el.focus();
                el.value = ""; // Clear existing
                
                const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                
                for (let i = 0; i < val.length; i++) {
                  const char = val[i];
                  const keyCode = char.charCodeAt(0);
                  
                  const keyOpts = { key: char, keyCode: keyCode, bubbles: true, cancelable: true };
                  el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
                  el.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
                  
                  el.value += char;
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  
                  el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
                  
                  // Human typing delay: 50ms - 150ms delay per keypress
                  await delay(50 + Math.random() * 100);
                }
                
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("blur", { bubbles: true }));
                return true;
              }
              return false;
            }
          });
          const ok = results[0]?.result;
          if (ok === "HONEYPOT_BLOCKED") {
            resultText = `Execution Blocked: Element "${plan.selector}" is hidden/invisible. Action skipped to bypass Honeypot bot detection trap.`;
          } else {
            resultText = ok ? `Typed text into "${plan.selector}"` : `Input element not found: "${plan.selector}"`;
          }
        } else {
          resultText = "No active tab found to interact with.";
        }
      } 
      else if (plan.action === "finish") {
        this.log(`\n>>> [Agent Completed Task]: ${plan.message}`);
        
        // Trigger completion screenshot capture
        try {
          const res = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" }, resolve);
          });
          if (res && res.dataUrl) {
            this.log(`[Screenshot Captured]`);
            this.lastScreenshot = res.dataUrl;
          }
        } catch(e) {
          this.log(`Failed to capture screenshot: ${e.message}`);
        }
        
        return "finish";
      }

      this.log(`Result: ${resultText}`);
      this.history.push({
        role: "assistant",
        content: JSON.stringify(plan)
      });
      this.history.push({
        role: "user",
        content: `Result of action: ${resultText}`
      });

      // Persist agent session state across potential reloads
      chrome.storage.local.set({
        activeAgentState: {
          history: this.history,
          activeModel: this.activeModel,
          prompt: this.currentPrompt
        }
      });

      return this.step(this.currentMode);
    } catch (err) {
      this.log(`Execution Error: ${err.message}`);
      throw err;
    }
  }
}
