# omniroute-gateway

A self-hosted AI gateway. One OpenAI-compatible endpoint in front of 28 built-in
providers (plus any OpenAI-compatible endpoint you add yourself), with automatic
failover when a provider rate-limits you or goes down.

Point Claude Code, Cline, Continue, the OpenAI SDK or `curl` at it and stop
rewriting client code every time you switch models.

```
                 ┌──────────────────────────────────────────┐
  OpenAI SDK ───▶│  /v1/chat/completions                    │──▶ Groq        (free)
  Anthropic SDK ▶│  /v1/messages         route → fall back  │──▶ Gemini      (free)
  Claude Code ──▶│  /v1/models                              │──▶ Cerebras    (free)
  curl ─────────▶│  /admin/*                                │──▶ Anthropic / OpenAI
                 └──────────────────────────────────────────┘──▶ Ollama      (local)
```

## What it does

- **One endpoint, both dialects.** `/v1/chat/completions` (OpenAI) and
  `/v1/messages` (Anthropic) are both served, and either one can be answered by
  any provider. An Anthropic-speaking client can be served by Groq; an OpenAI
  SDK can be served by Anthropic. The gateway translates requests, responses,
  tool calls and streams in both directions.
- **Automatic fallback.** A 429, a 5xx, a timeout or an unreachable host moves
  the request to the next provider that serves the same model. For streaming
  requests the fallback happens *before the first token* reaches the client, so
  a failover is invisible rather than a truncated answer.
- **Circuit breaking.** A provider that fails repeatedly is taken out of
  rotation for a cooldown that doubles per trip, and `Retry-After` is honoured.
  It is never dropped permanently — a degraded provider is still better than no
  answer, so it stays as a last resort.
- **Live model discovery.** Model lists come from each provider's `/models`
  endpoint and are cached, so the catalog does not go stale when a provider
  ships something new.
- **Virtual models.** Ask for `auto`, `auto:fast`, `auto:free` or `auto:local`
  and the gateway picks the best match across whatever you have configured.
- **Free-tier first.** The default routing preference puts providers with a free
  tier ahead of paid ones, so `llama-3.3-70b-versatile` goes to Groq before it
  goes to a provider that bills you.

## Quick start

```bash
npm install
cp .env.example .env      # set at least one provider key
npm run dev               # http://127.0.0.1:8787
```

Groq, Google AI Studio, Cerebras, OpenRouter, Mistral, NVIDIA, Scaleway and
GitHub Models all have free tiers — one key is enough to get going.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"auto:free","messages":[{"role":"user","content":"Say hi"}]}'
```

Production:

```bash
npm run build && npm start
# or
docker compose up --build
```

## Choosing a model

| You ask for | You get |
| --- | --- |
| `groq/llama-3.3-70b-versatile` | That exact provider and model. No fallback by default. |
| `llama-3.3-70b-versatile` | Every provider that serves it, best first, with fallback. |
| `auto` | The strongest general model across your providers. |
| `auto:fast` | The smallest/fastest capable model. |
| `auto:free` | Anything on a free-tier provider. |
| `auto:local` | Anything on Ollama / LM Studio / llama.cpp / vLLM. |
| a name from `routes` | Your own ordered fallback chain (see below). |

`GET /v1/models` lists all of it: aliases, routes, bare names and namespaced
`provider/model` ids, each annotated with which providers can serve it.

Every response carries the routing decision in its headers:

```
x-omniroute-provider: groq          # who actually answered
x-omniroute-model:    llama-3.3-70b-versatile
x-omniroute-attempts: 2             # 2 means the first provider failed over
x-omniroute-route:    discovered    # route | alias | pinned | discovered | passthrough
```

## Connecting clients

**Claude Code** — the gateway speaks the Anthropic Messages API natively:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_AUTH_TOKEN=your-gateway-key   # whatever you set in GATEWAY_API_KEYS
claude
```

Add a route so Claude Code's model names resolve wherever you want them to:

```json
{
  "routes": [
    {
      "model": "claude-sonnet-4-5",
      "targets": ["anthropic/claude-sonnet-4-5", "deepseek/deepseek-chat"]
    }
  ]
}
```

**OpenAI SDK** (Python shown; the JS SDK is the same idea):

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="your-gateway-key")
client.chat.completions.create(model="auto", messages=[{"role": "user", "content": "hi"}])
```

**Cline / Continue / any OpenAI-compatible tool** — set the base URL to
`http://127.0.0.1:8787/v1` and the API key to your gateway key.

## Configuration

Everything is optional and layered: **built-in defaults → JSON config file →
environment variables**, with environment variables winning.

### Environment

