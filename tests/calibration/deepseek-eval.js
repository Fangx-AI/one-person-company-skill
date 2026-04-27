const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Wave 3 R-24: calibration 工具搬到 tests/calibration/，回退 2 级才是 projectRoot。
const projectRoot = path.join(__dirname, "..", "..");
// Phase C-1: 前端文件搬到 web/，CLI 模拟浏览器运行时的 runScript 也跟着改路径。
const webRoot = path.join(projectRoot, "web");
const calibrationRoot = __dirname;
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

  // Phase C-2 (R-04)：参见 reply-calibration.js 的同名注释。
  global.location = global.location || { hostname: "localhost", host: "localhost" };
  if (typeof global.fetch !== "function" || !global.__calibrationFetchStubbed) {
    global.fetch = () => Promise.reject(new Error("fetch disabled in Node calibration runtime"));
    global.__calibrationFetchStubbed = true;
  }
}

function runScript(filename) {
  const fullPath = path.join(webRoot, filename);
  const code = fs.readFileSync(fullPath, "utf8");
  vm.runInThisContext(code, { filename: fullPath });
}

function loadCardData() {
  const data = JSON.parse(fs.readFileSync(path.join(webRoot, "cards.json"), "utf8"));
  global.cards = data.cards;
  global.featuredIds = data.featuredIds;
  global.quickAskPrompts = data.quickAskPrompts;
  global.featuredCardTags = data.featuredCardTags;
  global.topicLibraryGroups = data.topicLibraryGroups;
  const cardLibraryGroupById = Object.fromEntries(
    data.topicLibraryGroups.flatMap((g) =>
      g.cardIds.map((cardId) => [cardId, g.id])
    )
  );
  data.cards.forEach((card) => {
    card.frontend.library_group =
      cardLibraryGroupById[card.id] || "direction-meaning";
  });
  global.idToCard = Object.fromEntries(data.cards.map((c) => [c.id, c]));
}

function loadBookSource() {
  const data = JSON.parse(fs.readFileSync(path.join(webRoot, "book-source.json"), "utf8"));
  global.window.BOOK_OF_ELON_SOURCE = data;
}

async function main() {
  bootstrapBrowserLikeRuntime();
  runScript("knowledge-base.js");
  runScript("model-client.js");
  runScript("reply-engine.js");
  runScript("app.js");
  loadCardData();
  loadBookSource();
  if (typeof global.buildKnowledgeBase === "function") {
    global.knowledgeBase = global.buildKnowledgeBase(global.cards, global.window.BOOK_OF_ELON_SOURCE);
    global.window.BOOK_OF_ELON_KB = global.knowledgeBase;
  }
  if (typeof global.window.BOOK_OF_ELON_REGISTER_DEBUG_HOOK === "function") {
    global.window.BOOK_OF_ELON_REGISTER_DEBUG_HOOK();
  }

  const tests = JSON.parse(fs.readFileSync(path.join(calibrationRoot, "reply-test-set.json"), "utf8"));
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

  const outputPath = path.join(calibrationRoot, "deepseek-eval-output-latest.md");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`WROTE ${outputPath}`);
  console.log(`CASES ${selectedTests.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

