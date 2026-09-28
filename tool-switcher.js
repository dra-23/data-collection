// Tool switcher — turns each page's top-bar title into a dropdown for moving
// between SPEDsheet, SPEDsight, and the Toolbox. Shared by index.html,
// abc.html, and toolbox.html so the list of tools lives in one place.
//
// Markup each page provides (the name/logo stay in the page so there's no
// flash before this script runs):
//   <div class="tool-switch" data-current="spedsheet|spedsight|toolbox">
//     <button type="button" class="topbar-brand tool-switch-btn">
//       <img src="icon.png" alt=""><span class="tool-switch-name">Name</span>
//     </button>
//   </div>
// (index.html hides .topbar-brand on phones — its account menu carries the
// tool links there instead.)
(function () {
  'use strict';

  const ICONS = {
    spedsheet: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    spedsight: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/>',
    toolbox: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  };
  const TOOLS = [
    { id: 'spedsheet', name: 'SPEDsheet', desc: 'Daily point sheets', href: 'index.html' },
    { id: 'spedsight', name: 'SPEDsight', desc: 'ABC data collection', href: 'abc.html' },
  ];
  const TOOLBOX = { id: 'toolbox', name: 'Toolbox', desc: 'All tools', href: 'toolbox.html' };

  // No "display" on .tool-switch-btn: the button also carries the page's
  // .topbar-brand class, and each page decides that (index.html hides it on
  // phones). This style is injected after the page's own, so setting display
  // here would silently override those rules.
  const CSS = `
.tool-switch { position: relative; flex-shrink: 0; min-width: 0; }
.tool-switch-btn { align-items: center; gap: 10px; margin-left: -6px; padding: 4px 8px 4px 6px; border: none; border-radius: 10px; background: transparent; color: inherit; cursor: pointer; transition: background .15s; }
.tool-switch-btn:hover, .tool-switch-btn[aria-expanded="true"] { background: rgba(255,255,255,.14); }
.tool-switch-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.tool-switch-chev { flex-shrink: 0; opacity: .85; transition: transform .15s; }
.tool-switch-btn[aria-expanded="true"] .tool-switch-chev { transform: rotate(180deg); }
.tool-switch-menu { position: absolute; left: 0; top: calc(100% + 8px); z-index: 250; min-width: 270px; padding: 6px; background: #fff; color: #1c1917; border: 1px solid #e8e5e1; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.15); font-family: 'Roboto', sans-serif; letter-spacing: normal; }
.tool-switch-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 8px; color: inherit; text-decoration: none; }
.tool-switch-item:hover, .tool-switch-item:focus-visible { background: #f8f7f5; outline: none; }
.tool-switch-item[aria-current="page"] { background: rgba(50,59,135,.10); }
.tool-switch-icon { width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; background: rgba(50,59,135,.10); color: #323B87; display: flex; align-items: center; justify-content: center; }
.tool-switch-text { display: flex; flex-direction: column; min-width: 0; }
.tool-switch-title { font-size: 15px; font-weight: 700; }
.tool-switch-desc { font-size: 13px; font-weight: 400; color: #5f6368; }
.tool-switch-check { margin-left: auto; color: #323B87; flex-shrink: 0; }
.tool-switch-sep { height: 1px; margin: 6px 4px; background: #e8e5e1; }`;

  const svg = (paths, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const CHEVRON = '<svg class="tool-switch-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  const CHECK = '<svg class="tool-switch-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  // Static content only — nothing user- or database-supplied goes in here.
  function itemHTML(tool, current) {
    const here = tool.id === current;
    return `<a class="tool-switch-item" role="menuitem" href="${tool.href}"${here ? ' aria-current="page"' : ''}>
      <span class="tool-switch-icon">${svg(ICONS[tool.id], 20)}</span>
      <span class="tool-switch-text"><span class="tool-switch-title">${tool.name}</span><span class="tool-switch-desc">${tool.desc}</span></span>
      ${here ? CHECK : ''}
    </a>`;
  }

  function setup(root, n) {
    const current = root.dataset.current;
    const btn = root.querySelector('.tool-switch-btn');
    if (!btn) return;
    const menu = document.createElement('div');
    menu.className = 'tool-switch-menu';
    menu.id = 'tool-switch-menu-' + n;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Switch tool');
    menu.hidden = true;
    menu.innerHTML = TOOLS.map(t => itemHTML(t, current)).join('') +
      '<div class="tool-switch-sep" role="separator"></div>' + itemHTML(TOOLBOX, current);
    root.appendChild(menu);
    btn.insertAdjacentHTML('beforeend', CHEVRON);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', menu.id);
    btn.title = 'Switch tool';

    const items = () => [...menu.querySelectorAll('.tool-switch-item')];
    const isOpen = () => !menu.hidden;
    function open(focusFirst) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) (menu.querySelector('[aria-current="page"]') || items()[0]).focus();
    }
    function close(returnFocus) {
      if (!isOpen()) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (returnFocus) btn.focus();
    }

    // Clicks are left to propagate so the page's own handlers (e.g. closing an
    // open account menu) still run; the outside-click check below ignores
    // anything inside this switcher.
    btn.addEventListener('click', e => {
      // e.detail is 0 for keyboard activation — move focus into the menu then.
      isOpen() ? close(false) : open(e.detail === 0);
    });
    menu.addEventListener('click', e => {
      const a = e.target.closest('.tool-switch-item');
      // Picking the tool you're already on just closes the menu (no reload).
      if (a && a.getAttribute('aria-current') === 'page') { e.preventDefault(); close(true); }
    });
    menu.addEventListener('keydown', e => {
      const list = items(), i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === 'Tab') close(false);
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(true); }
    });
    document.addEventListener('click', e => { if (!root.contains(e.target)) close(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(true); });
  }

  function init() {
    const roots = document.querySelectorAll('.tool-switch');
    if (!roots.length) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    roots.forEach(setup);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
