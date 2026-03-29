var bookSource = window.BOOK_OF_ELON_SOURCE || null;
var knowledgeBase = buildKnowledgeBase(cards, bookSource);
window.BOOK_OF_ELON_KB = knowledgeBase;

const heroFloatingCards = document.getElementById("hero-floating-cards");
const featuredGrid = document.getElementById("featured-grid");
const topicLibraryGroupsEl = document.getElementById("topic-library-groups");
const quickChipRow = document.getElementById("quick-chip-row");
const randomCardBtn = document.getElementById("random-card-btn");
const askDirectBtn = document.getElementById("ask-direct-btn");
const quickAskInput = document.getElementById("quick-ask-input");
const quickAskSubmit = document.getElementById("quick-ask-submit");
const resumeConversationBlock = document.getElementById("resume-conversation-block");
const resumeConversationBadge = document.getElementById("resume-conversation-badge");
const resumeConversationTitle = document.getElementById("resume-conversation-title");
const resumeConversationMeta = document.getElementById("resume-conversation-meta");
const resumeConversationHint = document.getElementById("resume-conversation-hint");
const resumeConversationBtn = document.getElementById("resume-conversation-btn");
const resumeConversationDismissBtn = document.getElementById("resume-conversation-dismiss-btn");

const detailShell = document.getElementById("detail-shell");
const detailBackdrop = document.getElementById("detail-backdrop");
const detailCloseBtn = document.getElementById("detail-close-btn");
const detailEyebrow = document.getElementById("detail-eyebrow");
const detailTitle = document.getElementById("detail-title");
const detailHook = document.getElementById("detail-hook");
const detailSummary = document.getElementById("detail-summary");
const messagesEl = document.getElementById("messages");
const chatSystemNote = document.getElementById("chat-system-note");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSubmitBtn = document.getElementById("chat-submit-btn");

const CHAT_SESSION_STORAGE_KEY = "book-of-elon-chat-session-v1";
const CHAT_SESSION_VERSION = 1;
const CHAT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHAT_SESSION_MAX_MESSAGES = 24;

let currentCardId = null;
let chatMessages = [];
let isReplyPending = false;
let resumeSession = loadSavedSession();
let expandedTopicGroupIds = new Set();
let currentChatSystemNotice = "";

render();

function render() {
  renderHeroFloatingCards();
  renderFeaturedCards();
  renderTopicLibrary();
  renderQuickAskChips();
  renderResumeEntry();
  wireEvents();
}

function renderHeroFloatingCards() {
  const floatingConfig = [
    { id: "feel-the-fear-do-it-anyway", top: "0px", left: "24px" },
    { id: "start-before-world-ready", top: "110px", right: "14px" },
    { id: "first-principles-thinking", top: "320px", left: "90px" },
  ];

  heroFloatingCards.innerHTML = floatingConfig
    .map(({ id, ...position }, index) => {
      const card = idToCard[id];
      const style = Object.entries(position)
        .map(([key, value]) => `${key}:${value}`)
        .join(";");
      return `
        <article class="floating-card" data-card-id="${card.id}" style="${style}">
          <div class="floating-card__index">主题入口 ${String(index + 1).padStart(2, "0")}</div>
          <h3>${card.frontend.title_zh}</h3>
        </article>
      `;
    })
    .join("");
}

function renderFeaturedCards() {
  const spans = [7, 5, 5, 7, 6, 6];
  featuredGrid.innerHTML = featuredIds
    .map((id, index) => {
      const card = idToCard[id];
      const heatTag = featuredCardTags[id] || "热门";
      return `
        <article class="feature-card" data-card-id="${card.id}" data-span="${spans[index]}">
          <div class="feature-card__meta">
            <div class="feature-card__index">热卡 ${String(index + 1).padStart(2, "0")}</div>
            <span class="feature-card__tag">${heatTag}</span>
          </div>
          <h3>${card.frontend.title_zh}</h3>
          <button class="card-action" type="button">点开聊聊</button>
        </article>
      `;
    })
    .join("");
}

function renderTopicLibrary() {
  if (!topicLibraryGroupsEl) return;

  const beltGroups = [...topicLibraryGroups, ...topicLibraryGroups];
  topicLibraryGroupsEl.innerHTML = `
    <div class="topic-library-belt">
      <div class="topic-library-belt__track">
        ${beltGroups.map((group, index) => renderTopicLibraryGroupCard(group, index)).join("")}
      </div>
    </div>
  `;
}

