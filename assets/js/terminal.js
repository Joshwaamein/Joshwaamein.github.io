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

  // The live prompt element, so `cd` is visible in the prompt itself.
  var ps1El = document.getElementById('term-ps1');
  // The window titlebar, which a real terminal also tracks the cwd in.
  var barTitleEl = document.querySelector('.term-bar-title');
  var barTitlePrefix = barTitleEl
    ? barTitleEl.textContent.replace(/:\s*~\s*$/, '')
    : '';

  function promptText() {
    return 'visitor@blog:' + currentPath() + '$';
  }

  function updatePrompt() {
    if (ps1El) ps1El.textContent = promptText();
    if (barTitleEl) barTitleEl.textContent = barTitlePrefix + ': ' + currentPath();
  }

  // Echo the command the way a shell does: styled prompt, plain text cmd.
  // The echoed prompt is captured at run time, so scrolling back shows which
  // directory each command was actually run from.
  function echo(cmd) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--echo';

    var ps1 = document.createElement('span');
    ps1.className = 'term-ps1';
    ps1.textContent = promptText() + ' ';

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

  /* ---------- virtual filesystem ----------
   *
   * The point of this page is navigating a blog with shell commands, so the
   * content is modelled as a tree rather than a flat list addressed by index.
   * One post is one file, and the same post is reachable by three paths,
   * the way hardlinks work:
   *
   *   ~/
   *   |-- README.md
   *   |-- about.md
   *   |-- posts/            every post, one file per post
   *   |-- categories/<cat>/ the same files, grouped by category
   *   `-- tags/<tag>/       the same files, grouped by tag
   *
   * Nodes are plain objects: {name, type, children{}, post}. Directories get
   * a children map, files carry a reference to the post record. Every name
   * here is derived from build-time post data, never from typed input.
   */

  // A slug is already URL-safe; strip anything else so a filename can never
  // carry a path separator or a quote into the DOM.
  function fileNameFor(post) {
    var slug = String(post.slug || 'untitled').replace(/[^A-Za-z0-9._-]/g, '-');
    return (post.date || '0000-00-00') + '-' + slug + '.md';
  }

  // Category/tag names come from front matter and become directory names:
  // lowercased, spaces to dashes, anything else dropped. "Home Lab" -> home-lab.
  function dirNameFor(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    s = s.replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
    return s || 'untagged';
  }

  function makeDir(name) { return { name: name, type: 'dir', children: {} }; }
  function makeFile(name, post) { return { name: name, type: 'file', post: post }; }

  function addChild(dir, node) {
    dir.children[node.name] = node;
    return node;
  }

  // Group posts under a parent by a front-matter list field. A post with no
  // values is skipped rather than filed under a fabricated directory.
  function buildGrouping(parent, field) {
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var values = post[field];
      if (!values || !values.length) continue;

      for (var j = 0; j < values.length; j++) {
        var dirName = dirNameFor(values[j]);
        var dir = Object.prototype.hasOwnProperty.call(parent.children, dirName)
          ? parent.children[dirName]
          : addChild(parent, makeDir(dirName));
        addChild(dir, makeFile(fileNameFor(post), post));
      }
    }
  }

  var ROOT = makeDir('~');

  (function buildTree() {
    var postsDir = addChild(ROOT, makeDir('posts'));
    for (var i = 0; i < posts.length; i++) {
      addChild(postsDir, makeFile(fileNameFor(posts[i]), posts[i]));
    }
    buildGrouping(addChild(ROOT, makeDir('categories')), 'categories');
    buildGrouping(addChild(ROOT, makeDir('tags')), 'tags');

    // Generated files, so `cat` has something to say at the top level.
    // post === null marks them: catOne() renders them from synthFile().
    addChild(ROOT, makeFile('README.md', null));
    addChild(ROOT, makeFile('about.md', null));
  })();

  var cwd = ROOT;        // current directory node
  var cwdPath = [];      // segments from ROOT, e.g. ['posts']
  var prevPath = null;   // for `cd -`

  function pathString(segments) {
    return (segments && segments.length) ? '~/' + segments.join('/') : '~';
  }

  function currentPath() { return pathString(cwdPath); }

  // Walk from ROOT down a segment list already known to be valid.
  function nodeAt(segments) {
    var node = ROOT;
    for (var i = 0; i < segments.length; i++) {
      node = node.children[segments[i]];
    }
    return node;
  }

  // Resolve a path to {node, segments}, or null when it does not exist.
  // Handles absolute (/ or ~), relative, ".", ".." and trailing slashes.
  // All path semantics live here so cd/ls/cat/stat/find agree.
  function resolvePath(raw) {
    var str = String(raw == null ? '' : raw).trim();
    if (!str) return { node: cwd, segments: cwdPath.slice() };

    var node, segments;
    if (str.charAt(0) === '/' || str.charAt(0) === '~') {
      node = ROOT;
      segments = [];
      str = str.replace(/^[~/]+/, '');
    } else {
      node = cwd;
      segments = cwdPath.slice();
    }

    var parts = str.split('/');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === '.') continue;

      if (part === '..') {
        if (segments.length) {
          segments.pop();
          node = nodeAt(segments);
        }
        continue;
      }

      // hasOwnProperty, not a bare lookup: `cd constructor` must 404 rather
      // than resolve an inherited Object member. Same bug class as the
      // COMMANDS/ALIASES guards below.
      if (node.type !== 'dir' ||
          !Object.prototype.hasOwnProperty.call(node.children, part)) {
        return null;
      }
      node = node.children[part];
      segments.push(part);
    }
    return { node: node, segments: segments };
  }

  // Directories first, then files, each alphabetically (ls
  // --group-directories-first).
  function listing(dir) {
    var dirs = [];
    var files = [];
    for (var name in dir.children) {
      if (!Object.prototype.hasOwnProperty.call(dir.children, name)) continue;
      var node = dir.children[name];
      (node.type === 'dir' ? dirs : files).push(node);
    }
    function byName(a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); }
    dirs.sort(byName);
    files.sort(byName);
    return dirs.concat(files);
  }

  function countChildren(dir) {
    var n = 0;
    for (var k in dir.children) {
      if (Object.prototype.hasOwnProperty.call(dir.children, k)) n++;
    }
    return n;
  }

  // Every file at or under a node, with its full path. Used by find and
  // recursive grep.
  //
  // posts/ is walked first so that when a caller dedupes by URL, the path it
  // keeps is the canonical ~/posts/<file> rather than whichever grouping
  // happened to sort first (categories/ would otherwise always win and a
  // grep from ~ would never mention posts/ at all).
  function walkFiles(node, segments, acc) {
    if (node.type === 'file') {
      acc.push({ node: node, path: pathString(segments) });
      return acc;
    }
    var entries = listing(node);
    var ordered = [];
    var deferred = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name === 'categories' || entries[i].name === 'tags') {
        deferred.push(entries[i]);
      } else {
        ordered.push(entries[i]);
      }
    }
    ordered = ordered.concat(deferred);

    for (var j = 0; j < ordered.length; j++) {
      walkFiles(ordered[j], segments.concat(ordered[j].name), acc);
    }
    return acc;
  }

  // Strip one layer of matching quotes from an operand. A shell would do
  // this before the command ever sees the argument; here the raw line is
  // split on whitespace, so `find -name "*docker*"` would otherwise try to
  // match a filename that literally contains quote characters.
  function unquote(value) {
    var s = String(value == null ? '' : value);
    if (s.length > 1) {
      var first = s.charAt(0);
      var last = s.charAt(s.length - 1);
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return s.substring(1, s.length - 1);
      }
    }
    return s;
  }

  // Split argv into flags and operands so commands accept flags in any
  // order: -l, -la (cluster), --long, and -n 5 (value follows).
  function parseArgs(args, valueFlags) {
    var flags = {};
    var rest = [];
    var takesValue = valueFlags || {};

    for (var i = 0; i < args.length; i++) {
      var a = String(args[i]);
      if (a.length > 1 && a.charAt(0) === '-') {
        var body = a.replace(/^-+/, '');
        if (a.indexOf('--') === 0) {
          flags[body] = true;
          continue;
        }
        // A short flag that takes a value consumes the next argument.
        if (Object.prototype.hasOwnProperty.call(takesValue, body)) {
          flags[body] = (i + 1 < args.length) ? unquote(args[i + 1]) : '';
          i++;
          continue;
        }
        for (var c = 0; c < body.length; c++) flags[body.charAt(c)] = true;
      } else {
        rest.push(unquote(a));
      }
    }
    return { flags: flags, rest: rest };
  }

  // A directory entry line. Long form apes `ls -l`: mode, size, date, name.
  function writeEntry(node, longForm) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--entry';

    if (longForm) {
      line.appendChild(textSpan(
        node.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--', 'term-mode'));
      // Directories report child count, files their word count: the closest
      // honest analogue of a byte size when the body is an excerpt.
      line.appendChild(textSpan(node.type === 'dir'
        ? pad(countChildren(node), 4)
        : pad((node.post && node.post.words) || 0, 4), 'term-size'));
      // Directories have no single date, so the column shows a dash rather
      // than ten blanks, which read as a rendering fault in the built page.
      line.appendChild(textSpan(
        (node.post && node.post.date) || '    -     ', 'term-date'));
    }

    line.appendChild(textSpan(
      node.name + (node.type === 'dir' ? '/' : ''),
      node.type === 'dir' ? 'term-dirname' : 'term-filename'));

    if (longForm && node.post && node.post.title) {
      line.appendChild(textSpan(node.post.title, 'term-entry-title'));
    }
    out.appendChild(line);
  }

  // README.md and about.md are generated rather than post-backed, so their
  // text lives here. Keeps `cat README.md` from being a special-cased error.
  function synthFile(name) {
    if (name === 'README.md') {
      return [
        (site.title || 'this blog') + ' - terminal view',
        '',
        'This is a filesystem, not a menu. Posts are files; move around with',
        'the usual commands:',
        '',
        '  ls  cd  pwd  tree  cat  head  tail  grep  find  wc  stat  du',
        '',
        'The same post appears in posts/, categories/ and tags/, the way a',
        'hardlink shows one file in several places.',
        '',
        'Try:  cd posts   then   ls -l   then   cat <tab>',
        'Or:   find . -name "*docker*"   |   grep -i kubernetes',
        '',
        'help lists everything. man <command> explains one.'
      ];
    }
    if (name === 'about.md') {
      return [
        site.title || 'this blog',
        site.tagline || '',
        '',
        'Cloud infrastructure and systems engineer. This blog covers',
        'homelab builds, Linux, DevOps, networking and security.',
        '',
        posts.length + ' posts published.',
        site.github ? 'github.com/' + site.github : ''
      ];
    }
    return null;
  }

  // Wrap to a column and return the lines, so head/tail/wc all measure the
  // same "lines" the reader sees. writeWrapped prints; this one returns.
  function wrapLines(text, width) {
    var max = width || 76;
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      if (line && (line.length + 1 + words[i].length) > max) {
        lines.push(line);
        line = words[i];
      } else {
        line = line ? (line + ' ' + words[i]) : words[i];
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Shell glob, only * and ?, matched by walking the pattern. Deliberately
  // NOT compiled to a RegExp: user-typed patterns must never reach the regex
  // engine (ReDoS), and the same rule already governs grep.
  function globMatch(name, pattern) {
    var n = String(name).toLowerCase();
    var p = String(pattern).toLowerCase();

    // Iterative wildcard match with backtracking on the last '*'.
    var ni = 0, pi = 0, star = -1, mark = 0;
    while (ni < n.length) {
      if (pi < p.length && (p.charAt(pi) === '?' || p.charAt(pi) === n.charAt(ni))) {
        ni++; pi++;
      } else if (pi < p.length && p.charAt(pi) === '*') {
        star = pi++; mark = ni;
      } else if (star >= 0) {
        pi = star + 1; ni = ++mark;
      } else {
        return false;
      }
    }
    while (pi < p.length && p.charAt(pi) === '*') pi++;
    return pi === p.length;
  }

  // A grep hit: path, then the title. Separate elements, never innerHTML.
  function writeMatch(path, post) {
    var line = document.createElement('div');
    line.className = 'term-line term-line--match';
    line.appendChild(textSpan(path, 'term-filename'));
    line.appendChild(textSpan(post.title || '(untitled)', 'term-entry-title'));
    out.appendChild(line);
  }

  var MANPAGES = {
    ls: { name: 'list directory contents',
          usage: 'ls [-l] [path]',
          desc: ['Lists directories first, then files. -l adds the mode, a size',
                 '(child count for directories, word count for posts), the post',
                 'date and the full title.'] },
    cd: { name: 'change the working directory',
          usage: 'cd <path>',
          desc: ['Accepts absolute (~/posts, /posts), relative (posts,',
                 '../tags), . and .., and "cd -" to go back to the previous',
                 'directory. Bare cd returns to ~.'] },
    pwd: { name: 'print working directory',
           usage: 'pwd',
           desc: ['Prints the current path. The prompt shows it too.'] },
    cat: { name: 'concatenate and print files',
           usage: 'cat <file>...',
           desc: ['Prints a post excerpt with its date, URL, categories and',
                  'tags. Several files print with ==> headers, like the real',
                  'thing. Use open to read the full post in the browser.'] },
    grep: { name: 'search post text and titles',
            usage: 'grep [-i] [-l] <string> [path]',
            desc: ['Substring search, always case-insensitive. -l prints only',
                   'the matching paths. A path argument limits the search, so',
                   '"grep docker categories/devops" works. Matching is plain',
                   'indexOf, not a regex, so no pattern can hang the page.'] },
    find: { name: 'find files by name',
            usage: 'find [path] -name <pattern>',
            desc: ['Walks the tree from path (default: here) and prints files',
                   'whose name matches a glob. * and ? are supported:',
                   'find . -name "*docker*"'] },
    tree: { name: 'list the tree',
            usage: 'tree [path]',
            desc: ['Prints the tree with the usual glyphs. Depth is capped so',
                   'one keystroke cannot dump every tag directory; cd in for',
                   'the rest.'] },
    head: { name: 'print the first lines of a file',
            usage: 'head [-n N] <file>',
            desc: ['Default 10 lines, wrapped at 76 columns.'] },
    tail: { name: 'print the last lines of a file',
            usage: 'tail [-n N] <file>',
            desc: ['Default 10 lines, wrapped at 76 columns.'] },
    wc: { name: 'count lines and words',
          usage: 'wc [-w|-l] <file>',
          desc: ['Prints lines then words. The word count is the whole post,',
                 'while the text shown here is an excerpt, so they disagree',
                 'on purpose.'] },
    stat: { name: 'file metadata',
            usage: 'stat <file>',
            desc: ['Type, size, date, URL, categories and tags for one file.'] },
    du: { name: 'summarise size',
          usage: 'du [path]',
          desc: ['Total words under a path. A post filed under several',
                 'categories or tags is counted once.'] },
    open: { name: 'open the real post',
            usage: 'open [file]',
            desc: ['Navigates the browser to the post this file stands for.',
                   'This is the one command that leaves the terminal.'] },
    skin: { name: 'change the terminal palette',
            usage: 'skin [name]',
            desc: ['matrix, amber, paper or netscape. Scoped to the console,',
                   'so it never changes the site theme. Saved per browser.'] },
    file: { name: 'identify a path',
            usage: 'file <path>',
            desc: ['Says whether a path is a directory, a post, or generated.'] },
    man: { name: 'show a manual page',
           usage: 'man <command>',
           desc: ['You are reading one.'] },
    help: { name: 'list the commands',
            usage: 'help',
            desc: ['Grouped by what you are trying to do.'] }
  };

  /* ---------- commands ---------- */

  // Reading one file. Shared by cat/less/head/tail so they cannot drift:
  // they differ only in how much they show.
  function catOne(target, showHeader, limit, fromEnd) {
    var found = resolvePath(target);
    if (!found) {
      write('cat: ' + target + ': No such file or directory', 'err');
      return;
    }
    if (found.node.type === 'dir') {
      write('cat: ' + target + ': Is a directory', 'err');
      return;
    }

    if (showHeader) write('==> ' + pathString(found.segments) + ' <==', 'dim');

    // Generated file: print its canned text and stop.
    if (!found.node.post) {
      var synth = synthFile(found.node.name) || ['(empty)'];
      var slice = synth;
      if (limit) {
        slice = fromEnd ? synth.slice(-limit) : synth.slice(0, limit);
      }
      for (var s = 0; s < slice.length; s++) {
        write(slice[s], (!limit && s === 0) ? 'accent' : null);
      }
      return;
    }

    var post = found.node.post;

    // head/tail operate on the wrapped body, which is what a reader means
    // by "the first few lines" of a post.
    if (limit) {
      var lines = wrapLines(post.excerpt || '', 76);
      var take = fromEnd ? lines.slice(-limit) : lines.slice(0, limit);
      for (var i = 0; i < take.length; i++) write(take[i]);
      return;
    }

    write(post.title, 'accent');
    write(post.date + '  ' + post.url, 'dim');
    if (post.categories && post.categories.length) {
      write('categories: ' + post.categories.join(', '), 'dim');
    }
    if (post.tags && post.tags.length) {
      write('tags: ' + post.tags.join(', '), 'dim');
    }
    writeBlank();
    if (post.excerpt) writeWrapped(post.excerpt);
    else write('(no text extracted)', 'dim');
    writeBlank();
    write('excerpt only. "open ' + found.node.name + '" for the full post', 'dim');
  }

  function fileOperand(cmdName, target) {
    var found = resolvePath(target);
    if (!found) {
      write(cmdName + ': ' + target + ': No such file or directory', 'err');
      return null;
    }
    return found;
  }

  var COMMANDS = {
    help: function () {
      write('navigation', 'accent');
      write('  ls [-l] [path]        list a directory');
      write('  cd <path>             change directory (.. - ~ / all work)');
      write('  pwd                   print working directory');
      write('  tree [path]           show the tree');
      writeBlank();
      write('reading', 'accent');
      write('  cat <file>...         print a post excerpt');
      write('  head/tail [-n N] <f>  first/last N lines');
      write('  less <file>           cat, without the pager');
      write('  open [file]           open the real post in the browser');
      writeBlank();
      write('searching', 'accent');
      write('  grep [-i] [-l] <str>  search titles and text');
      write('  find [path] -name <p> find files by glob pattern');
      write('  wc [-w|-l] <file>     word/line count');
      writeBlank();
      write('system', 'accent');
      write('  stat <file>           metadata for one file');
      write('  file <path>           what kind of thing is this');
      write('  du [path]             size of a tree, in words');
      write('  man <cmd>             help for one command');
      write('  history               what you have typed');
      write('  whoami  uname  date  env  echo  which  clear');
      writeBlank();
      write('elsewhere', 'accent');
      write('  modern  retro  skin [name]  neofetch  exit');
      writeBlank();
      write('tab completes commands AND paths, up/down for history', 'dim');
      write('start with: ls, then cd posts', 'dim');
    },

    about: function () {
      catOne('~/about.md', false);
    },

    ls: function (args) {
      var parsed = parseArgs(args);
      var longForm = !!(parsed.flags.l || parsed.flags.long);
      var target = parsed.rest.length ? parsed.rest[0] : '';

      var found = resolvePath(target);
      if (!found) {
        write('ls: cannot access ' + target + ': No such file or directory', 'err');
        return;
      }
      if (found.node.type === 'file') {
        writeEntry(found.node, longForm);
        return;
      }

      var entries = listing(found.node);
      if (!entries.length) {
        write('(empty)', 'dim');
        return;
      }
      if (longForm) write('total ' + entries.length, 'dim');
      for (var i = 0; i < entries.length; i++) writeEntry(entries[i], longForm);
      if (!longForm && entries.length > 8) {
        writeBlank();
        write(entries.length + ' entries, "ls -l" for detail', 'dim');
      }
    },

    cd: function (args) {
      var target = args.length ? args[0] : '~';

      if (target === '-') {
        if (!prevPath) {
          write('cd: OLDPWD not set', 'err');
          return;
        }
        var back = prevPath;
        prevPath = cwdPath.slice();
        cwdPath = back;
        cwd = nodeAt(cwdPath);
        write(currentPath(), 'dim');
        updatePrompt();
        return;
      }

      var found = resolvePath(target);
      if (!found) {
        write('cd: ' + target + ': No such file or directory', 'err');
        return;
      }
      if (found.node.type !== 'dir') {
        write('cd: ' + target + ': Not a directory', 'err');
        return;
      }
      prevPath = cwdPath.slice();
      cwd = found.node;
      cwdPath = found.segments;
      updatePrompt();
    },

    pwd: function () { write(currentPath()); },

    tree: function (args) {
      var target = args.length ? args[0] : '';
      var found = resolvePath(target);
      if (!found) {
        write('tree: ' + target + ': No such file or directory', 'err');
        return;
      }
      write(pathString(found.segments), 'accent');

      var dirs = 0;
      var files = 0;

      // Depth is capped: `tree ~` across every tag would otherwise dump
      // hundreds of lines from one keystroke.
      function walk(node, prefix, depth) {
        var entries = listing(node);
        for (var i = 0; i < entries.length; i++) {
          var child = entries[i];
          var last = (i === entries.length - 1);
          var pad2 = prefix + (last ? '    ' : '|   ');

          if (child.type === 'dir') {
            dirs++;
            write(prefix + (last ? '`-- ' : '|-- ') + child.name + '/');
            if (depth < 1) {
              walk(child, pad2, depth + 1);
            } else if (countChildren(child)) {
              write(pad2 + '`-- ... ' + countChildren(child) + ' more', 'dim');
            }
          } else {
            files++;
            write(prefix + (last ? '`-- ' : '|-- ') + child.name);
          }
        }
      }

      walk(found.node, '', 0);
      writeBlank();
      write(dirs + ' directories, ' + files + ' files', 'dim');
    },

    cat: function (args) {
      var parsed = parseArgs(args);
      if (!parsed.rest.length) {
        write('usage: cat <file>   (try "ls" first)', 'err');
        return;
      }
      for (var i = 0; i < parsed.rest.length; i++) {
        catOne(parsed.rest[i], parsed.rest.length > 1);
      }
    },

    head: function (args) {
      var parsed = parseArgs(args, { n: true });
      if (!parsed.rest.length) {
        write('usage: head [-n N] <file>', 'err');
        return;
      }
      var n = parseInt(parsed.flags.n, 10);
      if (!n || n < 1) n = 10;
      catOne(parsed.rest[0], false, n, false);
    },

    tail: function (args) {
      var parsed = parseArgs(args, { n: true });
      if (!parsed.rest.length) {
        write('usage: tail [-n N] <file>', 'err');
        return;
      }
      var n = parseInt(parsed.flags.n, 10);
      if (!n || n < 1) n = 10;
      catOne(parsed.rest[0], false, n, true);
    },

    open: function (args) {
      var target = args.length ? args[0] : '';
      var found = resolvePath(target);
      if (!found) {
        write('open: ' + target + ': No such file or directory', 'err');
        return;
      }
      if (found.node.type !== 'file') {
        write('open: ' + (target || currentPath()) + ': Is a directory', 'err');
        return;
      }
      if (!found.node.post) {
        write('open: ' + found.node.name + ' is generated, not a post', 'err');
        return;
      }
      write('opening: ' + found.node.post.title);
      window.setTimeout(function () {
        window.location.href = found.node.post.url;
      }, 350);
    },

    // Searches the excerpt+title data already embedded for cat, so it costs
    // no extra page weight. Plain substring matching, never RegExp: a typed
    // pattern compiled to a regex is a ReDoS hazard.
    grep: function (args) {
      var parsed = parseArgs(args);
      if (!parsed.rest.length) {
        write('usage: grep [-i] [-l] <string> [path]', 'err');
        return;
      }
      var needle = parsed.rest[0];
      if (needle.length < 2) {
        write('grep: search for at least 2 characters', 'err');
        return;
      }
      var where = parsed.rest.length > 1 ? parsed.rest[1] : '';
      var found = resolvePath(where);
      if (!found) {
        write('grep: ' + where + ': No such file or directory', 'err');
        return;
      }

      // Case-insensitive always: a blog search that is case-sensitive by
      // default would only annoy, so -i documents intent rather than changing it.
      var hay = needle.toLowerCase();
      var namesOnly = !!parsed.flags.l;

      var files = walkFiles(found.node, found.segments, []);
      var seen = {};
      var hits = 0;

      for (var i = 0; i < files.length; i++) {
        var post = files[i].node.post;
        if (!post) continue;
        // The same post appears under posts/, categories/ and tags/, so
        // dedupe by URL or every hit is reported three times.
        if (Object.prototype.hasOwnProperty.call(seen, post.url)) continue;

        var inTitle = (post.title || '').toLowerCase().indexOf(hay) !== -1;
        var inBody = (post.excerpt || '').toLowerCase().indexOf(hay) !== -1;
        if (!inTitle && !inBody) continue;

        seen[post.url] = 1;
        hits++;

        if (namesOnly) {
          write(files[i].path);
        } else {
          writeMatch(files[i].path, post);
          if (inBody) writeContext(post.excerpt, hay);
        }
      }

      if (!hits) {
        write('grep: no matches for ' + needle, 'err');
        return;
      }
      writeBlank();
      write(hits + (hits === 1 ? ' match' : ' matches'), 'dim');
    },

    // find [path] -name <glob>. Only * is supported, which covers what
    // anyone actually types here.
    find: function (args) {
      var parsed = parseArgs(args, { name: true });
      var where = parsed.rest.length ? parsed.rest[0] : '';
      var found = resolvePath(where);
      if (!found) {
        write('find: ' + where + ': No such file or directory', 'err');
        return;
      }

      var pattern = parsed.flags.name;
      var files = walkFiles(found.node, found.segments, []);
      var shown = 0;

      for (var i = 0; i < files.length; i++) {
        if (pattern && !globMatch(files[i].node.name, String(pattern))) continue;
        write(files[i].path);
        shown++;
      }

      if (!shown) {
        write(pattern ? 'find: no files match ' + pattern : 'find: nothing found', 'dim');
        return;
      }
      writeBlank();
      write(shown + ' file' + (shown === 1 ? '' : 's'), 'dim');
    },

    wc: function (args) {
      var parsed = parseArgs(args);
      if (!parsed.rest.length) {
        write('usage: wc [-w|-l] <file>', 'err');
        return;
      }
      var found = fileOperand('wc', parsed.rest[0]);
      if (!found) return;
      if (found.node.type === 'dir') {
        write('wc: ' + parsed.rest[0] + ': Is a directory', 'err');
        return;
      }

      var post = found.node.post;
      var text = post ? (post.excerpt || '')
                      : (synthFile(found.node.name) || []).join(' ');
      var words = (post && post.words) ? post.words : text.split(/\s+/).length;
      var lines = wrapLines(text, 76).length;

      if (parsed.flags.w) { write(words + '  ' + found.node.name); return; }
      if (parsed.flags.l) { write(lines + '  ' + found.node.name); return; }
      write(pad(lines, 5) + pad(words, 7) + '  ' + found.node.name);
      if (post) write('(words are the whole post; the body here is an excerpt)', 'dim');
    },

    stat: function (args) {
      if (!args.length) {
        write('usage: stat <file>', 'err');
        return;
      }
      var found = fileOperand('stat', args[0]);
      if (!found) return;

      var node = found.node;
      write('  File: ' + pathString(found.segments));
      write('  Type: ' + (node.type === 'dir' ? 'directory' : 'regular file'));
      if (node.type === 'dir') {
        write('Entries: ' + countChildren(node));
      } else if (node.post) {
        write('  Size: ' + (node.post.words || 0) + ' words');
        write('Modify: ' + node.post.date);
        write('   URL: ' + node.post.url);
        if (node.post.categories && node.post.categories.length) {
          write('   Cat: ' + node.post.categories.join(', '));
        }
        if (node.post.tags && node.post.tags.length) {
          write('  Tags: ' + node.post.tags.join(', '));
        }
      } else {
        write('  Size: generated');
      }
      write('Access: -r--r--r-- (read only, it is a blog)', 'dim');
    },

    file: function (args) {
      if (!args.length) {
        write('usage: file <path>', 'err');
        return;
      }
      var found = resolvePath(args[0]);
      if (!found) {
        write('file: ' + args[0] + ': No such file or directory', 'err');
        return;
      }
      if (found.node.type === 'dir') {
        write(args[0] + ': directory');
      } else if (found.node.post) {
        write(found.node.name + ': Markdown document, UTF-8 text, blog post');
      } else {
        write(found.node.name + ': Markdown document, UTF-8 text, generated');
      }
    },

    du: function (args) {
      var target = args.length ? args[0] : '';
      var found = resolvePath(target);
      if (!found) {
        write('du: ' + target + ': No such file or directory', 'err');
        return;
      }
      var files = walkFiles(found.node, found.segments, []);
      var seen = {};
      var words = 0;
      var unique = 0;
      for (var i = 0; i < files.length; i++) {
        var post = files[i].node.post;
        if (!post) continue;
        if (Object.prototype.hasOwnProperty.call(seen, post.url)) continue;
        seen[post.url] = 1;
        unique++;
        words += post.words || 0;
      }
      write(pad(words, 8) + '  ' + pathString(found.segments) + '  (words)');
      write(unique + ' unique posts; copies under categories/ and tags/ counted once', 'dim');
    },

    man: function (args) {
      if (!args.length) {
        write('What manual page do you want?', 'err');
        write('try: man ls', 'dim');
        return;
      }
      var name = String(args[0]).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(ALIASES, name)) name = ALIASES[name];
      if (!Object.prototype.hasOwnProperty.call(MANPAGES, name)) {
        write('No manual entry for ' + args[0], 'err');
        return;
      }
      var page = MANPAGES[name];
      write(name.toUpperCase() + '(1)', 'accent');
      writeBlank();
      write('NAME', 'accent');
      write('     ' + name + ' - ' + page.name);
      writeBlank();
      write('SYNOPSIS', 'accent');
      write('     ' + page.usage);
      writeBlank();
      write('DESCRIPTION', 'accent');
      for (var i = 0; i < page.desc.length; i++) write('     ' + page.desc[i]);
    },

    history: function () {
      if (!history.length) {
        write('(no history yet)', 'dim');
        return;
      }
      for (var i = 0; i < history.length; i++) {
        write(pad(i + 1, 4) + '  ' + history[i]);
      }
    },

    echo: function (args) {
      write(args.join(' '));
    },

    env: function () {
      write('USER=visitor');
      write('HOME=~');
      write('PWD=' + currentPath());
      write('SHELL=/bin/blogsh');
      write('TERM=xterm-256color');
      write('POSTS=' + posts.length);
      write('SKIN=' + (currentSkin() || 'matrix'));
    },

    which: function (args) {
      if (!args.length) {
        write('usage: which <command>', 'err');
        return;
      }
      var name = String(args[0]).toLowerCase();
      var real = Object.prototype.hasOwnProperty.call(ALIASES, name)
        ? ALIASES[name] : name;
      if (Object.prototype.hasOwnProperty.call(COMMANDS, real)) {
        write('/usr/bin/' + real + (real === name ? '' : '  (' + name + ' is an alias for ' + real + ')'));
      } else {
        write(name + ' not found', 'err');
      }
    },

    uname: function (args) {
      var parsed = parseArgs(args);
      if (parsed.flags.a) {
        write('blogsh static 4.0 #1 SMP jekyll x86_64 GNU/Linux');
        return;
      }
      write('blogsh');
    },

    date: function () {
      write(new Date().toString());
    },

    // less is cat without a pager: the output area already scrolls.
    less: function (args) {
      COMMANDS.cat(args);
    },

    // `posts` predates the filesystem and was in the tap bar, so it stays as
    // a shortcut for listing the posts directory in long form.
    posts: function () {
      COMMANDS.ls(['-l', '~/posts']);
    },

    neofetch: function () {
      var art = [
        '   .--.   ',
        '  |o_o |  ',
        '  |:_/ |  ',
        ' //   \\ \\ ',
        '(|     | )',
        '/\\_   _/\\ ',
        '\\___)=(___/'
      ];
      var rows = [
        ['visitor@blog', ''],
        ['os', 'jekyll static'],
        ['shell', 'blogsh 4.0'],
        ['posts', String(posts.length)],
        ['cwd', currentPath()],
        ['theme', currentSkin() || 'matrix'],
        ['uptime', 'since you loaded the page'],
        ['tracking', 'none']
      ];
      for (var i = 0; i < Math.max(art.length, rows.length); i++) {
        var a = art[i] || '           ';
        var r = rows[i];
        writeNeofetchRow(a, r ? r[0] : '', r ? r[1] : '');
      }
    },

    skin: function (args) {
      if (!args.length) {
        write('skins: matrix, amber, paper, netscape');
        write('current: ' + (currentSkin() || 'matrix'), 'dim');
        write('usage: skin <name>', 'dim');
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
      if (args.length) {
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

    // The other novelty route. Kept as a command as well as a link so all
    // three views are reachable from inside any of them.
    retro: function () {
      write('loading the retro version ...');
      window.setTimeout(function () {
        window.location.href = retroUrl;
      }, 400);
    },

    modern: function () {
      write('loading the modern site ...');
      window.setTimeout(function () {
        window.location.href = home;
      }, 300);
    }
  };

  var ALIASES = {
    dir: 'ls',
    ll: 'ls',
    la: 'ls',
    quit: 'exit',
    q: 'exit',
    cls: 'clear',
    '?': 'help',
    h: 'help',
    search: 'grep',
    theme: 'skin',
    fetch: 'neofetch',
    more: 'less',
    view: 'cat',
    cwd: 'pwd',
    hist: 'history'
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

      if (verb === 'man' || verb === 'which') {
        var cmds = commandNames();
        var cmdHits = [];
        for (var c = 0; c < cmds.length; c++) {
          if (cmds[c].indexOf(frag) === 0) cmdHits.push(cmds[c]);
        }
        applyCompletion(parts, cmdHits);
        return;
      }

      // Path completion for every command that takes one. Splits the
      // fragment into a directory part (resolved) and a leaf to match, so
      // "cat posts/2026-06" completes inside posts/.
      var raw = parts[parts.length - 1];
      var cut = raw.lastIndexOf('/');
      var dirPart = cut === -1 ? '' : raw.substring(0, cut + 1);
      var leaf = (cut === -1 ? raw : raw.substring(cut + 1)).toLowerCase();

      var base = resolvePath(dirPart);
      if (!base || base.node.type !== 'dir') return;

      var entries = listing(base.node);
      var names = [];
      for (var e = 0; e < entries.length; e++) {
        var nm = entries[e].name;
        if (nm.toLowerCase().indexOf(leaf) === 0) {
          // Keep the directory prefix the user typed, and append a slash to
          // directories so you can keep tabbing deeper.
          names.push(dirPart + nm + (entries[e].type === 'dir' ? '/' : ''));
        }
      }
      applyCompletion(parts, names);
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
    'mounting ~/posts ... ' + posts.length + ' entries',
    'building ~/categories and ~/tags ...',
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
