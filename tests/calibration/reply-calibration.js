const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Wave 3 R-24: calibration 工具搬到 tests/calibration/，回退 2 级才是 projectRoot。
const projectRoot = path.join(__dirname, "..", "..");
// Phase C-1: 前端文件搬到 web/，CLI 模拟浏览器运行时的 runScript 也跟着改路径。
const webRoot = path.join(projectRoot, "web");
// Wave 3 R-24: test set 和 output 也跟着搬到 tests/calibration/ 内部，
// 不再写到 projectRoot —— 输出物自封闭，repo 根保持干净。
const calibrationRoot = __dirname;

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

  // Phase C-2 (R-04)：app.js 顶部用 location 判 dev mode + bootstrap 用 fetch
  // 异步加载 cards.json / book-source.json。Node 里没有 location 也没有可用的
  // 相对 URL fetch，stub 它们让 app.js 解析时不 crash；fetch 故意返回 reject，
  // 让 app.js bootstrap 走 catch 分支。后面我们手动填 globals + 注册 debug hook。
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

// Phase C-2 (R-04)：card-data.js + book-source.js 已转 JSON 资产。
// 浏览器端走 fetch；Node CLI 模拟器直接 readFileSync + 把派生的 globals
// 注入跟原 card-data.js 末尾相同的 shape。
function loadCardData() {
  const fullPath = path.join(webRoot, "cards.json");
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
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
  const fullPath = path.join(webRoot, "book-source.json");
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  global.window.BOOK_OF_ELON_SOURCE = data;
}

function main() {
  bootstrapBrowserLikeRuntime();
  // Phase C-2 (R-04) 调用顺序：
  //   1. knowledge-base.js / model-client.js / reply-engine.js 提供函数定义；
  //   2. app.js 顶部 var cards = []; idToCard = {} 把 globals 重置 + 启动 IIFE
  //      bootstrap，bootstrap 调 fetch 立刻 reject，进 catch，cards 仍是 []；
  //   3. 我们手动 loadCardData() / loadBookSource() 填实际数据 +
  //      build knowledgeBase + 调 BOOK_OF_ELON_REGISTER_DEBUG_HOOK 注册钩子。
  //   getter 设计保证 BOOK_OF_ELON_DEBUG.cards 总是看到第 3 步填好的数据。
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

  const outputPath = path.join(calibrationRoot, "output-latest.md");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`WROTE ${outputPath}`);
  console.log(`CASES ${results.length}`);
}

main();

