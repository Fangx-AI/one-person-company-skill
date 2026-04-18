function buildKnowledgeBase(cards, bookSource) {
  const cardChunks = cards.flatMap(buildCardChunks);
  const sourceChunks = buildBookSourceChunks(cards, bookSource);

  return {
    generated_at: new Date().toISOString(),
    parts: [...new Set(cards.map((card) => card.backend.part_en))],
    cards: cards.map((card) => ({
      id: card.id,
      title_zh: card.frontend.title_zh,
      theme_en: card.backend.theme_en,
      section: card.frontend.section,
      confidence: card.backend.confidence,
    })),
    source_chapter_count: bookSource?.chapter_count || 0,
    chunks: [...cardChunks, ...sourceChunks],
  };
}

function buildCardChunks(card) {
  const chunks = [];
  const baseTerms = [
    card.frontend.title_zh,
    card.frontend.hook_zh,
    card.frontend.summary_zh,
    card.backend.theme_en,
    card.backend.part_en,
    ...card.backend.search_terms,
  ];

  const pushChunk = (type, text, weight, extraTerms = []) => {
    if (!text) return;
    const allTerms = [...baseTerms, ...extraTerms].filter(Boolean);
    chunks.push({
      id: `${card.id}:${type}:${chunks.length}`,
      cardId: card.id,
      linkedCardIds: [card.id],
      type,
      text,
      weight,
      terms: allTerms,
      _normalizedText: normalizeSearchText(text),
      _normalizedTerms: allTerms.map(normalizeSearchText).filter(Boolean),
    });
  };

  pushChunk("summary", card.frontend.summary_zh, 3);
  pushChunk("hook", card.frontend.hook_zh, 2);

  for (const point of card.backend.knowledge_points_zh) {
    pushChunk("point", point, 3);
  }

  for (const angle of card.backend.coaching_angles_zh) {
    pushChunk("angle", angle, 2);
  }

  for (const quote of card.backend.source_excerpt_en) {
    pushChunk("quote", quote, 2, ["原文", "英文", "出处", "书里"]);
  }

  return chunks;
}

function buildBookSourceChunks(cards, bookSource) {
  if (!bookSource?.chapters?.length) return [];

  return bookSource.chapters.flatMap((chapter) => {
    const linkedCardIds = inferLinkedCardIds(cards, chapter);
    const paragraphs = splitBookText(chapter.text);

    return paragraphs.map((paragraph, index) => {
      const allTerms = [chapter.title, chapter.part, chapter.excerpt, ...linkedCardIds.map((id) => idToCard[id]?.frontend.title_zh)].filter(Boolean);
      return {
        id: `book:${chapter.id}:${index}`,
        cardId: linkedCardIds[0] || null,
        linkedCardIds,
        type: paragraph.length > 260 ? "book_paragraph" : "book_quote",
        text: paragraph,
        weight: linkedCardIds.length ? 3 : 1.6,
        terms: allTerms,
        _normalizedText: normalizeSearchText(paragraph),
        _normalizedTerms: allTerms.map(normalizeSearchText).filter(Boolean),
        chapterTitle: chapter.title,
        chapterPart: chapter.part,
      };
    });
  });
}

function inferLinkedCardIds(cards, chapter) {
  const title = normalizeSearchText(chapter.title);
  const text = normalizeSearchText(`${chapter.title} ${chapter.text.slice(0, 1200)}`);

  return cards
    .filter((card) => {
      const theme = normalizeSearchText(card.backend.theme_en);
      const titleZh = normalizeSearchText(card.frontend.title_zh);
      if (title === theme || title.includes(theme) || theme.includes(title)) return true;
      if (titleZh && text.includes(titleZh.slice(0, 4))) return true;
      return card.backend.search_terms.some((term) => term.length >= 2 && text.includes(normalizeSearchText(term)));
    })
    .map((card) => card.id)
    .slice(0, 4);
}

function splitBookText(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 60);

  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 420) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if ((current + " " + sentence).trim().length > 420 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = `${current} ${sentence}`.trim();
      }
    }
    if (current) chunks.push(current.trim());
  }

  return chunks;
}

function searchKnowledgeBase(query, options = {}) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const tokens = extractSearchTokens(normalized);
  const allowedTypes = options.types ? new Set(options.types) : null;

  return knowledgeBase.chunks
    .filter((chunk) => !allowedTypes || allowedTypes.has(chunk.type))
    .map((chunk) => ({
      ...chunk,
      score: scoreKnowledgeChunk(normalized, tokens, chunk, options.activeCardId),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 8);
}

function scoreKnowledgeChunk(normalizedQuery, tokens, chunk, activeCardId) {
  const chunkText = chunk._normalizedText || normalizeSearchText(chunk.text);
  const normalizedTerms = chunk._normalizedTerms || chunk.terms.map(normalizeSearchText).filter(Boolean);
  let score = 0;

  if (activeCardId && chunk.cardId === activeCardId) score += 6;
  if (activeCardId && chunk.linkedCardIds?.includes(activeCardId)) score += 8;
  if (chunkText.includes(normalizedQuery)) score += 8 * chunk.weight;

  for (const normalizedTerm of normalizedTerms) {
    if (normalizedQuery.includes(normalizedTerm)) score += 4 * chunk.weight;
    if (normalizedTerm.includes(normalizedQuery) && normalizedQuery.length >= 2) score += 3;
  }

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (chunkText.includes(token)) score += token.length > 2 ? 1.6 : 0.8;
    if (normalizedTerms.some((nt) => nt.includes(token))) score += 2;
  }

  return score;
}

function normalizeSearchText(text) {
  return String(text || "").toLowerCase().trim();
}

function extractSearchTokens(text) {
  return text.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || [];
}

function dedupeTexts(texts) {
  return [...new Set(texts.filter(Boolean))];
}

function looksLikeSourceQuestion(text) {
  return /出处|原文|真这么说|根据什么|依据|原话|英文锚点|逐字/.test(text);
}

function looksLikeRelatedQuestion(text) {
  return /相关|类似|还有哪些|别的卡|下一张|一起看|顺着.*看/.test(text);
}

function looksLikeMeaningQuestion(text) {
  return /什么意思|讲什么|怎么理解|解释一下/.test(text);
}
