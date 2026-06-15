/* Minimal, dependency-free syntax highlighter for the static code samples.
 * Single-pass tokenizer over escaped text — no external library needed.
 */
(function () {
  "use strict";

  var KEYWORDS =
    "const|let|var|async|await|function|return|new|import|from|export|" +
    "interface|extends|implements|type|class|if|else|for|while|of|in|do|" +
    "switch|case|break|continue|throw|try|catch|finally|yield|as|" +
    "true|false|null|undefined|void|this|super|typeof|instanceof";

  // Order matters: comments, strings, numbers, keywords, Types, fn calls.
  var TOKEN = new RegExp(
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" + // 1 comment
      "|(`[^`]*`|\"[^\"]*\"|'[^']*')" + // 2 string
      "|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b" + // 3 number
      "|\\b(" +
      KEYWORDS +
      ")\\b" + // 4 keyword
      "|\\b([A-Z][A-Za-z0-9_]*)\\b" + // 5 Type
      "|\\b([A-Za-z_$][\\w$]*)(?=\\s*\\()", // 6 fn call
    "g"
  );

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlight(raw) {
    // `raw` is plain text (from textContent), so entities are already decoded.
    var escaped = escapeHtml(raw);
    return escaped.replace(
      TOKEN,
      function (m, com, str, num, kw, type, fn) {
        if (com) return '<span class="tok-com">' + com + "</span>";
        if (str) return '<span class="tok-str">' + str + "</span>";
        if (num) return '<span class="tok-num">' + num + "</span>";
        if (kw) return '<span class="tok-key">' + kw + "</span>";
        if (type) return '<span class="tok-type">' + type + "</span>";
        if (fn) return '<span class="tok-fn">' + fn + "</span>";
        return m;
      }
    );
  }

  function run() {
    var blocks = document.querySelectorAll("pre[data-lang] > code");
    blocks.forEach(function (code) {
      if (code.dataset.highlighted === "true") return;
      code.innerHTML = highlight(code.textContent);
      code.dataset.highlighted = "true";
    });
  }

  // Expose for re-highlighting dynamically inserted blocks if ever needed.
  window.idbkitHighlight = highlight;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
