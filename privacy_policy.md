# Privacy Policy for MonkeyPilot

MonkeyPilot is a private browser extension developed for internal team use. We value the privacy of our users.

### 1. Data Collection and Usage
MonkeyPilot does NOT collect, harvest, store, or transmit any user data, credentials, browsing history, or personal information. 
- All browser automation steps, text typing simulation, and element clicking occur entirely locally inside your browser instance.
- The extension communicates via standard HTTPS API calls directly to your configured LLM endpoints (such as OpenRouter or local Ollama instances) to process your automation prompts. No intermediary servers are used.

### 2. Permissions Justification
- **Host Permissions (<all_urls>)**: Necessary to allow the AI agent to automate workflows on the specific pages you prompt it to interact with.
- **Storage**: Used solely to persist your local API keys and queue state so the extension doesn't forget its progress when you switch tabs.
