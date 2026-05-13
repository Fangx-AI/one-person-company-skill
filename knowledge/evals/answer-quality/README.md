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
- direct competitors, adjacent substitutes, free substitutes, or high-price alternatives when relevant,
- the payment mechanism behind each comparable route,
- the evidence boundary: what the case proves and what it does not prove,
- at least one case, route, or commercial pattern,
- one local execution constraint when relevant,
- one numeric low-friction next action,
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

It is also not acceptable if it:

- casually lists competitors without classifying direct competitor vs adjacent substitute,
- mentions a case without explaining its payment mechanism,
- treats uncertain facts as certain,
- uses overseas or famous-product examples without stating evidence boundaries,
- gives a next action without numbers, price, time window, or rejection signal.

## Validation

Run:

```bash
npm run opc:eval:answers
```

The validator checks that each scenario forces business judgment, case support, China reality, next action, and stop-loss logic.
It also checks competitor layering, payment mechanism, evidence boundary, and numeric action requirements.
