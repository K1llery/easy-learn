# Provider request contracts

Apply only the checks relevant to the provider and endpoint being changed. Reverify current documentation and the installed adapter; endpoint names and model-name patterns alone are not a complete capability contract.

## Reasoning and thinking

- Distinguish enabling thinking from selecting its effort. A provider may use separate fields or omit effort when thinking is disabled.
- Verify supported effort values and sampling restrictions for the current model. For DeepSeek thinking requests, check whether Temperature is effective and omit unsupported parameters rather than implying control.
- Thinking can consume the output allowance before visible content appears. Verify how the provider accounts for those tokens, set a justified automatic budget, and preserve an explicit user limit. Do not transplant a fixed minimum from another application.
- Preserve automatic omission: a user leaving an option unchanged should not unexpectedly override provider defaults.

## OpenAI-compatible endpoints and proxies

- Chat Completions and Responses use different request structures, including reasoning and output limits. Match the actual endpoint's fields instead of copying a body between protocols.
- Verify the adapter's conversion of reasoning settings and token limits. Account for model-specific constraints and the proxy's installed version.
- For Fast or priority controls, verify the current `service_tier` contract. Send `priority` or an explicit default only where supported. Keep effort independent.
- Inspect returned tier information when available. A proxy accepting a field, an HTTP success, or fast SSE transport is insufficient evidence that priority was adopted.
- A ChatGPT membership does not by itself prove proxy capabilities. Read the actual upstream implementation and relevant failure reports. Do not change the user's account or proxy installation as part of an application control fix.

## Evidence and failure handling

Test the outbound body after configuration save/reload, not just the UI state. Test field omission as well as field presence. Verify provider errors remain actionable and partial valid explanations survive a later failure.

For live performance experiments, obtain authorization for the account and possible cost, hold the input and relevant model settings constant, and identify whether the measurement is per-request throughput or application completion time. Do not publish credentials or full personal reading content in fixtures or logs.

Starting points, to be checked when used:

- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [OpenAI API reference](https://developers.openai.com/api/reference/overview)
- [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)
- [CLIProxyAPI source and issues](https://github.com/router-for-me/CLIProxyAPI)
- [CPA priority feedback issue #4586](https://github.com/router-for-me/CLIProxyAPI/issues/4586)
