const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = __dirname;
const defaultCaseIds = [
  "fear-start-project",
  "source-check",
  "related-topics",
  "career-meaning",
  "people-pleasing",
  "small-step",
];

function createElementStub(id = "") {
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
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
  window.BOOK_OF_ELON_RUNTIME_CONFIG = {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    model: "deepseek-chat",
    llmEnabled: true,
    chatEndpoint: "http://localhost:3000/api/chat",
  };
}

function runScript(filename) {
  const fullPath = path.join(projectRoot, filename);
  const code = fs.readFileSync(fullPath, "utf8");
  vm.runInThisContext(code, { filename: fullPath });
}

async function main() {
  bootstrapBrowserLikeRuntime();
  runScript("book-source.js");
  runScript("card-data.js");
  runScript("knowledge-base.js");
  runScript("model-client.js");
  runScript("reply-engine.js");
  runScript("app.js");

  const tests = JSON.parse(fs.readFileSync(path.join(projectRoot, "reply-test-set.json"), "utf8"));
  const requestedCaseIds = process.argv.slice(2);
  const caseIds = requestedCaseIds.length ? requestedCaseIds : defaultCaseIds;
  const selectedTests = caseIds
    .map((id) => tests.find((item) => item.id === id))
    .filter(Boolean);

  if (!selectedTests.length) {
    throw new Error("No matching test cases selected.");
  }

  const lines = [];
  lines.push("# DeepSeek Eval Output");
  lines.push("");
  lines.push(`评测问题数：${selectedTests.length}`);
  lines.push("");

  for (const [index, test] of selectedTests.entries()) {
    console.log(`RUNNING ${index + 1}/${selectedTests.length} ${test.id}`);
    const localPreview = window.BOOK_OF_ELON_DEBUG.previewReply(test.user_message);
    const payload = window.BOOK_OF_ELON_DEBUG.buildModelPayload(test.user_message, null);
    let status = 0;
    let reply = "";

    try {
      const response = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });

      status = response.status;
      const raw = await response.text();
      reply = raw;
      try {
        const parsed = JSON.parse(raw);
        reply = parsed.reply || raw;
      } catch {
        // keep raw text
      }
    } catch (error) {
      status = 0;
      reply = `请求失败：${error.message}`;
    }

    lines.push(`## ${index + 1}. ${test.id}`);
    lines.push(`- 主题：${test.theme}`);
    lines.push(`- 用户问题：${test.user_message}`);
    lines.push(`- 期望信号：${test.expected_signals.join(" / ")}`);
    lines.push(`- 推荐卡片：${localPreview.suggestedCards.join(" / ") || "无"}`);
    lines.push(`- 接口状态：${status}`);
    lines.push("- DeepSeek 回答：");
    lines.push("");
    lines.push(reply.trim());
    lines.push("");
    lines.push("- 本地回退稿：");
    lines.push("");
    lines.push(localPreview.reply);
    lines.push("");
  }

  const outputPath = path.join(projectRoot, "deepseek-eval-output.md");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`WROTE ${outputPath}`);
  console.log(`CASES ${selectedTests.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

