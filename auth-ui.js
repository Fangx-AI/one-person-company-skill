(() => {
  "use strict";

  const PHONE_REGEX = /^1[3-9]\d{9}$/;
  const CODE_REGEX = /^\d{6}$/;
  const RESEND_COOLDOWN_S = 60;

  const state = {
    user: null,
    northStar: null,
    pendingPhone: null,
    pendingNorthStar: null,
    resendTimer: null,
    resendUntil: 0,
  };

  const dom = {};

  function $(id) {
    return document.getElementById(id);
  }

  function bindDom() {
    Object.assign(dom, {
      header: $("site-header"),
      loginBtn: $("login-btn"),
      heroAnon: $("hero-state-anon"),
      heroAuthed: $("hero-state-authed"),
      nsForm: $("north-star-form"),
      nsInput: $("north-star-input"),
      nsSubmit: $("north-star-submit"),
      nsHint: $("north-star-form-hint"),
      nsError: $("north-star-form-error"),
      nsDisplayText: $("north-star-display-text"),
      nsDisplayMeta: $("north-star-display-meta"),
      nsDisplay: $("north-star-display"),
      nsEmpty: $("north-star-empty"),
      setNsBtn: $("set-north-star-btn"),
      editNsBtn: $("edit-north-star-btn"),
      openChatBtn: $("open-chat-btn"),
      modal: $("auth-modal"),
      modalBackdrop: $("auth-modal-backdrop"),
      modalClose: $("auth-modal-close"),
      modalIntro: $("auth-modal-intro"),
      modalTitle: $("auth-modal-title"),
      stepPhone: $("auth-step-phone"),
      stepCode: $("auth-step-code"),
      phoneInput: $("auth-phone"),
      codeInput: $("auth-code"),
      sendBtn: $("auth-send-code"),
      verifyBtn: $("auth-verify-code"),
      resendBtn: $("auth-resend"),
      resendText: $("auth-resend-text"),
      resendCounter: $("auth-resend-counter"),
      changePhoneBtn: $("auth-change-phone"),
      sentPhone: $("auth-sent-phone"),
      formError: $("auth-form-error"),
      devNotice: $("auth-form-dev-notice"),
      memoryModal: $("memory-modal"),
      memoryBackdrop: $("memory-modal-backdrop"),
      memoryClose: $("memory-modal-close"),
      memoryBody: $("memory-modal-body"),
      memoryLogout: $("memory-modal-logout"),
    });
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json: json || {} };
  }

  function renderHeader() {
    if (state.user) {
      const phoneShort = formatPhone(state.user.phone);
      dom.loginBtn.classList.remove("site-header__login-btn");
      dom.loginBtn.classList.add("site-header__user-btn");
      dom.loginBtn.innerHTML = `
        <span class="site-header__user-phone">${phoneShort}</span>
        <span class="site-header__user-arrow">▾</span>
      `;
      dom.loginBtn.onclick = openUserMenu;
    } else {
      dom.loginBtn.classList.remove("site-header__user-btn");
      dom.loginBtn.classList.add("site-header__login-btn");
      dom.loginBtn.textContent = "登录";
      dom.loginBtn.onclick = () => openModal({ purpose: "login" });
    }
  }

  function renderHero() {
    if (!dom.heroAnon || !dom.heroAuthed) return;
    if (state.user) {
      dom.heroAnon.classList.add("hidden");
      dom.heroAuthed.classList.remove("hidden");

      if (state.northStar) {
        dom.nsDisplay?.classList.remove("hidden");
        dom.nsEmpty?.classList.add("hidden");
        if (dom.nsDisplayText) dom.nsDisplayText.textContent = state.northStar.text;
        if (dom.nsDisplayMeta) {
          const date = new Date(state.northStar.setAt);
          dom.nsDisplayMeta.textContent = `于 ${formatDate(date)} 写下 · 总对话 ${state.user.totalChatTurns} 次`;
        }
      } else {
        dom.nsDisplay?.classList.add("hidden");
        dom.nsEmpty?.classList.remove("hidden");
      }
    } else {
      dom.heroAnon.classList.remove("hidden");
      dom.heroAuthed.classList.add("hidden");
    }
  }

  function formatPhone(phone) {
    if (!phone || phone.length < 11) return phone || "";
    return `${phone.slice(0, 3)} **** ${phone.slice(7)}`;
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}.${m}.${d}`;
  }

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function clearError(el) {
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function openUserMenu() {
    if (!state.user) return;
    openMemoryModal();
  }

  const KIND_LABELS = {
    intend: "在打算的",
    blocker: "卡在哪里",
    deadline: "时间锚",
    done: "已经做了",
    belief: "你相信的",
  };
  const KIND_ORDER = ["intend", "blocker", "deadline", "done", "belief"];

  async function openMemoryModal() {
    if (!dom.memoryModal) return;
    dom.memoryBody.innerHTML = '<p class="memory-modal__loading">加载中…</p>';
    dom.memoryModal.classList.remove("hidden");
    dom.memoryModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    await refreshMemoryModal();
  }

  function closeMemoryModal() {
    if (!dom.memoryModal) return;
    dom.memoryModal.classList.add("hidden");
    dom.memoryModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  async function refreshMemoryModal() {
    const { status, json } = await api("/api/me/dashboard");
    if (status !== 200) {
      dom.memoryBody.innerHTML = '<p class="memory-modal__empty">没拉到数据，稍后再试。</p>';
      return;
    }
    if (json.user) {
      state.user = {
        ...(state.user || {}),
        ...json.user,
      };
      renderHeader();
    }
    if (json.northStar) {
      state.northStar = {
        text: json.northStar.text,
        setAt: json.northStar.setAt,
      };
    } else {
      state.northStar = null;
    }
    renderMemoryModalBody(json);
  }

  function renderMemoryModalBody(data) {
    const facts = Array.isArray(data.facts) ? data.facts : [];
    const grouped = {};
    for (const f of facts) {
      if (!grouped[f.kind]) grouped[f.kind] = [];
      grouped[f.kind].push(f);
    }

    const parts = [];

    parts.push('<section class="memory-section">');
    parts.push('<h3 class="memory-section__heading"><span>你想做的那件事</span></h3>');
    if (data.northStar?.text) {
      const dateStr = data.northStar.setAt
        ? formatDate(new Date(data.northStar.setAt))
        : "";
      parts.push(
        `<div class="memory-northstar">${escapeHtml(data.northStar.text)}` +
          (dateStr
            ? `<div class="memory-northstar__meta">于 ${dateStr} 写下 · 总对话 ${data.user?.totalChatTurns ?? 0} 次</div>`
            : "") +
          `<button type="button" class="memory-northstar__edit" data-action="edit-northstar">改一下</button>` +
          `</div>`
      );
    } else {
      parts.push(
        '<div class="memory-northstar memory-northstar__empty">' +
          '还没写下来。<button type="button" class="memory-northstar__edit" data-action="edit-northstar">写一句话</button>' +
          "</div>"
      );
    }
    parts.push("</section>");

    if (!facts.length) {
      parts.push(
        '<section class="memory-section">' +
          '<h3 class="memory-section__heading"><span>AI 记下来的</span></h3>' +
          '<p class="memory-modal__empty">还没记下任何事。多聊几句，它会自动记。</p>' +
          "</section>"
      );
    } else {
      parts.push(
        `<section class="memory-section">` +
          `<h3 class="memory-section__heading"><span>AI 记下来的关于你的事</span><span class="memory-section__count">${facts.length} 条</span></h3>` +
          `</section>`
      );
      for (const kind of KIND_ORDER) {
        const list = grouped[kind];
        if (!list || !list.length) continue;
        parts.push(`<section class="memory-section">`);
        parts.push(
          `<h3 class="memory-section__heading"><span>${KIND_LABELS[kind] || kind}</span><span class="memory-section__count">${list.length}</span></h3>`
        );
        for (const fact of list) {
          parts.push(renderFactRow(fact));
        }
        parts.push(`</section>`);
      }
    }

    dom.memoryBody.innerHTML = parts.join("");
    wireMemoryActions();
  }

  function renderFactRow(fact) {
    const pinnedClass = fact.pinned ? " memory-fact--pinned" : "";
    const pinLabel = fact.pinned ? "已钉住" : "钉住";
    const pinBtnClass = fact.pinned ? " memory-fact__btn--pinned" : "";
    return (
      `<div class="memory-fact${pinnedClass}" data-fact-id="${fact.id}">` +
        `<span class="memory-fact__text">${escapeHtml(fact.text)}</span>` +
        `<span class="memory-fact__actions">` +
          `<button type="button" class="memory-fact__btn${pinBtnClass}" data-action="toggle-pin" data-id="${fact.id}">${pinLabel}</button>` +
          `<button type="button" class="memory-fact__btn" data-action="archive" data-id="${fact.id}" title="AI 记错了，删掉">删掉</button>` +
        `</span>` +
      `</div>`
    );
  }

  function wireMemoryActions() {
    dom.memoryBody.querySelectorAll("[data-action='toggle-pin']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const row = btn.closest(".memory-fact");
        const wasPinned = row?.classList.contains("memory-fact--pinned");
        btn.disabled = true;
        const { status } = await api(`/api/me/facts/${id}/pin`, {
          method: "POST",
          body: { pinned: !wasPinned },
        });
        btn.disabled = false;
        if (status === 200) refreshMemoryModal();
      });
    });
    dom.memoryBody.querySelectorAll("[data-action='archive']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("从记忆里删掉这条？")) return;
        btn.disabled = true;
        const { status } = await api(`/api/me/facts/${id}/archive`, {
          method: "POST",
          body: { archived: true },
        });
        btn.disabled = false;
        if (status === 200) refreshMemoryModal();
      });
    });
    const editBtn = dom.memoryBody.querySelector("[data-action='edit-northstar']");
    if (editBtn) {
      editBtn.addEventListener("click", async () => {
        const current = state.northStar?.text || "";
        const next = prompt("写下你想做成的那件事：", current);
        if (next === null) return;
        const trimmed = next.trim();
        if (trimmed.length < 4) {
          alert("至少 4 个字");
          return;
        }
        const { status, json } = await api("/api/me/north-star", {
          method: "POST",
          body: { northStar: trimmed },
        });
        if (status === 200 && json.ok) {
          state.northStar = {
            text: json.goal.northStar,
            setAt: json.goal.setAt,
          };
          renderHero();
          refreshMemoryModal();
        } else {
          alert("保存失败");
        }
      });
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    state.northStar = null;
    renderHeader();
    renderHero();
  }

  function openModal({ purpose, pendingNorthStar = null } = {}) {
    state.pendingNorthStar = pendingNorthStar;
    if (purpose === "save_north_star" && pendingNorthStar) {
      dom.modalTitle.textContent = "把这句话存进来";
      dom.modalIntro.innerHTML =
        `<span class="auth-modal__intro-quote">"${escapeHtml(pendingNorthStar)}"</span><br>` +
        `验证一下手机号，这句话就跟着你了。换设备、关浏览器，回来还在。`;
    } else {
      dom.modalTitle.textContent = "把这场对话留下来";
      dom.modalIntro.textContent =
        "手机号验证一下，你和它说过的话就都还在。换设备、关浏览器，回来接着聊。";
    }
    resetModalSteps();
    dom.modal.classList.remove("hidden");
    dom.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => dom.phoneInput?.focus(), 50);
  }

  function closeModal() {
    dom.modal.classList.add("hidden");
    dom.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (state.resendTimer) {
      clearInterval(state.resendTimer);
      state.resendTimer = null;
    }
  }

  function resetModalSteps() {
    dom.stepPhone.classList.remove("hidden");
    dom.stepCode.classList.add("hidden");
    dom.codeInput.value = "";
    clearError(dom.formError);
    clearError(dom.devNotice);
    dom.sendBtn.disabled = false;
    dom.sendBtn.textContent = "发送验证码";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function handleSendCode() {
    const phone = (dom.phoneInput.value || "").trim();
    clearError(dom.formError);
    clearError(dom.devNotice);

    if (!PHONE_REGEX.test(phone)) {
      showError(dom.formError, "请输入正确的手机号");
      return;
    }

    dom.sendBtn.disabled = true;
    dom.sendBtn.textContent = "发送中...";

    const { status, json } = await api("/api/auth/send-code", {
      method: "POST",
      body: { phone },
    });

    if (status === 429) {
      showError(
        dom.formError,
        `发得太频繁了，${json.retryAfterSeconds || 60} 秒后再试`
      );
      dom.sendBtn.disabled = false;
      dom.sendBtn.textContent = "发送验证码";
      return;
    }

    if (status !== 200 || !json.ok) {
      showError(dom.formError, mapAuthError(json.error || "send_failed"));
      dom.sendBtn.disabled = false;
      dom.sendBtn.textContent = "发送验证码";
      return;
    }

    state.pendingPhone = phone;
    dom.sentPhone.textContent = formatPhone(phone);
    dom.stepPhone.classList.add("hidden");
    dom.stepCode.classList.remove("hidden");
    setTimeout(() => dom.codeInput?.focus(), 50);
    startResendCooldown();

    if (json.devCode) {
      dom.devNotice.innerHTML =
        `<strong>[开发模式]</strong> 验证码：<code>${json.devCode}</code>` +
        `<br>${escapeHtml(json.devNotice || "")}`;
      dom.devNotice.classList.remove("hidden");
    }
  }

  function startResendCooldown() {
    state.resendUntil = Date.now() + RESEND_COOLDOWN_S * 1000;
    dom.resendBtn.disabled = true;
    if (state.resendTimer) clearInterval(state.resendTimer);

    const tick = () => {
      const left = Math.ceil((state.resendUntil - Date.now()) / 1000);
      if (left <= 0) {
        dom.resendBtn.disabled = false;
        dom.resendText.textContent = "重新发送";
        dom.resendCounter.textContent = "";
        clearInterval(state.resendTimer);
        state.resendTimer = null;
        return;
      }
      dom.resendText.textContent = "重新发送";
      dom.resendCounter.textContent = `（${left}s）`;
    };
    tick();
    state.resendTimer = setInterval(tick, 500);
  }

  async function handleVerifyCode() {
    const code = (dom.codeInput.value || "").trim();
    clearError(dom.formError);

    if (!CODE_REGEX.test(code)) {
      showError(dom.formError, "请输入 6 位数字验证码");
      return;
    }

    dom.verifyBtn.disabled = true;
    dom.verifyBtn.textContent = "验证中...";

    const { status, json } = await api("/api/auth/verify-code", {
      method: "POST",
      body: { phone: state.pendingPhone, code },
    });

    if (status !== 200 || !json.ok) {
      showError(dom.formError, mapAuthError(json.error || "verify_failed"));
      dom.verifyBtn.disabled = false;
      dom.verifyBtn.textContent = "验证 · 登录";
      return;
    }

    state.user = json.user;
    state.northStar = json.hasNorthStar
      ? { text: json.northStar, setAt: Date.now() }
      : null;

    if (state.pendingNorthStar) {
      const saveResult = await api("/api/me/north-star", {
        method: "POST",
        body: { northStar: state.pendingNorthStar },
      });
      if (saveResult.status === 200 && saveResult.json.ok) {
        state.northStar = {
          text: saveResult.json.goal.northStar,
          setAt: saveResult.json.goal.setAt,
        };
      }
      state.pendingNorthStar = null;
    }

    closeModal();
    renderHeader();
    renderHero();

    setTimeout(() => {
      const banner = createToast(
        state.northStar
          ? `登录成功，"${state.northStar.text.slice(0, 30)}${state.northStar.text.length > 30 ? "..." : ""}"已存好。`
          : `欢迎回来 ${formatPhone(state.user.phone)}`
      );
      document.body.appendChild(banner);
      setTimeout(() => banner.classList.add("toast--show"), 10);
      setTimeout(() => {
        banner.classList.remove("toast--show");
        setTimeout(() => banner.remove(), 400);
      }, 3500);
    }, 200);
  }

  function createToast(text, variant) {
    const div = document.createElement("div");
    div.className = variant ? `toast toast--${variant}` : "toast";
    div.textContent = text;
    return div;
  }

  // 给 app.js 等模块用的全局 toast：默认 4 秒消失。variant=warning 会带橙色边。
  // 故意挂 window 而不是 export，因为 auth-ui.js 是 IIFE 装的。
  window.bookOfElonToast = function (text, options = {}) {
    if (!text) return;
    const variant = options.variant || "";
    const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 4000;
    const banner = createToast(String(text), variant);
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add("toast--show"), 10);
    setTimeout(() => {
      banner.classList.remove("toast--show");
      setTimeout(() => banner.remove(), 400);
    }, ttlMs);
  };

  function mapAuthError(code) {
    const map = {
      invalid_phone: "手机号格式不对",
      invalid_code_format: "验证码必须是 6 位数字",
      no_active_code: "验证码已失效，请重新发送",
      wrong_code: "验证码不对",
      expired: "验证码已过期，请重新发送",
      too_many_attempts: "尝试次数过多，请重新发送验证码",
      too_soon: "刚刚发过了，稍等几秒",
      ip_quota_exceeded: "当前网络发码太多，等几分钟",
      sms_send_failed: "短信服务暂时不可用",
      auth_required: "请先登录",
    };
    return map[code] || `失败：${code}`;
  }

  async function handleNorthStarSubmit(event) {
    event.preventDefault();
    const text = (dom.nsInput.value || "").trim();
    clearError(dom.nsError);

    if (text.length < 4) {
      showError(dom.nsError, "至少 4 个字——你想做成什么？");
      return;
    }
    if (text.length > 200) {
      showError(dom.nsError, "太长了，200 字以内");
      return;
    }

    if (!state.user) {
      openModal({ purpose: "save_north_star", pendingNorthStar: text });
      return;
    }

    dom.nsSubmit.disabled = true;
    dom.nsSubmit.textContent = "保存中...";
    const { status, json } = await api("/api/me/north-star", {
      method: "POST",
      body: { northStar: text },
    });
    dom.nsSubmit.disabled = false;
    dom.nsSubmit.textContent = "把它定下来 →";

    if (status !== 200 || !json.ok) {
      showError(dom.nsError, "保存失败，稍后再试");
      return;
    }

    state.northStar = {
      text: json.goal.northStar,
      setAt: json.goal.setAt,
    };
    renderHero();
  }

  async function loadCurrentUser() {
    const { status, json } = await api("/api/auth/me");
    if (status === 200 && json.authenticated) {
      state.user = json.user;
      state.northStar = json.hasNorthStar
        ? { text: json.northStar, setAt: Date.now() }
        : null;
    } else {
      state.user = null;
      state.northStar = null;
    }
    renderHeader();
    renderHero();
  }

  function wireEvents() {
    dom.modalClose?.addEventListener("click", closeModal);
    dom.modalBackdrop?.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (dom.memoryModal && !dom.memoryModal.classList.contains("hidden")) {
        closeMemoryModal();
        return;
      }
      if (!dom.modal.classList.contains("hidden")) closeModal();
    });

    dom.memoryClose?.addEventListener("click", closeMemoryModal);
    dom.memoryBackdrop?.addEventListener("click", closeMemoryModal);
    dom.memoryLogout?.addEventListener("click", async () => {
      if (!confirm("确定登出？")) return;
      closeMemoryModal();
      await logout();
    });

    dom.sendBtn?.addEventListener("click", handleSendCode);
    dom.verifyBtn?.addEventListener("click", handleVerifyCode);
    dom.resendBtn?.addEventListener("click", () => {
      if (Date.now() < state.resendUntil) return;
      handleSendCode();
    });
    dom.changePhoneBtn?.addEventListener("click", resetModalSteps);

    dom.codeInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleVerifyCode();
      }
    });
    dom.phoneInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendCode();
      }
    });

    dom.nsForm?.addEventListener("submit", handleNorthStarSubmit);
    dom.editNsBtn?.addEventListener("click", () => {
      const newText = prompt("修改这件事：", state.northStar?.text || "");
      if (!newText || newText.trim().length < 4) return;
      api("/api/me/north-star", {
        method: "POST",
        body: { northStar: newText.trim() },
      }).then(({ status, json }) => {
        if (status === 200 && json.ok) {
          state.northStar = {
            text: json.goal.northStar,
            setAt: json.goal.setAt,
          };
          renderHero();
        } else {
          alert("保存失败");
        }
      });
    });
    dom.setNsBtn?.addEventListener("click", () => {
      const text = prompt("写下你想做成的那件事（一句话）：");
      if (!text || text.trim().length < 4) return;
      api("/api/me/north-star", {
        method: "POST",
        body: { northStar: text.trim() },
      }).then(({ status, json }) => {
        if (status === 200 && json.ok) {
          state.northStar = {
            text: json.goal.northStar,
            setAt: json.goal.setAt,
          };
          renderHero();
        } else {
          alert("保存失败");
        }
      });
    });

    dom.openChatBtn?.addEventListener("click", () => {
      const askBtn = document.getElementById("ask-direct-btn");
      askBtn?.click();
    });
  }

  function init() {
    bindDom();
    if (!dom.loginBtn || !dom.modal) return;
    wireEvents();
    loadCurrentUser();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.BookOfElonAuth = {
    getUser: () => state.user,
    getNorthStar: () => state.northStar,
    refresh: loadCurrentUser,
    open: () => openModal({ purpose: "login" }),
  };
})();
