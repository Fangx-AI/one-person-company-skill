# Answer Quality Evals

These files define what a high-value answer means for the one-person-company product.

This is not engineering coverage. It is product-value coverage. A useful answer must make the user feel that the system sees the commercial reality better than a generic model.

## Files

- `scenarios.jsonl`: high-risk user scenarios where generic advice is likely to fail.
- `gold-answers.jsonl`: example answers that show the expected judgment density and actionability.
- `rubric.json`: scoring dimensions for human or model-based answer review.

## Required Answer Shape

Most answers should contain:

- one hard business judgment,
- at least one case, route, or commercial pattern,
- one China-specific constraint when relevant,
- one low-friction next action,
- one stop-loss condition.

## Failure Patterns

The answer is not acceptable if it ends with generic advice such as:

- keep shipping,
- build an MVP,
- find pain points,
- build a personal brand,
- post more content,
- differentiate,
- keep going.

These phrases can appear only if they are translated into a concrete action, cost, and validation signal.

## Validation

Run:

```bash
npm run opc:eval:answers
```

The validator checks that each scenario forces business judgment, case support, China reality, next action, and stop-loss logic.
