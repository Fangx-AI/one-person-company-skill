# OPC Case Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make official chat answers automatically use the one-person-company case intelligence library when the user asks product, startup, pricing, acquisition, or creator-business questions.

**Architecture:** Keep the matcher as the retrieval layer and add a small server-side context formatter. `server.js` enriches sanitized chat context with a compact case block before calling DeepSeek, while unrelated conversations remain unchanged.

**Tech Stack:** Node.js CommonJS, JSONL case library, existing `/api/chat` pipeline, lightweight unit tests.

---

## Files

- Create: `services/opc-case-context.js`
- Create: `tests/opc/case-context.test.js`
- Modify: `server.js`
- Modify: `package.json`

## Tasks

- [x] Write a failing unit test proving business/product questions produce a compact context block with cases, routes, risks, and validation steps.
- [x] Write a failing unit test proving unrelated personal questions do not produce a context block.
- [x] Implement `buildCaseContextForMessages(messages, options)` in `services/opc-case-context.js`.
- [x] Add an npm script for the new test.
- [x] Inject the generated context block into `body.context.opcCaseContext` after user memory is attached and before cache/cost/upstream handling.
- [x] Render `context.opcCaseContext` inside `buildContextBlock()`.
- [x] Run matcher, context, validator, index, and diff checks before commit.
