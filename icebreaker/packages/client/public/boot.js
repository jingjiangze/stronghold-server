// The loading screen (docs/spec/page.md 页面-8), shown from the page's first paint until the page hands over: the
// activity's loading picture of the match's mode (常规, 堡垒守御) with the original's waiting strip, its status and the
// progress — the modules first (counted against the page's preload links, 站点-4), then what the page reports. A plain
// script that runs before the modules: the page talks to it through globalThis.__boot.
{
  /** The share of the progress the modules take, before the page's own steps. */
  const MODULES = 0.3;
  /** How long the screen is only a dark cover before the picture and the strip come in (a page loaded in that time never
   * shows them), in milliseconds. */
  const STRIP_AFTER = 600;
  const doc = document;
  const assets = new URL(doc.querySelector('meta[name="ig-assets"]')?.getAttribute('content') || 'assets/skeleton/', location.href).href;
  const lobby = `${assets}ui/lobby/`;

  /** The mode of the match the room sent this page to: by its level (堡垒守御's levels by their key), else 常规. */
  const modeOf = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem('ice.loading') ?? 'null');
      return /fortress/.test(String(v?.level ?? '')) ? 'defence' : 'normal';
    } catch { return 'normal'; }
  };

  /** @param {string} tag @param {string} cls @param {Node[]} [kids] */
  const el = (tag, cls, kids = []) => { const e = doc.createElement(tag); e.className = cls; e.append(...kids); return e; };
  /** An image of the assets put into a holder once it has loaded, in place of what the holder drew. @param {HTMLElement} holder @param {string} src */
  const swapIn = (holder, src) => {
    const i = doc.createElement('img');
    i.alt = '';
    i.onload = () => { holder.replaceChildren(i); holder.classList.add('art'); };
    i.src = src;
  };
  /** The turning arrows drawn, when the asset is missing. */
  const LOOP_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="#d48f0b" stroke-width="4.5" stroke-linecap="round">'
    + '<path d="M31 14a13 13 0 0 0-22-1"/><path d="M9 26a13 13 0 0 0 22 1"/></g><path fill="#d48f0b" d="M5 8l2 9 8-4zM35 32l-2-9-8 4z"/></svg>';

  /** The plate in the middle of the strip: the LATEST NEWS tag, the arrows or the warning, the status, the mark. @param {HTMLElement} text @param {HTMLElement} pct */
  const plateOf = (text, pct) => {
    const tag = el('span', 'boot-tag', [el('span', '', [doc.createTextNode('LATEST NEWS')])]), loop = el('span', 'boot-loop');
    const warn = el('span', 'boot-warn', [doc.createTextNode('!')]), mark = el('span', 'boot-mark');
    loop.innerHTML = LOOP_SVG;
    swapIn(tag, `${lobby}act_multi_v3_state_loading_icon_loading.webp`);
    swapIn(loop, `${lobby}act_multi_v3_state_loading_icon_loop.webp`);
    swapIn(warn, `${lobby}act_multi_v3_state_loading_warning.webp`);
    swapIn(mark, `${lobby}act_multi_v3_state_loading_icon.webp`);
    return el('div', 'boot-plate', [tag, el('span', 'boot-status', [loop, warn, text, pct]), mark]);
  };

  /** The screen: the picture, the shade and the strip; the original sprites replace the drawn hatch and shade once loaded. */
  const screenOf = () => {
    const root = el('div', 'boot'), art = el('div', 'boot-art'), text = el('span', 'boot-text'), pct = el('span', 'boot-pct');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const body = el('div', 'boot-body', [el('div', 'boot-fill'), el('div', 'boot-tile left'), el('div', 'boot-tile right'), plateOf(text, pct)]);
    const strip = el('div', 'boot-strip', [body, el('div', 'boot-wipe l'), el('div', 'boot-wipe r'), el('div', 'boot-wipe c')]);
    root.append(art, el('div', 'boot-band', [strip]));
    for (const [name, file] of [['--boot-tile', 'act_multi_v3_state_loading_tile.webp'], ['--boot-doc', 'act_multi_v3_state_loading_black_doc.webp']]) {
      const probe = new Image();
      probe.onload = () => root.style.setProperty(name, `url("${lobby}${file}")`);
      probe.src = `${lobby}${file}`;
    }
    const pic = new Image();
    pic.fetchPriority = 'high';
    pic.onload = () => { art.style.setProperty('--boot-art', `url("${pic.src}")`); art.classList.add('shown'); };
    pic.src = `${lobby}loading_loading_MULTIV3_${modeOf()}.webp`;
    return { root, text, pct };
  };

  /** Counts the page's modules as they arrive against its preload links. @param {(share: number) => void} on */
  const watchModules = (on) => {
    const total = doc.querySelectorAll('link[rel="modulepreload"]').length, seen = new Set();
    if (total === 0 || typeof PerformanceObserver !== 'function') return;
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (new URL(e.name, location.href).pathname.includes('/m/')) seen.add(e.name);
      on(Math.min(1, seen.size / total));
    });
    try { obs.observe({ type: 'resource', buffered: true }); } catch { /* no resource timing: the page's steps only */ }
  };

  const { root, text, pct } = screenOf();
  doc.body.prepend(root);
  let shown = 0, label = '正在载入页面', over = false;
  /** @param {string | null} what the status (null: kept) @param {number} at the share done, never going back */
  const set = (what, at) => {
    if (over) return;
    if (what) label = what;
    shown = Math.max(shown, Math.min(1, at));
    text.textContent = label;
    pct.textContent = `${Math.floor(shown * 100)}%`;
    root.style.setProperty('--boot-progress', String(shown));
  };
  set(null, 0);
  const timer = setTimeout(() => { if (!over) root.classList.add('in'); }, STRIP_AFTER);
  watchModules((share) => set(null, MODULES * share));
  /** Ends the screen's progress. */
  const end = () => { over = true; clearTimeout(timer); };
  /** Loading failed: the warning and what to do, kept on the screen. @param {string} why */
  const fail = (why) => {
    if (over) return;
    end();
    root.classList.add('in', 'failed');
    text.textContent = why;
  };
  /**
   * The page's code did not start — an engine too old for its syntax, a script that did not arrive: before the page
   * reported a step, its first error stays on the screen with what to do (页面-8); after that, the page's own handling.
   * @param {unknown} e
   */
  const unstarted = (e) => {
    if (over || shown > MODULES) return;
    console.error('页面没能启动', e);
    const old = e instanceof SyntaxError || (e instanceof ErrorEvent && (e.error instanceof SyntaxError || /^(Uncaught )?SyntaxError/.test(e.message)));
    fail(old ? '浏览器版本太旧，页面没能启动。请更新浏览器，或换用最新的 Chrome、Edge 后刷新' : '页面脚本没能载入，请刷新页面重试');
  };
  addEventListener('error', (e) => { if (e instanceof ErrorEvent || e.target instanceof HTMLScriptElement) unstarted(e); }, true);
  addEventListener('unhandledrejection', (e) => unstarted(e.reason));

  globalThis.__boot = {
    /** The page's own step: its status and the share done (MODULES … 1). @param {string} what @param {number} at */
    step: (what, at) => set(what, Math.max(MODULES, at)),
    /** The page has taken over: the screen fades out. */
    done() {
      if (over) return;
      end();
      root.classList.add('gone');
      setTimeout(() => root.remove(), 400);
    },
    /** Loading failed: the warning and what to do, kept on the screen. @param {string} why */
    fail,
    /** Whether the screen is still up. */
    get up() { return !over; },
  };
}
