---
name: model-request-tuning
description: Implement or debug model-provider request controls and response latency in AI applications, including reasoning strength, thinking mode, Fast or priority tiers, output budgets, streaming, batching, and concurrency. Use when tracing application settings to actual API requests; not for changing subscriptions or installing a proxy.
---

# Model request tuning

Give users meaningful controls that reach the provider, and measure the response behavior the application actually exposes. A saved setting or faster mock response does not prove that an upstream service honors a parameter or provides higher TPS.

## Trace the request before changing it

Inspect configuration types, provider capabilities, settings drafts, request serialization, cache identity, queueing, and streaming. Follow one option from its UI value through save and reload to the actual outbound request body. Check both standalone and extension paths when they share an adapter.

Reuse the current adapter and scheduler. For unfamiliar or changing provider behavior, inspect the installed version and verify official provider documentation and relevant upstream code/issues before implementing. Record dated findings in project documentation rather than freezing model names or supported effort values into this skill.

Read [Provider contracts](references/provider-contracts.md) when changing thinking, reasoning, Fast, or token limits. In Easy Learn, also read [Project integration](references/easy-learn.md) for the code map and validation targets.

## Preserve user intent

Keep automatic, explicit-on, and explicit-off values distinct where the provider supports them. Preserve each preset's own unsaved and saved preferences; do not transfer parameters or credentials from another provider when switching. Unsupported parameters must not silently appear to work.

Let explicit user budgets override automatic defaults. Include all response-affecting settings, endpoint/model identity, explanation style, and relevant context in cache isolation. Invalidate or reject stale work when settings or documents change.

Fast selection and reasoning effort are separate decisions. Describe priority as a request to the service, with adoption determined by the upstream model, account, and proxy. Do not claim that a UI toggle proves actual acceleration.

## Improve and measure response behavior

Separate time to first transport output, time to first validated explanation, total batch completion, and provider token throughput. Use monotonic timing for durations. Without live provider measurements, report application behavior and mocked regressions only; do not infer real TPS.

Use the existing streaming parser to surface complete, validated items early. Retain completed partial output and a fallback for ordinary JSON responses. Prioritize interactive requests over queued background work, without discarding in-flight results unnecessarily.

Keep concurrency and batch size independently configurable when the application supports them. Lowering concurrency should constrain future dispatch without cancelling and resending active requests. Higher concurrency can improve total completion time while increasing rate-limit pressure; it does not inherently increase per-request TPS.

Preserve the application's cancellation, timeout, and rate-limit policy. In a system requiring manual retries, pause on failures rather than adding automatic billable retries. Showing a prepared explanation on hover or focus must not start another model call.

## Verify and hand over

Use a local mock and inspect real serialized request bodies, including omission of incompatible fields. Cover preset switching, explicit budgets, streamed partial results, cache isolation, stale responses, queue priority, and changed concurrency limits as applicable.

Run relevant project checks once after changes settle. Do not use personal credentials, billable traffic, or changes to the user's proxy installation merely to validate a setting unless separately authorized. Report which contracts were verified, what was measured, and which upstream capabilities remain untested.
