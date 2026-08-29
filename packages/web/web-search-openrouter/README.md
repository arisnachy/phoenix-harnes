# @phoenix-ai/dsh-web-search-openrouter

English | [中文](README.zh.md)

OpenRouter-backed `WebSearchProvider` for PHOENIX. It sends one Chat Completions request with the current `openrouter:web_search` server tool, then maps OpenRouter's standardized `url_citation` annotations into the provider-neutral `ctx.web` result.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | Credential reference shared with the OpenRouter model route. |
| `baseURL` | `https://openrouter.ai/api/v1` | API base; `/chat/completions` is appended. |
| `model` | `openrouter/auto` | Model that decides and performs the server-tool search. |

The key resolves for every request through the credential service, so a key saved in **Settings → Models** applies without restarting PHOENIX. Secret values never appear in settings descriptions or search results.

## Model Experience

### Auxiliary OpenRouter request

#### What the model sees

A separate OpenRouter model receives the search query through Chat Completions with the `openrouter:web_search` server tool enabled. This request is not part of the conversation model's context.

#### Token effect

The auxiliary request incurs OpenRouter model tokens and may incur provider search charges. The provider controls the final accounting.

#### KV Cache effect

The request is independent of the conversation cache. An identical query, route, and server-tool configuration may reuse provider cache; changing any of them establishes a different prefix.

### Conversation tool result, indirectly

#### What the model sees

Through `dsh-tool-web`, the conversation model sees the provider-generated answer and deduplicated URL citations under the stable `web_search` contract. Invalid citation URLs are omitted.

#### Token effect

The normalized answer and citation metadata consume conversation-context tokens when the tool result is appended.

#### KV Cache effect

Appending the tool result extends the conversation prefix. Earlier unchanged request content remains eligible for provider cache reuse, while a different answer or citation set changes the suffix.

## Known Limitations and Deferred Work

- OpenRouter web search can add provider search and model-token charges.
- Server tools are currently beta upstream. The package pins the documented request and standardized citation shapes with unit tests.
- The returned answer is provider-generated; callers must cite and evaluate the mapped sources.