function renderTopicLibraryGroupCard(group, index) {
  const cardsInGroup = group.cardIds.map((id) => idToCard[id]).filter(Boolean);
  const leadCard = cardsInGroup[0] || null;
  const isExpanded = expandedTopicGroupIds.has(group.id);
  const visibleTopics = isExpanded ? cardsInGroup : cardsInGroup.slice(0, 3);
  const hiddenCount = Math.max(0, cardsInGroup.length - visibleTopics.length);

  return `
    <article
      class="topic-library-group-card"
      aria-labelledby="topic-group-${group.id}-${index}"
      ${leadCard ? `data-card-id="${leadCard.id}"` : ""}
    >
      <div class="topic-library-group-card__meta">
        <span class="topic-library-group-card__eyebrow">主题组</span>
        <span class="topic-library-group-card__count">${cardsInGroup.length} 张卡</span>
      </div>
      <h3 id="topic-group-${group.id}-${index}">${group.title}</h3>
      <p class="topic-library-group-card__intro">${group.intro}</p>
      <div class="topic-library-group-card__topics">
        ${visibleTopics
          .map(
            (card) => `
              <button class="topic-library-group-card__topic-button" type="button" data-card-id="${card.id}">
                ${card.frontend.title_zh}
              </button>
            `
          )
          .join("")}
      </div>
      ${
        cardsInGroup.length > 3
          ? `
            <button
              class="topic-library-group-card__toggle"
              type="button"
              data-topic-group-toggle="${group.id}"
              aria-expanded="${isExpanded ? "true" : "false"}"
            >
              ${isExpanded ? "收起这一组" : `展开其余 ${hiddenCount} 张`}
            </button>
          `
          : ""
      }
    </article>
  `;
}

function renderQuickAskChips() {
  quickChipRow.innerHTML = quickAskPrompts
    .map((prompt) => `<button class="chip-button" type="button" data-quick-ask="${prompt}">${prompt}</button>`)
    .join("");
}

function renderResumeEntry() {
  if (!resumeConversationBlock) return;

  if (!resumeSession) {
    resumeConversationBlock.classList.add("hidden");
    return;
  }

  resumeConversationBadge.textContent = getSessionBadgeLabel(resumeSession);
  resumeConversationTitle.textContent = getSessionTitle(resumeSession);
  resumeConversationMeta.textContent = getSessionMeta(resumeSession);
  resumeConversationHint.textContent = getSessionHint(resumeSession);
  if (resumeConversationBtn) {
    resumeConversationBtn.textContent = getSessionButtonLabel(resumeSession);
  }
  resumeConversationBlock.classList.remove("hidden");
}

function wireEvents() {
  document.body.addEventListener("click", (event) => {
    const topicGroupToggle = event.target.closest("[data-topic-group-toggle]");
    if (topicGroupToggle) {
      toggleTopicGroup(topicGroupToggle.dataset.topicGroupToggle);
      return;
    }

    const cardTrigger = event.target.closest("[data-card-id]");
    if (cardTrigger) {
      openCard(cardTrigger.dataset.cardId);
      return;
    }

    const quickAskTrigger = event.target.closest("[data-quick-ask]");
    if (quickAskTrigger) {
      openGenericCoach(quickAskTrigger.dataset.quickAsk);
    }
  });

  randomCardBtn.addEventListener("click", () => {
    const pick = featuredIds[Math.floor(Math.random() * featuredIds.length)];
    openCard(pick);
  });

  askDirectBtn.addEventListener("click", () => openGenericCoach(""));

  quickAskSubmit.addEventListener("click", () => {
    const message = quickAskInput.value.trim();
    openGenericCoach(message);
  });

  quickAskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const message = quickAskInput.value.trim();
      openGenericCoach(message);
    }
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = chatInput.value.trim();
    if (!value) return;
    pushUserMessage(value);
  });

  if (resumeConversationBtn) {
    resumeConversationBtn.addEventListener("click", resumeSavedConversation);
  }

  if (resumeConversationDismissBtn) {
    resumeConversationDismissBtn.addEventListener("click", clearSavedSession);
  }

  detailCloseBtn.addEventListener("click", closeDetail);
  detailBackdrop.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailShell.classList.contains("hidden")) {
      closeDetail();
    }
  });
}

function openCard(cardId) {
  const card = idToCard[cardId];
  if (!card) return;

  currentCardId = cardId;
  currentChatSystemNotice = "";

  applyCardDetail(card);
  chatMessages = [{ role: "assistant", text: buildOpeningMessage(card) }];

  updateConversationDensity();
  renderMessages();
  showDetail();
  persistChatSession();
}

