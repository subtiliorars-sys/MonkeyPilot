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
    
    this.githubToken = settings.githubToken || "";
    
    this.history = [];
    this.pendingAction = null;
    this.actionHistory = [];
    this.lockedDomain = "";
    this.targetTabId = settings.targetTabId || null;
    this.lastMessage = "";
  }

  async getTargetTabId() {
    if (this.targetTabId) {
      try {
        const tab = await chrome.tabs.get(this.targetTabId);
        if (tab) return this.targetTabId;
      } catch (err) {}
    }
    
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab) {
      this.targetTabId = activeTab.id;
      return this.targetTabId;
    }
    return null;
  }

  async runPrompt(prompt, mode) {
    this.actionHistory = []; // Reset loop detection history for the new turn
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
    this.log(`\n>>> [Agent Starting Chat]: "${prompt}" (using ${this.activeModel})`);
    
    // Save domain focus lock target if enabled
    if (this.domainLockEnabled) {
      const tabId = await this.getTargetTabId();
      if (tabId) {
        try {
          const activeTab = await chrome.tabs.get(tabId);
          if (activeTab && activeTab.url) {
            this.lockedDomain = new URL(activeTab.url).hostname;
            this.log(`Domain lock enabled for: ${this.lockedDomain}`);
          }
        } catch(e) {}
      }
    }

    this.currentPrompt = prompt;
    if (!this.history || this.history.length === 0) {
      this.history = [
        {
          role: "system",
          content: `You are MonkeyPilot, a highly aggressive, self-correcting, autonomous browser co-pilot. You chat with the user and automate browser actions or run GitHub API calls to help them.
You must output exactly ONE JSON object per turn.

Your response JSON MUST follow this schema:
{
  "message": "Conversational message, thoughts, questions, or progress update to display directly to the user.",
  "action": "chat_response" | "navigate" | "open_tab" | "group_tabs" | "read_page" | "click_element" | "type_text" | "github_api" | "spawn_subagent" | "finish",
  "url": "https://...", // Required for 'navigate' and 'open_tab'
  "title": "Group Title", // Required for 'group_tabs'
  "color": "blue"|"red"|"yellow"|..., // Optional for 'group_tabs'
  "selector": "css selector", // Required for 'click_element' and 'type_text'
  "text": "text to type", // Required for 'type_text'
  "subagent_prompt": "Prompt task for the child subagent to perform", // Required for 'spawn_subagent'
  "github_api_opts": { // Required for 'github_api'
    "method": "GET"|"POST"|"PATCH"|"DELETE",
    "path": "/repos/username/repo/issues", // Endpoint path (e.g. /user/repos or /repos/owner/repo/contents/path)
    "body": {} // Optional JSON body payload
  }
}

CRITICAL AUTONOMY RULES & 12-STEP SELF-HEALING LOOP:
Apply this 12-Step Cycle on every execution turn to ensure accountability, transparency, and self-healing:
1. ADMISSION: Immediately admit when a browser action fails, navigates to a dead page, or gets blocked. Do not pretend it succeeded.
2. HELP: Trust that your search queries and self-correction code can restore page context.
3. ALIGNMENT: Submit your execution will entirely to the user's primary goal parameters.
4. INVENTORY: Conduct a searching, fearless DOM inventory of the page layout (read_page) to identify loop blockers and honeypots.
5. CONFESSION: Admit the exact failure reason (wrong selector, dead URL) directly to the execution logs.
6. WILLINGNESS: Be entirely ready to abandon broken URLs or malfunctioning selector paths.
7. HUMILITY: Humbly adjust your CSS selectors, query inputs, and navigation targets.
8. AMENDS-LIST: Track all failed elements, redirects, and traps you've encountered so you don't repeat them.
9. AMENDS-ACTION: Make direct amends by clearing input fields, scrolling to view, and recovering active page state.
10. EVALUATION: Continue to take real-time action inventory, and when you are wrong, promptly admit it and change course.
11. MEDITATION: Read the page content recursively (meditate on the DOM) to align your selector matchers.
12. AWAKENING: Carry out the task successfully, organize the active tabs cleanly, and deliver a transparent log of what you did.

Do not yield control or call "chat_response" on errors; execute the 12-step healing cycle autonomously until you achieve the goal.

THE 12 TRADITIONS OF COOPERATION & ANONYMITY:
1. COMMON WELFARE: Prioritize overall session and page loading stability above speed.
2. SERVANT AUTHORITY: Defer all final actions to the user's instructions. You are a servant, not a decision-maker.
3. INCLUSIVENESS: Accept any web search query or GitHub API request without bias.
4. TAB AUTONOMY: Keep your work organized inside your designated '🐒 MonkeyPilot' tab group, leaving the user's other workspace tabs completely undisturbed.
5. PRIMARY PURPOSE: Focus on one primary purpose—successfully completing the browser task at hand.
6. NO ENDORSEMENT: Never endorse, advertise, or link to outside products, services, or self-promotional text.
7. SELF-SUPPORTING: Rely entirely on your native DOM scripts, styling rules, and API payloads without requesting external libraries.
8. SIMPLICITY: Keep execution code actions direct, simple, and transparent instead of building over-engineered solutions.
9. DECENTRALIZATION: Maintain a flat, reactive execution loop rather than creating heavy, rigid state hierarchies.
10. NEUTRALITY: Hold no opinions on non-task topics. Stay completely focused on browser logs and DOM structures.
11. ATTRACTION & ANONYMITY: Never self-promote, boast, or praise your own capability in chat messages. Let the accuracy and cleanliness of your final execution results attract approval.
12. ANONYMITY FOUNDATION: Place task execution principles before conversational personalities. Keep chat updates concise, helpful, and professional.

SUBAGENT RULES:
1. Use "spawn_subagent" when a complex task can be split into independent sub-tasks (e.g., comparing data from two separate sites, scraping multiple targets in parallel).
2. The subagent runs in a fresh instance, executes the subagent_prompt, and returns a summary result to you.

CONCISENESS RULES:
1. Avoid verbose descriptions of simple steps in "message". Keep your chat replies and thoughts concise and focused. Let the animated monkey paw overlays demonstrate your active interactions.

4. CRITICAL: Output ONLY valid JSON matching the schema. Do not output markdown, code blocks, or explanations outside the JSON.
5. CRITICAL: Do not attempt to click or type into invisible or hidden elements.
6. CRITICAL: Do not repeat passive actions consecutively if the page content did not change.`
        },
        {
          role: "user",
          content: prompt
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
      this.lastMessage = plan.message;
      this.log(`Proposed action: ${JSON.stringify(plan)}`);

      if (plan.action !== "chat_response" && mode === "plan") {
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

    if (plan.action !== "chat_response" && plan.action !== "finish") {
      await this.injectStopOverlay();
    }

    // Loop detection to prevent credit waste
    if (plan.action !== "chat_response" && plan.action !== "read_page") {
      const sig = `${plan.action}-${plan.selector || ""}-${plan.url || ""}-${plan.text || ""}`;
      this.actionHistory.push(sig);
      if (this.actionHistory.length > 5) {
        this.actionHistory.shift();
      }
      if (this.actionHistory.length >= 3 && this.actionHistory.slice(-3).every(val => val === sig)) {
        this.log("⚠️ WARNING: Detected potential infinite loop repeating the exact same action. Pausing execution.");
        throw new Error("Loop detected: The agent is repeating the same browser action.");
      }
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

        const tabId = await this.getTargetTabId();
        if (tabId) {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "NAVIGATE_TAB", tabId: tabId, url: plan.url }, resolve);
          });
          resultText = `Navigated tab to ${plan.url}`;
        } else {
          resultText = "No target tab found to navigate.";
        }
      }
      else if (plan.action === "open_tab") {
        const tab = await new Promise((resolve) => {
          chrome.tabs.create({ url: plan.url }, resolve);
        });
        
        this.targetTabId = tab.id; // Switch tracking to the new tab
        
        const data = await new Promise((resolve) => {
          chrome.storage.local.get(["monkeyPilotGroupId"], resolve);
        });
        
        if (data.monkeyPilotGroupId) {
          try {
            await chrome.tabs.group({ tabIds: [tab.id], groupId: data.monkeyPilotGroupId });
          } catch(err) {
            // Group might have been closed, recreate it
            await new Promise((resolve) => {
              chrome.tabs.group({ tabIds: [tab.id] }, (newGroupId) => {
                chrome.tabGroups.update(newGroupId, { title: "🐒 MonkeyPilot", color: "orange" }, () => {
                  chrome.storage.local.set({ monkeyPilotGroupId: newGroupId }, resolve);
                });
              });
            });
          }
        } else {
          await new Promise((resolve) => {
            chrome.tabs.group({ tabIds: [tab.id] }, (newGroupId) => {
              chrome.tabGroups.update(newGroupId, { title: "🐒 MonkeyPilot", color: "orange" }, () => {
                chrome.storage.local.set({ monkeyPilotGroupId: newGroupId }, resolve);
              });
            });
          });
        }
        resultText = `Opened new tab with URL: ${plan.url} and added to MonkeyPilot group.`;
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
        const tabId = await this.getTargetTabId();
        if (tabId) {
          try {
            // Recursive Shadow DOM & iframe text scraping script injection
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: async () => {
                // Quick scroll to trigger lazy loading dynamic content
                window.scrollTo(0, document.body.scrollHeight / 3);
                await new Promise(r => setTimeout(r, 150));
                window.scrollTo(0, document.body.scrollHeight * 2 / 3);
                await new Promise(r => setTimeout(r, 150));
                window.scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 100));

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
            resultText = `Read page content (recursive DOM). Excerpt:\n"${textContent.slice(0, 12000)}..."`;
          } catch(err) {
            resultText = `Failed to read page content: ${err.message}. (The active page may be displaying a network/404 error page, loading, or not accessible)`;
          }
        } else {
          resultText = "No active tab found to read.";
        }
      } 
      else if (plan.action === "click_element") {
        const tabId = await this.getTargetTabId();
        if (tabId) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              args: [plan.selector, this.bypassHoneypot || this.goCrazy, this.goCrazy],
              func: async (selector, bypassHoneypot, goCrazy) => {
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
                  el.scrollIntoView({ behavior: "instant", block: "center" });

                  // Visual Monkey Paw Click Cursor
                  const rect = el.getBoundingClientRect();
                  const paw = document.createElement("div");
                  paw.id = "monkeypilot-paw-cursor";
                  paw.innerHTML = "🦧🐾";
                  paw.style.position = "fixed";
                  paw.style.left = (rect.left + rect.width / 2) + "px";
                  paw.style.top = (rect.top + rect.height / 2) + "px";
                  paw.style.fontSize = "36px";
                  paw.style.zIndex = "10000000";
                  paw.style.pointerEvents = "none";
                  paw.style.transition = "all 0.3s ease-out";
                  paw.style.transform = "translate(-50%, -50%) scale(2.0)";
                  paw.style.textShadow = "0 0 12px rgba(251, 191, 36, 0.85)";
                  paw.style.display = "block";
                  paw.style.visibility = "visible";
                  paw.style.opacity = "1";
                  document.body.appendChild(paw);
                  
                  await new Promise(r => setTimeout(r, 150));
                  paw.style.transform = "translate(-50%, -50%) scale(1.0)";
                  await new Promise(r => setTimeout(r, 350));
                  
                  // Fade out after click executes
                  setTimeout(() => {
                    paw.style.opacity = "0";
                    setTimeout(() => paw.remove(), 300);
                  }, 300);

                  if (goCrazy) {
                    el.click();
                    return true;
                  }
                  el.focus();
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
          } catch(err) {
            resultText = `Failed to click element: ${err.message}. (The active page may be displaying an error, loading, or not accessible)`;
          }
        } else {
          resultText = "No active tab found to interact with.";
        }
      } 
      else if (plan.action === "type_text") {
        const tabId = await this.getTargetTabId();
        if (tabId) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
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
                  el.scrollIntoView({ behavior: "instant", block: "center" });

                  // Visual Monkey Paw Type Cursor
                  const rect = el.getBoundingClientRect();
                  const paw = document.createElement("div");
                  paw.id = "monkeypilot-paw-cursor";
                  paw.innerHTML = "🦧🐾";
                  paw.style.position = "fixed";
                  paw.style.left = (rect.left + rect.width / 2) + "px";
                  paw.style.top = (rect.top + rect.height / 2) + "px";
                  paw.style.fontSize = "36px";
                  paw.style.zIndex = "10000000";
                  paw.style.pointerEvents = "none";
                  paw.style.transition = "all 0.3s ease-out";
                  paw.style.transform = "translate(-50%, -50%) scale(2.0)";
                  paw.style.textShadow = "0 0 12px rgba(251, 191, 36, 0.85)";
                  paw.style.display = "block";
                  paw.style.visibility = "visible";
                  paw.style.opacity = "1";
                  document.body.appendChild(paw);
                  
                  await new Promise(r => setTimeout(r, 150));
                  paw.style.transform = "translate(-50%, -50%) scale(1.0)";
                  await new Promise(r => setTimeout(r, 200));

                  if (goCrazy) {
                    el.click();
                    paw.remove();
                    return true;
                  }
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
                  
                  // Fade out after typing completes
                  paw.style.opacity = "0";
                  setTimeout(() => paw.remove(), 300);
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
          } catch(err) {
            resultText = `Failed to type text: ${err.message}. (The active page may be displaying an error, loading, or not accessible)`;
          }
        } else {
          resultText = "No active tab found to interact with.";
        }
      } 
      else if (plan.action === "chat_response") {
        this.lastMessage = plan.message;
        resultText = "Replied to user: " + plan.message;
        this.log(`Chat Response: ${plan.message}`);
        this.history.push({
          role: "assistant",
          content: JSON.stringify(plan)
        });
        // Persist state
        chrome.storage.local.set({
          activeAgentState: {
            history: this.history,
            activeModel: this.activeModel,
            prompt: this.currentPrompt,
            targetTabId: this.targetTabId
          }
        });
        return "chat_response";
      }
      else if (plan.action === "github_api") {
        if (!this.githubToken) {
          throw new Error("GitHub Token not found. Please set your token in settings.");
        }
        const opts = plan.github_api_opts || {};
        const method = opts.method || "GET";
        const path = opts.path || "";
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        const url = `https://api.github.com${cleanPath}`;

        const headers = {
          "Authorization": `token ${this.githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        };

        const fetchParams = { method, headers };
        if (opts.body && ["POST", "PATCH", "PUT"].includes(method)) {
          fetchParams.body = JSON.stringify(opts.body);
        }

        this.log(`GitHub API Calling: ${method} ${url}`);
        const response = await fetch(url, fetchParams);
        const resText = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(resText);
        } catch(e) {
          parsed = resText;
        }

        if (!response.ok) {
          throw new Error(`GitHub API error (${response.status}): ${typeof parsed === "object" ? JSON.stringify(parsed) : parsed}`);
        }

        resultText = `GitHub API Response (${response.status}): ` + (typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 1000) : String(parsed).slice(0, 1000));
      }
      else if (plan.action === "spawn_subagent") {
        this.log(`\n🤖 [Spawning Subagent]: "${plan.subagent_prompt}"`);
        try {
          const subAgent = new ChromeAgent(this.apiKey, this.model, this.log, this.approvalRequired, {
            baseUrl: this.baseUrl,
            speed: this.stepDelay,
            domainLock: false,
            bypassHoneypot: this.bypassHoneypot,
            goCrazy: this.goCrazy,
            githubToken: this.githubToken,
            targetTabId: this.targetTabId
          });
          await subAgent.runPrompt(plan.subagent_prompt, "auto");
          resultText = `Subagent task completed. Result: ${subAgent.lastMessage || "Success"}`;
        } catch(err) {
          resultText = `Subagent task failed: ${err.message}`;
        }
      }
      else if (plan.action === "finish") {
        this.lastMessage = plan.message;
        await this.removeStopOverlay();
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
          prompt: this.currentPrompt,
          targetTabId: this.targetTabId
        }
      });

      return this.step(this.currentMode);
    } catch (err) {
      this.log(`Execution Error: ${err.message}`);
      throw err;
    }
  }

  async injectStopOverlay() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && activeTab.url && !activeTab.url.startsWith("chrome")) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            if (document.getElementById("monkeypilot-stop-overlay")) return;
            const div = document.createElement("div");
            div.id = "monkeypilot-stop-overlay";
            div.style.position = "fixed";
            div.style.bottom = "30px";
            div.style.left = "50%";
            div.style.transform = "translateX(-50%)";
            div.style.zIndex = "10000000";
            div.style.backgroundColor = "rgba(11, 15, 25, 0.75)";
            div.style.backdropFilter = "blur(8px)";
            div.style.webkitBackdropFilter = "blur(8px)";
            div.style.border = "1px solid rgba(251, 191, 36, 0.4)";
            div.style.borderRadius = "20px";
            div.style.padding = "6px 14px";
            div.style.boxShadow = "0 8px 32px rgba(0,0,0,0.3)";
            div.style.display = "flex";
            div.style.alignItems = "center";
            div.style.gap = "12px";
            div.style.fontFamily = "system-ui, -apple-system, sans-serif";
            div.style.fontSize = "12px";
            div.style.color = "#f1f5f9";
            div.style.userSelect = "none";
            
            div.innerHTML = `
              <span style="font-weight: 500; display: flex; align-items: center; gap: 4px;">🐒 MonkeyPilot is running...</span>
              <button id="monkeypilot-stop-btn" style="background-color: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 12px; font-weight: 600; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 3px; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2); transition: all 0.2s;">Abort 🍌</button>
            `;
            document.body.appendChild(div);
            
            document.getElementById("monkeypilot-stop-btn").addEventListener("click", () => {
              chrome.runtime.sendMessage({ type: "STOP_AGENT" });
              div.remove();
            });
          }
        });
      } catch(e) {}
    }
  }

  async removeStopOverlay() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && activeTab.url && !activeTab.url.startsWith("chrome")) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const el = document.getElementById("monkeypilot-stop-overlay");
            if (el) el.remove();
          }
        });
      } catch(e) {}
    }
  }
}
