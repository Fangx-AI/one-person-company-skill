const { JSDOM, VirtualConsole } = require("jsdom");

(async () => {
  const url = "http://127.0.0.1:3000/";
  const fetchRes = await fetch(url);
  const html = await fetchRes.text();

  const errors = [];
  const logs = [];

  const vc = new VirtualConsole();
  vc.on("error", (e) => errors.push("[err] " + (e?.stack || e)));
  vc.on("warn", (m) => logs.push("[warn] " + m));
  vc.on("log", (m) => logs.push("[log] " + m));
  vc.on("info", (m) => logs.push("[info] " + m));
  vc.on("jsdomError", (e) =>
    errors.push("[jsdomError] " + (e?.stack || e?.message || e))
  );

  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  // Polyfill fetch in JSDOM so auth-ui.js doesn't crash during init
  dom.window.fetch = (path, opts = {}) => {
    const u = new URL(path, url).toString();
    return fetch(u, opts);
  };

  // Capture global script errors
  dom.window.addEventListener("error", (e) =>
    errors.push("[winerr] " + (e.error?.stack || e.message))
  );
  dom.window.addEventListener("unhandledrejection", (e) =>
    errors.push("[unhandled] " + (e.reason?.stack || e.reason))
  );

  await new Promise((r) => setTimeout(r, 4000));

  const win = dom.window;
  const doc = win.document;

  console.log("=== DOM check ===");
  console.log("quick-ask-input:", !!doc.getElementById("quick-ask-input"));
  console.log("quick-ask-submit:", !!doc.getElementById("quick-ask-submit"));
  console.log("detail-shell:", !!doc.getElementById("detail-shell"));
  console.log(
    "detail-shell hidden initially:",
    doc.getElementById("detail-shell")?.classList.contains("hidden")
  );
  console.log("openGenericCoach:", typeof win.openGenericCoach);
  console.log("cards loaded:", typeof win.cards, win.cards?.length || 0);

  console.log("\n=== Errors ===");
  if (errors.length === 0) console.log("(none)");
  errors.slice(0, 20).forEach((e) => console.log(e));

  console.log("\n=== Logs ===");
  logs.slice(0, 10).forEach((l) => console.log(l));

  console.log("\n=== Click submit ===");
  const input = doc.getElementById("quick-ask-input");
  const btn = doc.getElementById("quick-ask-submit");
  if (input && btn) {
    input.value = "测试问题：我现在很迷茫";
    btn.click();
    await new Promise((r) => setTimeout(r, 600));
    console.log(
      "detail-shell hidden after click:",
      doc.getElementById("detail-shell")?.classList.contains("hidden")
    );
    console.log(
      "messages preview:",
      (doc.getElementById("messages")?.innerHTML || "").slice(0, 200)
    );
  }

  console.log("\n=== Final errors after interaction ===");
  errors.slice(0, 30).forEach((e) => console.log(e));

  dom.window.close();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