See `.env.example` for the full list. The ones that matter most:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Where to listen. |
| `GATEWAY_API_KEYS` | *(empty)* | Comma-separated client keys. Empty means no auth. |
| `GATEWAY_CONFIG` | *(unset)* | Path to a JSON config file. |
| `MAX_ATTEMPTS` | `3` | Providers tried per request. |
| `REQUEST_TIMEOUT_MS` | `120000` | Per-attempt upstream timeout. |
| `STREAM_FIRST_TOKEN_TIMEOUT_MS` | `30000` | How long to wait for the first token before failing over. |
| `ROUTING_PREFER` | `free` | `free`, `priority` or `local`. |
| `FALLBACK_FOR_PINNED_MODELS` | `false` | Allow `provider/model` requests to fail over too. |
| `DISABLED_PROVIDERS` | *(empty)* | Comma-separated provider ids to ignore. |
| `<PROVIDER>_API_KEY` | — | Presence of the key is what registers a provider. |
| `<PROVIDER>_BASE_URL` | — | Override any provider's base URL. |

### JSON config

Copy `config/gateway.example.json`, then set `GATEWAY_CONFIG` to point at it.
It adds three things env vars cannot express:

```json
{
  "routes": [
    {
      "model": "cheap-chat",
      "targets": [
        "groq/llama-3.3-70b-versatile",
        "cerebras/llama-3.3-70b",
        "openai/gpt-4o-mini"
      ]
    },
    { "model": "local-first", "targets": ["ollama/*", "groq/llama-3.3-70b-versatile"] }
  ],
  "providers": [
    {
      "id": "my-vllm",
      "baseUrl": "https://llm.internal.example.com/v1",
      "apiKeyEnv": "MY_VLLM_API_KEY",
      "priority": 60
    }
  ],
  "disabledProviders": []
}
```

- **`routes`** are named fallback chains. `provider/*` in a target keeps the
  model the client asked for.
- **`providers`** adds any OpenAI-compatible endpoint. A custom entry reusing a
  built-in id *patches* it, so overriding one base URL is a two-line change.
- Only `id` and `baseUrl` are required; `wire`, `auth` and `label` are inferred.

## Built-in providers

Free tier or free models: **Groq, Google AI Studio (Gemini), Cerebras,
OpenRouter, GitHub Models, Mistral, NVIDIA NIM, Scaleway**.

Paid: **OpenAI, Anthropic, DeepSeek, Together, Fireworks, DeepInfra, xAI,
Perplexity, Hyperbolic, Nebius, SambaNova, Novita, Moonshot, Zhipu, Alibaba
DashScope, AI21**.

Local (no key; set the matching `*_ENABLED=true`): **Ollama, LM Studio,
llama.cpp, vLLM**.

Anything else goes in the `providers` array. A provider is registered only when
its key is present — `GET /admin/providers` lists exactly what was skipped and
why, which is the first place to look when a model "cannot be found".

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI chat completions, streaming and not. |
| `POST /v1/messages` | Anthropic Messages API, streaming and not. |
| `GET /v1/models` | Aggregated model list across all providers. |
| `GET /health` | Liveness probe. Never requires auth. |
| `GET /admin/providers` | Active providers, skipped ones with reasons, breaker state. |
| `GET /admin/stats` | Requests, failures, fallbacks, tokens and latency per provider. |
| `GET /admin/models` | Raw discovery cache, including discovery errors. |
| `POST /admin/refresh` | Force model re-discovery. |
| `POST /admin/breakers/reset` | Clear tripped circuit breakers. |

Authentication is `Authorization: Bearer <key>` or `x-api-key: <key>` — whichever
your client sends. Your gateway key is never forwarded upstream; each provider
gets its own credential.

Not implemented: embeddings, images, audio, and the legacy `/v1/completions`
endpoint. Requests to those return a 404 naming the endpoints that do exist.

## Security notes

- With `GATEWAY_API_KEYS` empty the gateway is **open**. That is fine on
  loopback; bind to `0.0.0.0` without keys and anyone who can reach the port can
  spend your provider credits. The server logs a warning when you do.
- `.env`, `gateway.json` and `gateway.local.json` are git-ignored. Provider keys
  stay in the environment and are never echoed by any endpoint — `/admin/providers`
  reports base URLs and health, never credentials.

## Development

```bash
npm run dev        # watch mode
npm test           # 103 tests
npm run typecheck  # tsc, strict, src + tests
npm run check      # both
```

The suite runs against a scriptable mock upstream (`tests/helpers/mockUpstream.ts`),
so it covers fallback ordering, breaker behaviour, stream translation in both
directions and auth without touching a real provider or needing an API key.

### Layout

```
src/
  config/      env + JSON config loading and validation
  providers/   provider catalog, registration, auth headers
  routing/     model resolution, virtual aliases, circuit breaker, discovery
  translate/   OpenAI ↔ Anthropic request, response and SSE translation
  upstream/    error classification and the fallback dispatch loop
  routes/      HTTP surface
```

## Prior art

Inspired by [OmniRoute](https://github.com/diegosouzapw/OmniRoute) and the
broader family of AI gateways (LiteLLM, OpenRouter). This is an independent
implementation, not a fork.

## License

MIT
