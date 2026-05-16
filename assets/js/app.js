/* =====================================================================
 * Joshua Mein — blog
 * Theme / a11y / rain toggles. Vanilla JS. No build step.
 * ===================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;

  function setAttr(name, value, storeKey, storeValue) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
    try { localStorage.setItem(storeKey, storeValue); } catch (e) {}
  }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = (root.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      setAttr('data-theme', next, 'theme', next);
    });
  }

  var a11yBtn = document.getElementById('a11y-toggle');
  if (a11yBtn) {
    a11yBtn.addEventListener('click', function () {
      var on = root.getAttribute('data-a11y') === 'true';
      setAttr('data-a11y', on ? null : 'true', 'a11y', on ? 'false' : 'true');
    });
  }

  var rainBtn = document.getElementById('rain-toggle');
  if (rainBtn) {
    rainBtn.addEventListener('click', function () {
      var off = root.getAttribute('data-rain') === 'off';
      setAttr('data-rain', off ? null : 'off', 'rain', off ? 'true' : 'false');
    });
  }

  // Update the footer year if we ever stop pre-rendering it from Liquid.
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