function openGenericCoach(initialQuestion) {
  currentCardId = null;
  currentChatSystemNotice = "";
  applyGenericDetail();
  chatMessages = [
    {
      role: "assistant",
      text: "直接说你现在卡住的问题就行。我会先帮你找到最相关的主题，再陪你往下拆。",
    },
  ];

  updateConversationDensity();
  renderMessages();
  showDetail();
  persistChatSession();

  if (initialQuestion) {
    pushUserMessage(initialQuestion);
  }
}

function renderMessages() {
  updateConversationDensity();
  renderChatSystemNote();
  messagesEl.innerHTML = chatMessages
    .map(
      (message) => `
        <article class="message message--${message.role}${message.pending ? " message--pending" : ""}">
          ${formatMessage(message.text)}
        </article>
      `
    )
    .join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function pushUserMessage(text) {
  if (isReplyPending) return;

  chatMessages.push({ role: "user", text });
  chatInput.value = "";
  setComposerState(true);
  renderMessages();
  persistChatSession();

  const card = currentCardId ? idToCard[currentCardId] : null;
  const pendingMessage = {
    role: "assistant",
    text: buildPendingMessage(),
    pending: true,
  };
  chatMessages.push(pendingMessage);
  renderMessages();

  try {
    const assistantResult = await generateAssistantReply(text, card);
    currentChatSystemNotice = assistantResult.degraded ? assistantResult.notice : "";
    pendingMessage.text = assistantResult.text;
    delete pendingMessage.pending;
  } finally {
    setComposerState(false);
    renderMessages();
    persistChatSession();
  }
}

function setComposerState(disabled) {
  isReplyPending = disabled;
  chatInput.disabled = disabled;
  if (chatSubmitBtn) chatSubmitBtn.disabled = disabled;
}

function updateConversationDensity() {
  const hasUserStartedChat = chatMessages.some((message) => message.role === "user");
  detailShell.classList.toggle("chat-active", hasUserStartedChat);
}

function showDetail() {
  detailShell.classList.remove("hidden");
  detailShell.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => chatInput.focus(), 40);
}

function closeDetail() {
  persistChatSession();
  detailShell.classList.add("hidden");
  detailShell.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderChatSystemNote() {
  if (!chatSystemNote) return;

  if (!currentChatSystemNotice) {
    chatSystemNote.textContent = "";
    chatSystemNote.classList.add("hidden");
    return;
  }

  chatSystemNote.textContent = currentChatSystemNotice;
  chatSystemNote.classList.remove("hidden");
}

function toggleTopicGroup(groupId) {
  if (!groupId) return;

  if (expandedTopicGroupIds.has(groupId)) {
    expandedTopicGroupIds.delete(groupId);
  } else {
    expandedTopicGroupIds.add(groupId);
  }

  renderTopicLibrary();
}

function applyCardDetail(card) {
  detailEyebrow.textContent = `${card.backend.part_en} / ${card.backend.theme_en}`;
  detailTitle.textContent = card.frontend.title_zh;
  detailHook.textContent = card.frontend.hook_zh;
  detailSummary.textContent = card.frontend.summary_zh;
  syncDetailDescriptions();
}

function applyGenericDetail() {
  detailEyebrow.textContent = "开放提问 / 中文思考教练";
  detailTitle.textContent = "直接开始提问";
  detailHook.textContent = "你可以先说出你现在真实卡住的问题，我会把它尽量连接到合适的主题。";
  detailSummary.textContent =
    "这是一个基于《The Book of Elon》主题知识构建的中文互动教练入口。它优先帮你澄清问题，再把你带向合适的卡片和思想主题。";
  syncDetailDescriptions();
}

function applySavedDetail(session) {
  const card = session.currentCardId ? idToCard[session.currentCardId] : null;
  if (card) {
    applyCardDetail(card);
    return;
  }

  const detailMeta = session.detailMeta || {};
  detailEyebrow.textContent = detailMeta.eyebrow || "OPEN QUESTION / CHINESE THOUGHT COACH";
  detailTitle.textContent = detailMeta.title || "继续上次对话";
  detailHook.textContent = detailMeta.hook || "继续回到你上次聊到的地方。";
  detailSummary.textContent = detailMeta.summary || "";
  syncDetailDescriptions();
}

function resumeSavedConversation() {
  const session = loadSavedSession();
  if (!session) {
    resumeSession = null;
    renderResumeEntry();
    return;
  }

  currentCardId = session.currentCardId || null;
  currentChatSystemNotice = "";
  chatMessages = session.chatMessages.map((message) => ({
    role: message.role,
    text: message.text,
  }));
  setComposerState(false);
  applySavedDetail(session);
  renderMessages();
  showDetail();
  persistChatSession();
}

function persistChatSession() {
  const snapshot = buildChatSessionSnapshot();
  if (!snapshot) return;

  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    resumeSession = snapshot;
    renderResumeEntry();
  } catch (error) {
    console.warn("Unable to persist chat session locally.", error);
  }
}

