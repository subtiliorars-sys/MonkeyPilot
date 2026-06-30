// stealth.js - Injected at document_start to spoof navigator properties and hide automation flags

(function() {
  // Go Crazy Mode bypass for developer environments
  if (sessionStorage.getItem('goCrazy') === 'true') return;
  // 1. Hide webdriver property
  if (navigator.webdriver !== false) {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true
      });
    } catch(e) {}
  }

  // 2. Mock Plugins list to mimic genuine Windows Chrome (prevent Plugins Length: 0 flag)
  const mockPlugins = [
    { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
    { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "Google Chrome PDF Viewer" },
    { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "Chromium PDF Viewer" }
  ];

  try {
    const makePluginArray = (list) => {
      const plugins = [];
      list.forEach((p, idx) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { value: p.name, enumerable: true },
          filename: { value: p.filename, enumerable: true },
          description: { value: p.description, enumerable: true },
          length: { value: 0 }
        });
        Object.defineProperty(plugin, Symbol.toStringTag, {
          value: "Plugin",
          configurable: true
        });
        plugins.push(plugin);
        plugins[p.name] = plugin;
      });

      const pluginArray = Object.create(PluginArray.prototype);
      Object.defineProperties(pluginArray, {
        length: { value: plugins.length, enumerable: true },
        item: { value: (idx) => plugins[idx], enumerable: true },
        namedItem: { value: (name) => plugins[name], enumerable: true }
      });
      Object.defineProperty(pluginArray, Symbol.toStringTag, {
        value: "PluginArray",
        configurable: true
      });
      
      plugins.forEach((p, idx) => {
        Object.defineProperty(pluginArray, idx, { value: p, enumerable: true });
      });

      return pluginArray;
    };

    Object.defineProperty(navigator, 'plugins', {
      get: () => makePluginArray(mockPlugins),
      configurable: true
    });
  } catch(e) {}

  // 3. Spoof Permissions Query
  try {
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => 
      parameters.name === 'notifications' ? 
        Promise.resolve({ state: Notification.permission, onchange: null }) :
        originalQuery(parameters);
  } catch(e) {}
})();
