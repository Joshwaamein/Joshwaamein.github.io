/* =====================================================================
 * Joshua Mein blog
 * /terminal: a small console for browsing the site. Vanilla JS.
 * No build step, no dependencies. Same idiom as app.js (var, no arrows).
 *
 * SECURITY RULE, do not "improve" this away:
 * every value that comes from post data is written with textContent or
 * createTextNode, never innerHTML. Post titles are author-controlled but
 * treating them as HTML is how a stray <img onerror=...> in a title
 * becomes an XSS bug. Build styled lines from multiple elements instead.
 * ===================================================================== */
(function () {
  'use strict';

  var out = document.getElementById('term-out');
  var form = document.getElementById('term-form');
  var input = document.getElementById('term-in');
  var term = document.getElementById('term');
  var taps = document.getElementById('term-taps');
  var dataEl = document.getElementById('terminal-data');
  if (!out || !form || !input || !dataEl) return;

  /* ---------- output helpers (textContent only) ---------- */

  function write(text, cls) {
    var line = document.createElement('div');
    line.className = 'term-line' + (cls ? ' term-line--' + cls : '');
    line.textContent = text;
    out.appendChild(line);
    return line;
  }

  function writeBlank() {
    write('\u00a0');
  }

  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    write('terminal: could not load post index', 'err');
    return;
  }

  var posts = (data && data.posts) || [];
  var site = (data && data.site) || {};
  var home = site.home || '/';
  var retroUrl = site.retro || '/retro/';

  // Echo the command the way a shell does: styled prompt, plain text cmd.
  function echo(cmd) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--echo';

    var ps1 = document.createElement('span');
    ps1.className = 'term-ps1';
    ps1.textContent = 'visitor@blog:~$ ';

    var body = document.createElement('span');
    body.textContent = cmd;

    line.appendChild(ps1);
    line.appendChild(body);
    out.appendChild(line);
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = ' ' + s;
    return s;
  }

  // A post row: "  3   2026-06-16   Title of the post"
  function writePost(index, post) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--post';

    var num = document.createElement('span');
    num.className = 'term-num';
    num.textContent = pad(index, 2);

    var date = document.createElement('span');
    date.className = 'term-date';
    date.textContent = post.date || '';

    var title = document.createElement('span');
    title.className = 'term-title';
    title.textContent = post.title || '(untitled)';

    line.appendChild(num);
    line.appendChild(date);
    line.appendChild(title);
    out.appendChild(line);
  }

  function scrollToEnd() {
    out.scrollTop = out.scrollHeight;
  }

  // Wrap a long string at a sane column so excerpts read like terminal
  // output rather than one giant reflowing paragraph.
  function writeWrapped(text, width) {
    var max = width || 76;
    var words = String(text).split(/\s+/);
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (line && (line.length + 1 + words[i].length) > max) {
        write(line);
        line = words[i];
      } else {
        line = line ? line + ' ' + words[i] : words[i];
      }
    }
    if (line) write(line);
  }

  // Accept "3" or a slug. Returns the post object or null.
  function resolvePost(token) {
    var key = String(token).toLowerCase();
    if (/^[0-9]+$/.test(key)) {
      var n = parseInt(key, 10);
      if (n >= 1 && n <= posts.length) return posts[n - 1];
      return null;
    }
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].slug && posts[i].slug.toLowerCase() === key) return posts[i];
    }
    return null;
  }

  // Show a snippet of matched text with the hit highlighted. Built from
  // separate elements so the needle is never interpolated into HTML.
  function writeContext(text, needle) {
    var hay = String(text || '');
    var at = hay.toLowerCase().indexOf(needle);
    if (at === -1) return;

    var from = at - 30;
    if (from < 0) from = 0;
    var to = at + needle.length + 40;
    var snippet = hay.substring(from, to);

    var line = document.createElement('div');
    line.className = 'term-line term-line--ctx';

    if (from > 0) line.appendChild(textSpan('...', 'term-ctx-ellipsis'));

    var localAt = at - from;
    line.appendChild(textSpan(snippet.substring(0, localAt), null));
    line.appendChild(textSpan(snippet.substr(localAt, needle.length), 'term-hit'));
    line.appendChild(textSpan(snippet.substring(localAt + needle.length), null));

    if (to < hay.length) line.appendChild(textSpan('...', 'term-ctx-ellipsis'));

    out.appendChild(line);
  }

  function textSpan(text, cls) {
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    return span;
  }

  function writeNeofetchRow(art, key, value) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--fetch';

    line.appendChild(textSpan(art, 'term-art'));
    if (key) {
      line.appendChild(textSpan(key, 'term-fetch-key'));
      line.appendChild(textSpan(': ', 'term-fetch-key'));
      line.appendChild(textSpan(value, null));
    }
    out.appendChild(line);
  }

  /* ---------- skins ---------- */

  // Scoped to the terminal element only, so switching skins here never
  // touches the site-wide data-theme master set with the header toggle.
  var SKINS = {
    matrix: 1,
    amber: 1,
    paper: 1,
    netscape: 1
  };

  function currentSkin() {
    if (!term || !term.getAttribute) return null;
    return term.getAttribute('data-skin');
  }

  function applySkin(name) {
    if (!term || !term.setAttribute) return;
    if (name === 'matrix') {
      if (term.removeAttribute) term.removeAttribute('data-skin');
    } else {
      term.setAttribute('data-skin', name);
    }
    try { localStorage.setItem('term-skin', name); } catch (e) {}
  }

  function restoreSkin() {
    var saved = null;
    try { saved = localStorage.getItem('term-skin'); } catch (e) {}
    if (saved && Object.prototype.hasOwnProperty.call(SKINS, saved)) {
      applySkin(saved);
    }
  }

  /* ---------- commands ---------- */

  var COMMANDS = {
    help: function () {
      write('available commands:');
      writeBlank();
      write('  help          show this list');
      write('  about         who runs this site');
      write('  posts         list every post (alias: ls)');
      write('  open <n>      open post number <n>');
      write('  cat <n|slug>  print a post excerpt here');
      write('  grep <term>   search titles and text');
      write('  neofetch      system card, sort of');
      write('  skin <name>   change the look (try "skin")');
      write('  retro         the 1998 version of this site');
      write('  modern        the normal site');
      write('  clear         clear the screen');
      write('  whoami        you, apparently');
      write('  exit          back to the normal site');
      writeBlank();
      write('up/down for history, tab to complete', 'dim');
    },

    about: function () {
      write(site.title || 'this blog', 'accent');
      if (site.tagline) write(site.tagline, 'dim');
      writeBlank();
      write('Cloud infrastructure and systems engineer. This blog covers');
      write('homelab builds, Linux, DevOps, networking and security.');
      writeBlank();
      write(posts.length + ' posts published. type "posts" to list them.');
      if (site.github) write('github.com/' + site.github, 'dim');
    },

    posts: function () {
      if (!posts.length) {
        write('no posts found', 'err');
        return;
      }
      write(posts.length + ' posts, newest first:');
      writeBlank();
      for (var i = 0; i < posts.length; i++) {
        writePost(i + 1, posts[i]);
      }
      writeBlank();
      write('type "open <n>" to read one', 'dim');
    },

    open: function (args) {
      if (!args.length) {
        write('usage: open <n>   (see "posts")', 'err');
        return;
      }
      // Deliberately strict: only a plain positive integer is accepted, so
      // nothing user-typed reaches a URL or the DOM unchecked.
      if (!/^[0-9]+$/.test(args[0])) {
        write('open: not a number: ' + args[0], 'err');
        return;
      }
      var n = parseInt(args[0], 10);
      if (n < 1 || n > posts.length) {
        write('open: no post ' + n + ' (valid: 1-' + posts.length + ')', 'err');
        return;
      }
      var post = posts[n - 1];
      write('opening: ' + post.title);
      window.setTimeout(function () {
        window.location.href = post.url;
      }, 350);
    },

    // cat accepts either a number (as per "posts") or a slug, because
    // typing a 60-character slug by hand is nobody's idea of fun.
    cat: function (args) {
      if (!args.length) {
        write('usage: cat <n|slug>   (see "posts")', 'err');
        return;
      }
      var post = resolvePost(args[0]);
      if (!post) {
        write('cat: no such post: ' + args[0], 'err');
        write('try "posts" for the list', 'dim');
        return;
      }
      write(post.title, 'accent');
      write(post.date + '  ' + post.url, 'dim');
      writeBlank();
      if (post.excerpt) {
        writeWrapped(post.excerpt);
      } else {
        write('(no text extracted)', 'dim');
      }
      writeBlank();
      write('this is an excerpt. "open ' + (posts.indexOf(post) + 1) + '" for the full post', 'dim');
    },

    // grep searches the excerpt+title data already embedded for `cat`, so
    // it costs zero extra page weight. That was the objection to shipping
    // search at all, and Tier 2 removed it.
    grep: function (args) {
      if (!args.length) {
        write('usage: grep <term>', 'err');
        return;
      }
      var needle = args.join(' ').toLowerCase();
      if (needle.length < 2) {
        write('grep: search for at least 2 characters', 'err');
        return;
      }

      var hits = [];
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        var inTitle = (p.title || '').toLowerCase().indexOf(needle) !== -1;
        var inBody = (p.excerpt || '').toLowerCase().indexOf(needle) !== -1;
        if (inTitle || inBody) {
          hits.push({ index: i + 1, post: p, where: inTitle ? 'title' : 'text' });
        }
      }

      if (!hits.length) {
        write('grep: no matches for "' + args.join(' ') + '"', 'err');
        return;
      }

      write(hits.length + (hits.length === 1 ? ' match' : ' matches') + ':');
      writeBlank();
      for (var j = 0; j < hits.length; j++) {
        writePost(hits[j].index, hits[j].post);
        if (hits[j].where === 'text') {
          writeContext(hits[j].post.excerpt, needle);
        }
      }
      writeBlank();
      write('type "open <n>" or "cat <n>"', 'dim');
    },

    // Deliberately not a real neofetch: every value here is invented or
    // derived from public site data. No real hostnames, kernels or paths.
    neofetch: function () {
      var rows = [
        ['host', 'static-site (jekyll)'],
        ['kernel', 'liquid 4.x'],
        ['shell', 'terminal.js'],
        ['posts', String(posts.length)],
        ['theme', 'matrix-green'],
        ['uptime', 'since you loaded the page'],
        ['packages', '0 (vanilla js, no build step)'],
        ['tracking', 'none']
      ];
      var art = [
        '   ,--.   ',
        '  ( oo|   ',
        '  |  -|   ',
        '  |__/|   ',
        '  |   |   '
      ];
      var max = art.length > rows.length ? art.length : rows.length;
      for (var i = 0; i < max; i++) {
        var left = art[i] || '          ';
        var row = rows[i];
        writeNeofetchRow(left, row ? row[0] : '', row ? row[1] : '');
      }
    },

    // Skins are terminal-only: they set data-skin on the console element,
    // never on <html>, so the rest of the site keeps master's theme.
    skin: function (args) {
      if (!args.length) {
        write('usage: skin <name>');
        writeBlank();
        write('  matrix    green on black (default)');
        write('  amber     amber phosphor');
        write('  paper     dark on light');
        write('  netscape  1997, and proud of it');
        writeBlank();
        write('current: ' + (currentSkin() || 'matrix'), 'dim');
        return;
      }
      var want = String(args[0]).toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(SKINS, want)) {
        write('skin: unknown skin: ' + args[0], 'err');
        write('try "skin" for the list', 'dim');
        return;
      }
      applySkin(want);
      write('skin set to ' + want);
    },

    sudo: function (args) {
      var what = args.length ? args.join(' ') : '';
      if (what) {
        write('visitor is not in the sudoers file. This incident has been', 'err');
        write('reported to absolutely nobody.', 'err');
      } else {
        write('usage: sudo <command>', 'err');
      }
    },

    clear: function () {
      while (out.firstChild) out.removeChild(out.firstChild);
    },

    whoami: function () {
      write('visitor');
      write('uid=1000(visitor) gid=1000(visitor) groups=1000(visitor),27(curious)', 'dim');
    },

    exit: function () {
      write('logout');
      window.setTimeout(function () {
        window.location.href = home;
      }, 300);
    },

    // The other novelty route. Kept as a command rather than only a link
    // so the three views are reachable from inside any of them.
    retro: function () {
      write('warping to 1998 ...');
      window.setTimeout(function () {
        window.location.href = retroUrl;
      }, 400);
    },

    // Same destination as `exit`, but named for the view rather than the
    // action, so `help` reads as a list of places you can go.
    modern: function () {
      write('loading the modern site ...');
      window.setTimeout(function () {
        window.location.href = home;
      }, 300);
    }
  };

  var ALIASES = {
    ls: 'posts',
    dir: 'posts',
    quit: 'exit',
    q: 'exit',
    cls: 'clear',
    man: 'help',
    '?': 'help',
    find: 'grep',
    search: 'grep',
    theme: 'skin',
    fetch: 'neofetch'
  };

  // Levenshtein distance, small and iterative. Only used to suggest a
  // command name after a typo, so the 2-row optimisation is plenty.
  // Both arguments are coerced: a caller passing a non-string once caused
  // a TypeError here, and defence at the boundary is cheaper than trust.
  function editDistance(a, b) {
    a = String(a);
    b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    var curr = [];
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function suggest(name) {
    var names = commandNames();
    var best = null;
    var bestScore = 99;
    for (var i = 0; i < names.length; i++) {
      var d = editDistance(name, names[i]);
      if (d < bestScore) { bestScore = d; best = names[i]; }
    }
    // Only suggest for near misses; "asdfgh" should not map to "cat".
    return bestScore <= 2 ? best : null;
  }

  function commandNames() {
    var names = [];
    for (var k in COMMANDS) {
      if (Object.prototype.hasOwnProperty.call(COMMANDS, k)) names.push(k);
    }
    names.sort();
    return names;
  }

  function run(raw) {
    var cmd = String(raw).trim();
    if (!cmd) return;

    echo(cmd);
    remember(cmd);

    var parts = cmd.split(/\s+/);
    var name = parts[0].toLowerCase();
    var args = parts.slice(1);

    // hasOwnProperty guard here too, not just on COMMANDS: a bare
    // ALIASES[name] lookup resolves inherited members, so typing
    // "constructor" would reassign `name` to Object's constructor
    // FUNCTION and blow up downstream. Caught by the test harness.
    if (Object.prototype.hasOwnProperty.call(ALIASES, name)) {
      name = ALIASES[name];
    }

    // hasOwnProperty guard: without it, typing "constructor" or
    // "toString" would resolve to an inherited Object function.
    if (Object.prototype.hasOwnProperty.call(COMMANDS, name)) {
      COMMANDS[name](args);
    } else {
      write('command not found: ' + parts[0], 'err');
      var near = suggest(name);
      if (near) {
        write('did you mean "' + near + '"?', 'dim');
      } else {
        write('type "help" for the list', 'dim');
      }
    }

    writeBlank();
    scrollToEnd();
  }

  /* ---------- history ---------- */

  var history = [];
  var histPos = -1;   // -1 means "not browsing history"
  var draft = '';     // what was typed before arrowing up

  function remember(cmd) {
    if (history.length && history[history.length - 1] === cmd) {
      histPos = -1;
      return;
    }
    history.push(cmd);
    if (history.length > 50) history.shift();
    histPos = -1;
  }

  function recall(direction) {
    if (!history.length) return;

    if (histPos === -1) {
      if (direction < 0) {
        draft = input.value;
        histPos = history.length - 1;
      } else {
        return; // down-arrow at the bottom does nothing
      }
    } else {
      histPos += (direction < 0) ? -1 : 1;
    }

    if (histPos < 0) histPos = 0;

    if (histPos >= history.length) {
      histPos = -1;
      input.value = draft;
      return;
    }
    input.value = history[histPos];
  }

  /* ---------- tab completion ---------- */

  function complete() {
    var value = input.value;
    var parts = value.split(/\s+/);

    // Completing an argument. Only some commands take completable ones.
    if (parts.length > 1) {
      var verb = parts[0].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(ALIASES, verb)) verb = ALIASES[verb];

      var frag = parts[parts.length - 1].toLowerCase();
      if (!frag) return;

      if (verb === 'skin') {
        var names = [];
        for (var s in SKINS) {
          if (Object.prototype.hasOwnProperty.call(SKINS, s) && s.indexOf(frag) === 0) {
            names.push(s);
          }
        }
        applyCompletion(parts, names);
        return;
      }

      if (verb !== 'cat' && verb !== 'open') return;

      var slugs = [];
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].slug && posts[i].slug.toLowerCase().indexOf(frag) === 0) {
          slugs.push(posts[i].slug);
        }
      }
      applyCompletion(parts, slugs);
      return;
    }

    // Completing the command itself.
    var head = parts[0].toLowerCase();
    if (!head) return;
    var names = commandNames();
    var hits = [];
    for (var j = 0; j < names.length; j++) {
      if (names[j].indexOf(head) === 0) hits.push(names[j]);
    }
    applyCompletion(parts, hits);
  }

  function applyCompletion(parts, hits) {
    if (!hits.length) return;

    if (hits.length === 1) {
      parts[parts.length - 1] = hits[0];
      input.value = parts.join(' ');
      return;
    }

    // Multiple matches: fill in the shared prefix, then list them.
    var prefix = hits[0];
    for (var i = 1; i < hits.length; i++) {
      var k = 0;
      while (k < prefix.length && k < hits[i].length &&
             prefix.charAt(k) === hits[i].charAt(k)) k++;
      prefix = prefix.substring(0, k);
    }
    if (prefix.length > parts[parts.length - 1].length) {
      parts[parts.length - 1] = prefix;
      input.value = parts.join(' ');
    }
    write(hits.join('   '), 'dim');
    scrollToEnd();
  }

  /* ---------- wiring ---------- */

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var value = input.value;
    input.value = '';
    run(value);
  });

  input.addEventListener('keydown', function (ev) {
    var key = ev.key || '';
    if (key === 'ArrowUp') {
      ev.preventDefault();
      recall(-1);
    } else if (key === 'ArrowDown') {
      ev.preventDefault();
      recall(1);
    } else if (key === 'Tab') {
      ev.preventDefault();
      complete();
    }
  });

  // Tap anywhere in the console to focus the input (raises mobile keyboard).
  if (term) {
    term.addEventListener('click', function (ev) {
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      input.focus();
    });
  }

  if (taps) {
    taps.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var cmd = t.getAttribute('data-cmd');
      if (cmd) run(cmd);
    });
  }

  /* ---------- boot ---------- */

  // The banner is cheap and always shown. The typed boot sequence is the
  // showy part, so it plays once per browser and then stays out of the way.
  function banner() {
    write((site.title || 'blog') + ' terminal', 'accent');
    write('type "help" for commands, "exit" to leave', 'dim');
    writeBlank();
  }

  function reducedMotion() {
    try {
      return window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function bootSeen() {
    try { return localStorage.getItem('term-boot') === 'seen'; }
    catch (e) { return true; } // no storage: treat as seen, never replay
  }

  function markBootSeen() {
    try { localStorage.setItem('term-boot', 'seen'); } catch (e) {}
  }

  var BOOT_LINES = [
    'booting static site kernel ...',
    'mounting /posts ... ' + posts.length + ' entries',
    'no database. no tracking. no cookies.',
    'ready.'
  ];

  var bootTimer = null;

  function skipBoot() {
    if (bootTimer) { window.clearTimeout(bootTimer); bootTimer = null; }
    while (out.firstChild) out.removeChild(out.firstChild);
    banner();
    markBootSeen();
    input.focus();
  }

  function playBoot() {
    var i = 0;
    function step() {
      if (i >= BOOT_LINES.length) {
        bootTimer = null;
        writeBlank();
        banner();
        markBootSeen();
        return;
      }
      write(BOOT_LINES[i], 'dim');
      scrollToEnd();
      i++;
      bootTimer = window.setTimeout(step, 260);
    }
    step();
  }

  // Any key or tap during the boot sequence skips straight to the prompt.
  function armSkip() {
    function handler() {
      if (bootTimer) skipBoot();
      document.removeEventListener('keydown', handler);
      document.removeEventListener('click', handler);
    }
    document.addEventListener('keydown', handler);
    document.addEventListener('click', handler);
  }

  /* ---------- deep link (?cmd=posts) ---------- */

  // Allowlisted against the known command set. Never eval'd and never used
  // to build HTML: an unrecognised value is simply ignored.
  function deepLinkCommand() {
    var search = (window.location && window.location.search) || '';
    var match = /[?&]cmd=([^&#]*)/.exec(search);
    if (!match) return null;

    var raw = '';
    try { raw = decodeURIComponent(match[1].replace(/\+/g, ' ')); }
    catch (e) { return null; }

    var parts = String(raw).trim().split(/\s+/);
    var verb = parts[0] ? parts[0].toLowerCase() : '';
    if (Object.prototype.hasOwnProperty.call(ALIASES, verb)) verb = ALIASES[verb];
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, verb)) return null;

    // Each command re-validates its own arguments; this keeps the input tidy.
    var args = [];
    for (var i = 1; i < parts.length; i++) {
      if (/^[A-Za-z0-9_-]{1,80}$/.test(parts[i])) args.push(parts[i]);
    }
    return [verb].concat(args).join(' ');
  }

  restoreSkin();

  if (bootSeen() || reducedMotion()) {
    banner();
  } else {
    playBoot();
    armSkip();
  }

  var deepLink = deepLinkCommand();
  if (deepLink) run(deepLink);

  input.focus();
})();
