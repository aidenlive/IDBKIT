/* Live playground — executes the real idbkit IIFE bundle (window.idbkit)
 * against the browser's IndexedDB. Nothing leaves the page.
 */
(function () {
  "use strict";

  var PRESETS = {
    quickstart: [
      'const { openDatabase, uuid } = idbkit;',
      "",
      "const db = await openDatabase({",
      '  name: "playground-" + uuid().slice(0, 8),',
      "  version: 1,",
      '  stores: { notes: { keyPath: "id" } },',
      "});",
      "",
      'log("Opened", db.name, "v" + db.version);',
      "",
      'for (const title of ["Buy milk", "Read the docs", "Ship idbkit"]) {',
      "  await db.store(\"notes\").add({ id: uuid(), title, at: Date.now() });",
      "}",
      "",
      'const all = await db.store("notes").getAll();',
      'log.ok("Wrote " + all.length + " notes:");',
      'for (const n of all) log("  •", n.title);',
      "cells(all.length);",
      "",
      "await db.delete();",
      'log.dim("Cleaned up.");',
    ].join("\n"),

    query: [
      "const { openDatabase, uuid } = idbkit;",
      "",
      "const db = await openDatabase({",
      '  name: "pg-query-" + uuid().slice(0, 8),',
      "  version: 1,",
      "  stores: {",
      "    tasks: {",
      '      keyPath: "id",',
      '      indexes: { byPriority: { keyPath: "priority" } },',
      "    },",
      "  },",
      "});",
      "",
      'const titles = ["Inbox zero","Refactor","Write tests","Deploy","Review PR","Plan"];',
      "await db.store(\"tasks\").bulkAdd(",
      "  titles.map((title, i) => ({",
      "    id: uuid(), title, priority: (i % 3) + 1, done: i % 2 === 0,",
      "  }))",
      ");",
      'log("Seeded", titles.length, "tasks");',
      "cells(titles.length);",
      "",
      "const urgent = await db",
      '  .store("tasks")',
      "  .query()",
      '  .index("byPriority")',
      "  .aboveOrEqual(2)",
      "  .filter((t) => !t.done)",
      "  .reverse()",
      "  .toArray();",
      "",
      'log.ok("priority >= 2 and not done, newest first:");',
      'for (const t of urgent) log("  [" + t.priority + "]", t.title);',
      "",
      "await db.delete();",
    ].join("\n"),

    bulk: [
      "const { openDatabase } = idbkit;",
      "",
      "const db = await openDatabase({",
      '  name: "pg-bulk-" + Date.now(),',
      "  version: 1,",
      '  stores: { rows: { keyPath: "id", autoIncrement: true } },',
      "});",
      "",
      "const N = 1000;",
      "const batch = Array.from({ length: N }, (_, i) => ({ n: i, sq: i * i }));",
      "const t0 = performance.now();",
      'await db.store("rows").bulkAdd(batch);',
      'log.ok("Inserted " + N + " rows in " + (performance.now() - t0).toFixed(1) + "ms");',
      "cells(120);",
      "",
      'log("Total count:", await db.store("rows").count());',
      "",
      'const page = await db.store("rows").paginate({ page: 1, pageSize: 10 });',
      'log("Offset page 1 of " + page.totalPages + ":");',
      'log("  ids", page.items.map((r) => r.id).join(", "));',
      "",
      'const ks = await db.store("rows").paginateKeyset({ pageSize: 5 });',
      'log("Keyset first 5:", ks.items.map((r) => r.id).join(", "), "| hasMore:", ks.hasMore);',
      "",
      "await db.delete();",
    ].join("\n"),

    transaction: [
      "const { openDatabase, uuid } = idbkit;",
      "",
      "const db = await openDatabase({",
      '  name: "pg-bank-" + uuid().slice(0, 8),',
      "  version: 1,",
      '  stores: { accounts: { keyPath: "id" } },',
      "});",
      "",
      "await db.store(\"accounts\").bulkPut([",
      '  { id: "alice", balance: 100 },',
      '  { id: "bob", balance: 0 },',
      "]);",
      'log("Start  -> Alice: 100 | Bob: 0");',
      "cells(2);",
      "",
      "async function transfer(from, to, amount) {",
      '  return db.transaction(["accounts"], "readwrite", async (tx) => {',
      '    const a = tx.store("accounts");',
      "    const src = await a.get(from);",
      "    const dst = await a.get(to);",
      '    if (src.balance < amount) throw new Error("Insufficient funds");',
      "    await a.put({ ...src, balance: src.balance - amount });",
      "    await a.put({ ...dst, balance: dst.balance + amount });",
      "  });",
      "}",
      "",
      'await transfer("alice", "bob", 30);',
      'const a1 = (await db.store("accounts").get("alice")).balance;',
      'const b1 = (await db.store("accounts").get("bob")).balance;',
      'log.ok("Sent 30 -> Alice: " + a1 + " | Bob: " + b1);',
      "",
      "try {",
      '  await transfer("alice", "bob", 1000);',
      "} catch (e) {",
      '  log.err("Rejected: " + e.message);',
      "}",
      'const a2 = (await db.store("accounts").get("alice")).balance;',
      'log("After rollback -> Alice: " + a2 + " (unchanged)");',
      "",
      "await db.delete();",
    ].join("\n"),

    backup: [
      "const { openDatabase } = idbkit;",
      "",
      "const db = await openDatabase({",
      '  name: "pg-backup-" + Date.now(),',
      "  version: 1,",
      '  stores: { items: { keyPath: "id" } },',
      "});",
      "",
      "await db.store(\"items\").bulkAdd([",
      '  { id: "a", label: "first" },',
      '  { id: "b", label: "second" },',
      '  { id: "c", label: "third" },',
      "]);",
      "cells(3);",
      "",
      "const snapshot = await db.export();",
      'log("Snapshot data:", JSON.stringify(snapshot.data).slice(0, 70) + "...");',
      "",
      "await db.clear();",
      'log.dim("Cleared -> count = " + (await db.store("items").count()));',
      "",
      "await db.import(snapshot);",
      'log.ok("Restored -> count = " + (await db.store("items").count()));',
      "",
      "await db.delete();",
    ].join("\n"),
  };

  var DEFAULT = "quickstart";

  function $(id) {
    return document.getElementById(id);
  }

  function safeStringify(value) {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    try {
      var seen = new WeakSet();
      var out = JSON.stringify(value, function (_k, v) {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      });
      return out === undefined ? String(value) : out;
    } catch (e) {
      return String(value);
    }
  }

  function init() {
    var consoleEl = $("pg-console");
    var cellsEl = $("pg-cells");
    var editor = $("pg-code");
    var runBtn = $("pg-run");
    var resetBtn = $("pg-reset");
    var clearBtn = $("pg-clear");
    var chips = Array.prototype.slice.call(
      document.querySelectorAll(".chip[data-preset]")
    );

    if (!editor || !runBtn) return;

    var reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    var current = DEFAULT;

    function write(text, cls) {
      var line = document.createElement("span");
      line.className = "log-line" + (cls ? " log-line--" + cls : "");
      line.textContent = text;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function fmt(args) {
      return Array.prototype.map.call(args, safeStringify).join(" ");
    }

    function log() {
      write(fmt(arguments));
    }
    log.ok = function () {
      write(fmt(arguments), "ok");
    };
    log.err = function () {
      write(fmt(arguments), "err");
    };
    log.dim = function () {
      write(fmt(arguments), "dim");
    };

    function cells(n) {
      cellsEl.innerHTML = "";
      var max = Math.min(Math.max(0, n | 0), 240);
      for (var i = 0; i < max; i++) {
        var c = document.createElement("span");
        c.className = "cell";
        if (!reduceMotion) c.style.animationDelay = i * 10 + "ms";
        cellsEl.appendChild(c);
      }
    }

    function clearOutput() {
      consoleEl.innerHTML = "";
      cellsEl.innerHTML = "";
    }

    function loadPreset(name) {
      current = name;
      editor.value = PRESETS[name] || "";
      chips.forEach(function (chip) {
        chip.setAttribute(
          "aria-pressed",
          chip.dataset.preset === name ? "true" : "false"
        );
      });
      clearOutput();
    }

    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var running = false;

    async function run() {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      var label = runBtn.textContent;
      runBtn.textContent = "Running…";
      clearOutput();
      try {
        var fn = new AsyncFunction("idbkit", "log", "cells", editor.value);
        await fn(window.idbkit, log, cells);
      } catch (err) {
        write(
          (err && err.name ? err.name + ": " : "Error: ") +
            (err && err.message ? err.message : String(err)),
          "err"
        );
      } finally {
        running = false;
        runBtn.disabled = false;
        runBtn.innerHTML =
          'Run <svg class="icon" aria-hidden="true"><use href="#i-play" /></svg>';
        void label;
      }
    }

    // Graceful degradation if the platform or bundle isn't available.
    var hasIDB = typeof indexedDB !== "undefined" && indexedDB !== null;
    var hasLib = !!(window.idbkit && window.idbkit.openDatabase);

    if (!hasIDB || !hasLib) {
      var notice = document.createElement("div");
      notice.className = "notice";
      notice.setAttribute("role", "note");
      if (!hasIDB) {
        notice.innerHTML =
          "<strong>IndexedDB isn’t available in this context.</strong> " +
          "This usually means the page was opened from a <code>file://</code> URL or a private window. " +
          "Serve the folder over http:// — e.g. run <code>npx serve</code> in the project — and reopen this page to use the playground.";
      } else {
        notice.innerHTML =
          "<strong>The idbkit bundle didn’t load.</strong> " +
          "Run <code>npm run build</code> to regenerate <code>site/vendor/idbkit.global.js</code>, then reload.";
      }
      var playground = document.querySelector(".playground");
      playground.insertBefore(notice, playground.firstChild);
      editor.value = PRESETS[DEFAULT];
      editor.setAttribute("readonly", "");
      runBtn.disabled = true;
      return;
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        loadPreset(chip.dataset.preset);
        editor.focus();
      });
    });

    runBtn.addEventListener("click", run);
    resetBtn.addEventListener("click", function () {
      loadPreset(current);
    });
    clearBtn.addEventListener("click", clearOutput);

    editor.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
      // Indent with tab instead of moving focus.
      if (e.key === "Tab") {
        e.preventDefault();
        var start = editor.selectionStart;
        var end = editor.selectionEnd;
        editor.value =
          editor.value.slice(0, start) + "  " + editor.value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
    });

    loadPreset(DEFAULT);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
