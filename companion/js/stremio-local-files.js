'use strict';

// A saved file from your own library, shown as the first source for a movie
// or episode (where Stremio lists a library addon's streams) and on the
// details of files without Stremio metadata. Play casts it; the rest are the
// file actions the resolver supports. Delete asks for a second tap, since
// there's no undo.
function createLocalFileRow(resolver, entry, opts) {
  var CONFIRM_MS = 4000;
  var CATEGORIES = { movies: 'Movies', series: 'Television series', plus18: '18+', youtube: 'YouTube videos', porn: 'Porn', other: 'Other videos' };
  var progress = entry.progress || {};
  var title = opts.title || entry.title || 'video';

  function clock(totalSec) {
    var s = Math.floor(totalSec || 0), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function bytes(n) {
    if (!n) return '0 MB';
    return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB';
  }
  function button(label, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mx-btn mx-sm' + (primary ? ' mx-primary' : '');
    b.textContent = label;
    return b;
  }
  function failed(err) { MX.toast(false, err.message); }

  var row = document.createElement('div');
  row.className = 'cn-row cn-st-file';
  var main = document.createElement('span');
  main.className = 'cn-stream-main';
  var name = document.createElement('span');
  name.className = 'cn-row-name';
  name.textContent = opts.label || 'Your library';
  var desc = document.createElement('span');
  desc.className = 'cn-stream-desc';
  var meta = [entry.height ? entry.height + 'p' + (entry.originalUrl ? ' (TV: 1080p)' : entry.needsTvCopy ? ', TV gets 1080p' : '') : '',
    entry.partial ? (entry.downloading ? 'downloading' : 'partly downloaded') + (entry.durationSec
      ? ': ' + clock(entry.savedSec) + ' of ' + clock(entry.durationSec) : '') : 'downloaded',
    bytes(entry.bytes),
    progress.watched ? 'watched' : progress.positionSec ? 'left at ' + clock(progress.positionSec) : ''];
  var opt = entry.optimize;
  if (opt && opt.state === 'running') meta.push('optimizing for TV ' + Math.floor(opt.pct || 0) + '%');
  else if (opt && opt.state === 'queued') meta.push('optimizing for TV: queued');
  else if (opt && opt.state === 'error') meta.push('optimize failed: ' + opt.error);
  desc.textContent = meta.filter(Boolean).join(' · ');
  main.appendChild(name);
  main.appendChild(desc);
  if (progress.durationSec && !progress.watched && progress.positionSec) {
    var bar = document.createElement('span');
    bar.className = 'cn-st-progress';
    bar.innerHTML = '<span></span>';
    bar.firstChild.style.width = Math.round(Math.min(1, progress.positionSec / progress.durationSec) * 100) + '%';
    main.appendChild(bar);
  }

  var actions = document.createElement('span');
  actions.className = 'cn-st-file-actions';
  var play = button(entry.needsTvCopy ? 'play (1080p)' : progress.watched ? 'watch again' : progress.positionSec ? 'continue' : 'play', !entry.canResume);
  play.addEventListener('click', function () {
    if (!entry.needsTvCopy) { opts.onCast(entry.streamUrl, title); return; }
    // Too big for the TV: make the 1080p copy and cast it as it's made.
    play.disabled = true;
    play.textContent = 'starting…';
    MX.toast(true, 'Making the 1080p copy; the TV starts in a few seconds.');
    resolver.castOptimized(entry.key).then(function (result) { opts.onCast(result.streamUrl, title); }, failed)
      .then(function () { play.disabled = false; play.textContent = 'play (1080p)'; });
  });
  actions.appendChild(play);

  if (entry.canResume) {
    var resume = button('continue download', true);
    resume.addEventListener('click', function () {
      resume.disabled = true;
      resolver.resumeSaved(entry.key).then(function () {
        MX.toast(true, 'Continuing: ' + title);
        opts.onChanged();
      }, failed).then(function () { resume.disabled = false; });
    });
    actions.appendChild(resume);
  }

  var more = document.createElement('details');
  more.className = 'cn-saved-manage';
  more.innerHTML = '<summary>more</summary><div class="cn-saved-manage-body"></div>';
  var body = more.querySelector('div');
  if (entry.originalUrl) {
    var original = button('copy 4K link');
    original.addEventListener('click', function () {
      var url = entry.originalUrl;
      function ask() { window.prompt('Copy this link, then open it in VLC (Media > Open Network Stream):', url); }
      // The clipboard API only exists on https or localhost.
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(function () { MX.toast(true, 'Copied the 4K link.'); }, ask);
      } else ask();
    });
    body.appendChild(original);
  }
  if (entry.canOptimize || (opt && opt.state === 'error')) {
    var optimize = button(opt && opt.state === 'error' ? 'try optimizing again' : 'optimize for TV (1080p)');
    optimize.addEventListener('click', function () {
      optimize.disabled = true;
      resolver.optimizeSaved(entry.key).then(function () {
        MX.toast(true, 'Optimizing for TV: ' + title);
        opts.onChanged();
      }, failed).then(function () { optimize.disabled = false; });
    });
    body.appendChild(optimize);
  }
  var category = document.createElement('select');
  category.className = 'mx-input';
  category.setAttribute('aria-label', 'Library category');
  Object.keys(CATEGORIES).forEach(function (key) {
    var option = document.createElement('option');
    option.value = key;
    option.textContent = CATEGORIES[key];
    category.appendChild(option);
  });
  category.value = entry.category || 'other';
  category.addEventListener('change', function () {
    resolver.updateLibrary(entry.kind, entry.key, { category: category.value }).then(opts.onChanged, function (err) {
      category.value = entry.category || 'other';
      failed(err);
    });
  });
  body.appendChild(category);
  if (opts.matchHref) {
    var match = document.createElement('a');
    match.className = 'mx-btn mx-sm';
    match.href = opts.matchHref;
    match.textContent = 'match Stremio metadata';
    body.appendChild(match);
  }
  // The server refuses to delete a file that is downloading or optimizing.
  if (!entry.downloading && !(opt && (opt.state === 'running' || opt.state === 'queued'))) {
    var del = button('delete');
    var timer = null;
    del.addEventListener('click', function () {
      if (!del.classList.contains('cn-confirm')) {
        del.classList.add('cn-confirm');
        del.textContent = 'sure? delete';
        timer = setTimeout(function () { del.classList.remove('cn-confirm'); del.textContent = 'delete'; }, CONFIRM_MS);
        return;
      }
      clearTimeout(timer);
      del.disabled = true;
      del.textContent = 'deleting…';
      resolver.deleteSaved(entry.kind, entry.key).then(function () {
        MX.toast(true, 'Deleted: ' + title);
        row.remove();
        opts.onChanged();
      }, function (err) {
        del.disabled = false;
        del.classList.remove('cn-confirm');
        del.textContent = 'delete';
        failed(err);
      });
    });
    body.appendChild(del);
  }
  actions.appendChild(more);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

if (typeof module !== 'undefined') module.exports = createLocalFileRow;
