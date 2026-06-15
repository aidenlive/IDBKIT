/* Site interactions: theme, copy-to-clipboard, code tabs, scroll reveals. */
(function () {
  "use strict";

  function effectiveTheme() {
    var set = document.documentElement.dataset.theme;
    if (set === "light" || set === "dark") return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function updateThemeIcon() {
    var icon = document.querySelector("[data-theme-icon] use");
    if (!icon) return;
    // Show the icon for the mode you'd switch TO.
    var next = effectiveTheme() === "dark" ? "#i-sun" : "#i-moon";
    icon.setAttribute("href", next);
  }

  function initTheme() {
    var toggle = document.getElementById("theme-toggle");
    updateThemeIcon();
    if (!toggle) return;
    toggle.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("idbkit-theme", next);
      } catch (e) {}
      updateThemeIcon();
    });
    // React to system changes when no explicit choice is stored.
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", function () {
        if (!document.documentElement.dataset.theme) updateThemeIcon();
      });
  }

  function initCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var text = btn.getAttribute("data-copy");
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          // Fallback for older/insecure contexts.
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
          } catch (err) {}
          ta.remove();
        }
        var use = btn.querySelector("use");
        var prev = use ? use.getAttribute("href") : null;
        if (use) use.setAttribute("href", "#i-check");
        btn.dataset.copied = "true";
        window.setTimeout(function () {
          if (use && prev) use.setAttribute("href", prev);
          btn.dataset.copied = "false";
        }, 1400);
      });
    });
  }

  function initTabs() {
    var tabs = Array.prototype.slice.call(
      document.querySelectorAll('.tab[data-tab]')
    );
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.dataset.tab;
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          var pane = document.getElementById(t.dataset.tab);
          if (pane) pane.hidden = !on;
        });
        void target;
      });
    });
  }

  function initReveals() {
    var items = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window) || !items.length) {
      items.forEach(function (el) {
        el.classList.add("is-in");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    items.forEach(function (el) {
      io.observe(el);
    });
  }

  function init() {
    initTheme();
    initCopy();
    initTabs();
    initReveals();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
