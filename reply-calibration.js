const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = __dirname;

function createElementStub(id = "") {
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    dataset: {},
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    focus() {},
    closest() {
      return null;
    },
  };
}

function bootstrapBrowserLikeRuntime() {
  const elementCache = new Map();
  const getElement = (id) => {
    if (!elementCache.has(id)) {
      elementCache.set(id, createElementStub(id));
    }
    return elementCache.get(id);
  };

  global.window = global;
  global.document = {
    body: createElementStub("body"),
    getElementById: getElement,
    addEventListener() {},
    removeEventListener() {},
  };

  document.body.addEventListener = () => {};
  global.setTimeout = global.setTimeout || ((fn) => fn());
}

function runScript(filename) {
  const fullPath = path.join(projectRoot, filename);
  const code = fs.readFileSync(fullPath, "utf8");
  vm.runInThisContext(code, { filename: fullPath });
}

function main() {
  bootstrapBrowserLikeRuntime();
  runScript("book-source.js");
  runScript("card-data.js");
  runScript("knowledge-base.js");
  runScript("model-client.js");
  runScript("reply-engine.js");
  runScript("app.js");

  const tests = JSON.parse(fs.readFileSync(path.join(projectRoot, "reply-test-set.json"), "utf8"));
  const results = tests.map((test, index) => {
    const preview = window.BOOK_OF_ELON_DEBUG.previewReply(test.user_message);
    return {
      index: index + 1,
      id: test.id,
      theme: test.theme,
      user_message: test.user_message,
      expected_signals: test.expected_signals,
      suggested_cards: preview.suggestedCards,
      reply: preview.reply,
    };
  });

  const lines = [];
  lines.push("# Reply Calibration Output");
  lines.push("");
  lines.push(`总问题数：${results.length}`);
  lines.push("");

  for (const result of results) {
    lines.push(`## ${result.index}. ${result.id}`);
    lines.push(`- 主题：${result.theme}`);
    lines.push(`- 用户问题：${result.user_message}`);
    lines.push(`- 期望信号：${result.expected_signals.join(" / ")}`);
    lines.push(`- 推荐卡片：${result.suggested_cards.join(" / ") || "无"}`);
    lines.push("- 回答：");
    lines.push("");
    lines.push(result.reply);
    lines.push("");
  }

  const outputPath = path.join(projectRoot, "reply-calibration-output.md");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`WROTE ${outputPath}`);
  console.log(`CASES ${results.length}`);
}

main();

