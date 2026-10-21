// Served before the unchanged dist bundle, never installed in the production entry.
(() => {
  const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  localStorage.clear();
  localStorage.setItem('theme_mode_v1', theme);
  localStorage.setItem('anet.language.v1', 'zh-CN');
  const profile = { serverUrl: location.origin, token: 'utok_local_fixture_only', username: 'fixture-viewer', profileId: 'scheduler-local-fixture', displayName: 'Local Fixture', networkId: 'net-fixture' };
  // A fixed wall clock makes relative labels reproducible without freezing UI timers.
  const NativeDate = Date;
  const fixed = NativeDate.parse('2026-10-21T04:00:00Z');
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) return Promise.reject(new Error(`Fixture blocked external fetch: ${url.origin}`));
    return nativeFetch(input, init);
  };
  // No socket is needed for a static fixture; prevent any connection to a real Hub.
  window.WebSocket = class extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 3;
    send() {} close() {}
  };
  let rid = 0;
  const requests = new Map(), bodies = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(cb) { const id = ++rid; window[`_${id}`] = cb; return id; },
    unregisterCallback(id) { delete window[`_${id}`]; },
    convertFileSrc: p => p,
    async invoke(cmd, args = {}) {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return JSON.stringify(profile);
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return ++rid;
        case 'plugin:http|fetch': { const id = ++rid; requests.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = requests.get(args.rid); requests.delete(args.rid);
          const r = await window.fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const id = ++rid; bodies.set(id, new Uint8Array(await r.arrayBuffer()));
          return { status: r.status, statusText: r.statusText, url: r.url, headers: [...r.headers.entries()], rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b) return [1];
          bodies.delete(args.rid); return [...b, 0];
        }
        default: return null;
      }
    },
  };
  // Preview shortcut uses the real App's navigation, not a component mount or test hook.
  if (new URLSearchParams(location.search).get('scheduler') === '1') {
    const observer = new MutationObserver(() => {
      const nav = document.querySelector('[data-testid="desktop-rail"] [aria-label*="定时"]')
        || [...document.querySelectorAll('[role="tab"], [role="button"]')].find(e => e.textContent === '定时任务');
      if (nav) { observer.disconnect(); nav.click(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
