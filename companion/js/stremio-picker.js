'use strict';

// A dropdown in the app's own look, for lists too long or too varied for a
// plain <select>: a button, then a panel with a filter box and the choices.
// multi: a checklist (onChange gets every checked value, with all/none
// buttons); otherwise picking one closes it (onPick gets the value).
function createPicker(opts) {
  var root = document.createElement('div');
  root.className = 'cn-picker' + (opts.className ? ' ' + opts.className : '');
  root.innerHTML =
    '<button type="button" class="cn-picker-button" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="cn-picker-label"></span></button>' +
    '<div class="cn-picker-panel" hidden>' +
      '<input class="mx-input cn-picker-filter" type="search" autocomplete="off" enterkeyhint="done">' +
      (opts.multi ? '<div class="cn-picker-actions">' +
        '<button type="button" class="mx-btn mx-sm" data-all>all</button>' +
        '<button type="button" class="mx-btn mx-sm" data-none>none</button></div>' : '') +
      '<div class="cn-picker-list" role="listbox"></div>' +
      '<p class="cn-picker-empty" hidden>No matches.</p>' +
    '</div>';
  var button = root.querySelector('.cn-picker-button');
  var label = root.querySelector('.cn-picker-label');
  var panel = root.querySelector('.cn-picker-panel');
  var filter = root.querySelector('.cn-picker-filter');
  var list = root.querySelector('.cn-picker-list');
  var empty = root.querySelector('.cn-picker-empty');
  button.setAttribute('aria-label', opts.name || '');
  filter.placeholder = opts.filterPlaceholder || 'filter';
  filter.setAttribute('aria-label', opts.filterPlaceholder || 'filter');
  if (opts.multi) list.setAttribute('aria-multiselectable', 'true');

  function options() { return Array.prototype.slice.call(list.children); }
  function checked() {
    return options().filter(function (item) { return item.getAttribute('aria-selected') === 'true'; })
      .map(function (item) { return item.value; });
  }
  function applyFilter() {
    var text = filter.value.trim().toLowerCase();
    var shown = 0;
    options().forEach(function (item) {
      item.hidden = !!text && item.getAttribute('data-find').indexOf(text) === -1;
      if (!item.hidden) shown++;
    });
    empty.hidden = shown > 0;
  }
  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    root.classList.add('cn-picker-open');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', outside);
    // Keep the panel on screen when the button sits near the right edge.
    panel.style.left = '';
    panel.style.right = '';
    var box = panel.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0'; }
    var current = list.querySelector('[aria-selected="true"]:not([hidden])');
    if (current) current.scrollIntoView({ block: 'nearest' });
    // Straight to the filter on a computer; on a phone that would pop the keyboard.
    if (window.matchMedia('(hover: hover)').matches) filter.focus();
  }
  function close(refocus) {
    if (panel.hidden) return;
    panel.hidden = true;
    root.classList.remove('cn-picker-open');
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside);
    if (filter.value) { filter.value = ''; applyFilter(); }
    if (refocus) button.focus();
  }

  // Listening on the page only while open, so pickers rebuilt with the
  // Discover filters don't pile up listeners.
  function outside(event) { if (!root.contains(event.target)) close(false); }

  button.addEventListener('click', function () { if (panel.hidden) open(); else close(false); });
  filter.addEventListener('input', applyFilter);
  root.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (panel.hidden) { if (event.target === button) { event.preventDefault(); open(); } return; }
    var shown = options().filter(function (item) { return !item.hidden; });
    if (!shown.length) return;
    event.preventDefault();
    var at = shown.indexOf(document.activeElement);
    var next = event.key === 'ArrowDown' ? (at === -1 ? 0 : Math.min(at + 1, shown.length - 1)) : at - 1;
    if (next < 0) filter.focus(); else shown[next].focus();
  });
  filter.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    var first = options().find(function (item) { return !item.hidden; });
    if (first) first.click();
  });
  list.addEventListener('click', function (event) {
    var item = event.target.closest('.cn-picker-option');
    if (!item) return;
    if (opts.multi) {
      item.setAttribute('aria-selected', item.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
      opts.onChange(checked());
    } else {
      close(true);
      opts.onPick(item.value);
    }
  });
  if (opts.multi) {
    root.querySelector('[data-all]').addEventListener('click', function () {
      options().forEach(function (item) { item.setAttribute('aria-selected', 'true'); });
      opts.onChange(checked());
    });
    root.querySelector('[data-none]').addEventListener('click', function () {
      options().forEach(function (item) { item.setAttribute('aria-selected', 'false'); });
      opts.onChange(checked());
    });
    (opts.actions || []).forEach(function (action) {
      var extra = document.createElement('button');
      extra.type = 'button';
      extra.className = 'mx-btn mx-sm';
      extra.textContent = action.label;
      extra.addEventListener('click', action.onClick);
      root.querySelector('.cn-picker-actions').appendChild(extra);
    });
  }

  return {
    root: root,
    // items: [{ value, label, detail, selected }]
    setItems: function (items) {
      var signature = JSON.stringify(items.map(function (item) { return [item.value, item.label, item.detail || '']; }));
      if (signature !== list.getAttribute('data-signature')) {
        list.setAttribute('data-signature', signature);
        list.innerHTML = '';
        items.forEach(function (item) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'cn-picker-option';
          row.setAttribute('role', 'option');
          row.value = item.value;
          row.innerHTML = '<span class="cn-picker-mark" aria-hidden="true"></span>' +
            '<span class="cn-picker-name"></span><span class="cn-picker-detail"></span>';
          row.querySelector('.cn-picker-name').textContent = item.label;
          row.querySelector('.cn-picker-detail').textContent = item.detail || '';
          row.setAttribute('data-find', (item.label + ' ' + (item.detail || '')).toLowerCase());
          list.appendChild(row);
        });
        applyFilter();
      }
      items.forEach(function (item, n) { list.children[n].setAttribute('aria-selected', item.selected ? 'true' : 'false'); });
      // The filter only earns its place once the list is long.
      filter.hidden = items.length < 8;
    },
    setLabel: function (text) { label.textContent = text; },
    setDisabled: function (value) { button.disabled = !!value; if (value) close(false); },
    close: close
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createPicker;