function clearSavedSession() {
  resumeSession = null;
  const storage = getSessionStorage();

  try {
    if (storage) {
      storage.removeItem(CHAT_SESSION_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Unable to clear saved chat session.", error);
  }

  renderResumeEntry();
}

function buildChatSessionSnapshot() {
  const sanitizedMessages = sanitizeChatMessages(chatMessages);
  if (!sanitizedMessages.length || !sanitizedMessages.some((message) => message.role === "user")) {
    return null;
  }

  return {
    version: CHAT_SESSION_VERSION,
    savedAt: Date.now(),
    currentCardId,
    chatContextType: currentCardId ? "card" : "open",
    detailMeta: {
      eyebrow: detailEyebrow.textContent,
      title: detailTitle.textContent,
      hook: detailHook.textContent,
      summary: detailSummary.textContent,
    },
    chatMessages: sanitizedMessages,
  };
}

function loadSavedSession() {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CHAT_SESSION_VERSION) {
      storage.removeItem(CHAT_SESSION_STORAGE_KEY);
      return null;
    }

    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > CHAT_SESSION_TTL_MS) {
      storage.removeItem(CHAT_SESSION_STORAGE_KEY);
      return null;
    }

    const sanitizedMessages = sanitizeChatMessages(parsed.chatMessages || []);
    if (!sanitizedMessages.length || !sanitizedMessages.some((message) => message.role === "user")) {
      storage.removeItem(CHAT_SESSION_STORAGE_KEY);
      return null;
    }

    return {
      version: CHAT_SESSION_VERSION,
      savedAt: parsed.savedAt,
      currentCardId: typeof parsed.currentCardId === "string" && parsed.currentCardId ? parsed.currentCardId : null,
      chatContextType: parsed.chatContextType === "card" ? "card" : "open",
      detailMeta: sanitizeDetailMeta(parsed.detailMeta),
      chatMessages: sanitizedMessages,
    };
  } catch (error) {
    console.warn("Unable to load saved chat session.", error);
    return null;
  }
}

function getSessionStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function sanitizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .filter((message) => !message.pending)
    .map((message) => ({
      role: message.role,
      text: String(message.text || "").trim(),
    }))
    .filter((message) => message.text)
    .slice(-CHAT_SESSION_MAX_MESSAGES);
}

function sanitizeDetailMeta(detailMeta) {
  return {
    eyebrow: String(detailMeta?.eyebrow || "").trim(),
    title: String(detailMeta?.title || "").trim(),
    hook: String(detailMeta?.hook || "").trim(),
    summary: String(detailMeta?.summary || "").trim(),
  };
}

function getSessionTitle(session) {
  if (session.currentCardId && idToCard[session.currentCardId]) {
    return idToCard[session.currentCardId].frontend.title_zh;
  }

  return session.detailMeta.title || "继续上次的开放提问";
}

function getSessionHint(session) {
  const latestUserMessage = [...session.chatMessages].reverse().find((message) => message.role === "user");
  return latestUserMessage ? `上次聊到：${truncateText(latestUserMessage.text, 56)}` : "回到你上次停下来的地方。";
}

function getSessionBadgeLabel(session) {
  return session.chatContextType === "card" ? "卡片对话" : "开放提问";
}

function getSessionMeta(session) {
  return `${formatSavedTime(session.savedAt)} · ${session.chatMessages.length} 条消息`;
}

function getSessionButtonLabel(session) {
  return session.chatContextType === "card" ? "继续聊这张卡" : "继续提问";
}

function formatSavedTime(savedAt) {
  const diffMs = Math.max(0, Date.now() - savedAt);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "刚刚保存";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前保存`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前保存`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前保存`;

  return new Date(savedAt).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function syncDetailDescriptions() {
  detailHook.hidden = !detailHook.textContent.trim();
  detailSummary.hidden = !detailSummary.textContent.trim();
}

function formatMessage(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.BOOK_OF_ELON_DEBUG = {
  cards,
  knowledgeBase,
  runtimeConfig,
  buildUserContext,
  classifyIntent,
  findRelevantCards,
  searchKnowledgeBase,
  buildModelPayload,
  previewReply(userText, cardId = null) {
    chatMessages = [];
    const card = cardId ? idToCard[cardId] : null;
    return {
      userText,
      cardId: card?.id || null,
      cardTitle: card?.frontend.title_zh || null,
      reply: generateReply(userText, card),
      suggestedCards: findRelevantCards(userText).slice(0, 3).map((item) => item.frontend.title_zh),
    };
  },
};
