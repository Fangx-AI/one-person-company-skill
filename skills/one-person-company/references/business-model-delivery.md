# Business Model And Delivery

Use this reference when the user asks about pricing, payment, delivery, monetization path, first customers, or whether an idea can sustain a one-person company.

## Core Judgment

Do not choose a business model because it sounds elegant. Choose the model that can collect money soon, deliver reliably, keep gross margin high enough, and avoid turning the founder into unpaid support.

The order is:

1. **收费**: what exactly is being sold and why the buyer pays now.
2. **支付**: how the first transaction happens in the local Chinese-language business context.
3. **交付**: how the promised outcome is delivered without hidden labor.
4. **毛利**: what time, API cost, refund risk, and support burden remain after each sale.
5. **复购**: whether the customer has a recurring reason to come back.
6. **售后**: what breaks, what users will ask, and what support promise is safe for one person.
7. **停损**: what result proves the model is not working.

## Model Selector

Pick one primary model. Do not recommend every model at once.

| Model | Use When | Risk | First Payment Test |
|---|---|---|---|
| 服务 | The buyer wants a result and trust matters more than software | Low scale, high labor | Sell one paid diagnostic or done-for-you delivery |
| 模板 | The workflow is repeatable and the buyer can self-serve | Easy to copy, low perceived value | Pre-sell a template with 3 concrete outcomes |
| 工具 | The pain is frequent and automation reduces repeated work | Acquisition and support can be harder than building | Charge for a narrow workflow, not generic features |
| 咨询 | The buyer pays for judgment, not assets | Founder time becomes the product | Sell a fixed-scope call/report before building tooling |
| 社群 | The buyer wants access, accountability, or curated information | Engagement labor and trust decay | Charge for a small cohort with a clear 2-week promise |
| 数据 | The buyer needs hard-to-gather information for decisions | Freshness and sourcing burden | Sell a sample report or searchable slice |
| 自动化 | The buyer has a manual process with visible labor cost | Customization creep | Sell one workflow automation with strict boundaries |

## Pricing Logic

Price from the buyer's alternative cost, not from your effort.

- If the alternative is manual labor, price below saved labor but above your delivery cost.
- If the alternative is an agency or freelancer, sell speed, clarity, or narrower scope.
- If the alternative is free content, sell packaging, confidence, implementation, or current data.
- If the alternative is doing nothing, the payment intent is weak unless there is deadline, revenue, risk, status, or compliance pressure.

For `/定价获客`, give:

- Entry price: low-friction first purchase.
- Core price: where the product should actually make money.
- High price: service/consulting/data version for buyers with urgent need.

## Local Payment Path

For validation, do not overbuild payment infrastructure.

- First transaction can use manual WeChat/Alipay transfer, 小报童, 知识星球, 有赞, 小鹅通, 飞书群, or paid consultation platforms.
- Formal WeChat Pay/Alipay merchant setup, invoices, contracts, and company entity matter later when repeat sales prove demand.
- If the buyer requires invoice, contract, procurement, data processing terms, or local support before paying, flag the trust and sales-cycle cost.

## Delivery Boundaries

Every paid offer needs a delivery boundary:

- What the buyer gets.
- What they do not get.
- Delivery time.
- Revision count.
- Refund rule.
- Support channel.
- API/tool cost cap.
- Whether the offer is one-time, subscription, retainer, or usage-based.

If the offer cannot define these boundaries, it is not ready to sell.

## Stop-Loss Rules

Stop or change the model when:

- 20 target users produce fewer than 3 serious payment conversations.
- 5 serious conversations produce zero willingness to pay.
- The buyer likes the idea but cannot name a budget, deadline, or current workaround.
- Delivery takes more time than the price can support.
- Support and customization grow with every sale.
- Users want a different outcome than the product is built around.

## Output Shape

Use this structure when the request is about pricing, monetization, or acquisition:

```text
推荐商业模式：服务 / 模板 / 工具 / 咨询 / 社群 / 数据 / 自动化

为什么是它：
- 用户现在买的不是功能，而是...
- 这个模式比其他模式更适合一人公司，因为...

收费设计：
- 入门价：
- 主力价：
- 高价版：

支付与交付：
- 第一单怎么收钱：
- 交付物：
- 交付边界：
- 毛利和售后风险：
- 复购理由：

第一批用户：
- 20 个用户从哪里来：
- 第一条成交话术：

停损线：
- ...
```

Prefer "先收钱" over building more features when the uncertainty is willingness to pay.
