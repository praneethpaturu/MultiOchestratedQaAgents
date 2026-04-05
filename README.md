# QA Agents — GitHub Copilot Extension for VS Code

A multi-agent orchestrated QA platform built as a **GitHub Copilot Extension**. Invoke `@qa-agent` directly in VS Code Copilot Chat to analyze stories, generate Playwright tests, diagnose failures, and file bugs — all powered by 8 specialized AI agents.

## How It Works in VS Code

```
VS Code Copilot Chat
       │
       │  @qa-agent /run 12345
       │
       ▼
┌─────────────────────────┐
│  Copilot Extension      │  ← Express server (SSE streaming)
│  POST / endpoint        │
└────────┬────────────────┘
         │ routes to
         ▼
┌─────────────────────────┐
│  @orchestrator           │  ← Central brain
│  Dynamically invokes:    │
│   @clarifier             │
│   @requirement-analyst   │
│   @test-designer         │
│   @automation-engineer   │
│   @maintenance           │
│   @rca                   │
│   @reviewer              │
└─────────────────────────┘
         │
         ▼ streams SSE events back to VS Code
    ┌──────────────────┐
    │ Copilot Chat UI  │  ← Markdown, references, confirmations
    └──────────────────┘
```

## Quick Start

```bash
# 1. Install
npm install
npx playwright install

# 2. Configure
cp .env.example .env
# Fill in ADO_ORG, ADO_PROJECT, ADO_TOKEN, API keys

# 3. Start the Copilot Extension server
npm run serve

# Dev mode (auto-reload, skip signature verification)
npm run serve:dev
```

## VS Code Copilot Chat Commands

Once the extension is registered, use these in Copilot Chat:

| Command | What It Does | Example |
|---------|-------------|---------|
| `/run` | Full multi-agent pipeline | `@qa-agent /run 12345` |
| `/clarify` | Check story for ambiguities | `@qa-agent /clarify 12345` |
| `/analyze` | Extract requirements & scenarios | `@qa-agent /analyze 12345` |
| `/design` | Create prioritized test cases | `@qa-agent /design 12345` |
| `/generate` | Generate Playwright tests (POM) | `@qa-agent /generate 12345` |
| `/fix` | Diagnose & fix broken tests | `@qa-agent /fix` (paste errors) |
| `/rca` | Deep root cause analysis | `@qa-agent /rca` (paste failures) |
| `/review` | Governance review | `@qa-agent /review` |
| `/help` | Show all commands | `@qa-agent /help` |

Natural language also works: `@qa-agent analyze story 12345 and generate playwright tests`

## Copilot Extension Protocol

This extension implements the full **GitHub Copilot Extensions wire format**:

- **SDK**: `@copilot-extensions/preview-sdk` v5
- **Signature Verification**: Validates `github-public-key-signature` header using GitHub's public keys
- **SSE Streaming**: Responses use `data: {"choices":[{"delta":{"content":"..."}}]}` format
- **Events**: `createAckEvent`, `createTextEvent`, `createReferencesEvent`, `createConfirmationEvent`, `createErrorsEvent`, `createDoneEvent`
- **User Context**: Reads `x-github-token` to identify the user via Octokit
- **Thread State**: Maintains per-conversation state so `/analyze` → `/design` → `/generate` chains data

### Registering as a GitHub Copilot Extension

1. Create a GitHub App at `https://github.com/settings/apps/new`
2. Set the **Copilot** tab:
   - Agent type: **Agent**
   - URL: Your server's public URL (e.g., `https://your-domain.com/`)
3. Install the App on your org/account
4. In VS Code, `@qa-agent` will appear in Copilot Chat

### Local Development

```bash
# Start with signature verification disabled
qa-agent serve --skip-verify --port 4000

# Or use npm script
COPILOT_SKIP_VERIFY=true PORT=4000 npm run serve:dev

# Test with curl
curl -X POST http://localhost:4000/ \
  -H "Content-Type: application/json" \
  -d '{"copilot_thread_id":"test","messages":[{"role":"user","content":"/help"}],"agent":"qa-agent","copilot_skills":[],"stop":null,"top_p":1,"temperature":0.1,"max_tokens":4096,"presence_penalty":0,"frequency_penalty":0}'
```

## Agent Architecture

### 8 Specialized Agents

| Agent | Slug | Model | Role |
|-------|------|-------|------|
| **Orchestrator** | `@orchestrator` | gpt-4o | Central brain — routes to sub-agents |
| **Clarifier** | `@clarifier` | gpt-4o | Identifies ambiguities, asks questions |
| **Requirement Analyst** | `@requirement-analyst` | gpt-4o | Extracts scenarios & edge cases |
| **Test Designer** | `@test-designer` | claude-sonnet | Creates prioritized test cases |
| **Automation Engineer** | `@automation-engineer` | gpt-4o | Generates Playwright + POM code |
| **Maintenance** | `@maintenance` | gpt-4o | Fixes broken locators/waits/flows |
| **RCA** | `@rca` | claude-opus | Deep root cause analysis (7 categories) |
| **Reviewer** | `@reviewer` | claude-opus | Governance gate (8 criteria, 0-100 score) |

### Pipeline Flow

```
@qa-agent /run 12345
    │
    ├── @clarifier → Check ambiguities
    ├── @requirement-analyst → Extract scenarios
    ├── @test-designer → Create test cases
    ├── @automation-engineer → Generate Playwright tests
    ├── Run tests
    ├── @maintenance → Fix failures (up to 3 retries)
    ├── @rca → Deep analysis if still failing
    │     ├── PRODUCT_BUG → Auto-create ADO bug
    │     ├── TEST_BUG → Back to @automation-engineer
    │     └── ENV_ISSUE → Flag infrastructure
    └── @reviewer → Governance gate
          ├── APPROVED → Done
          └── REJECTED → Loop back (up to 3 loops)
```

## CLI Commands (Non-Copilot)

```bash
# Start Copilot Extension server
qa-agent serve [--port 3000] [--skip-verify]

# Run pipeline directly (no Copilot)
qa-agent run --story-id 123 [--dry-run] [--interactive]

# List agents
qa-agent agents

# Memory management
qa-agent memory list [--type rca_result]
qa-agent memory clear

# Show config
qa-agent config
```

## Project Structure

```
qa-agents/
  src/
    copilot/                    # GitHub Copilot Extension layer
      server.ts                 # Express server (SSE, verification)
      verification.ts           # GitHub signature verification
      streaming.ts              # SSE event helpers
      state.ts                  # Per-thread conversation state
      types.ts                  # Copilot protocol types
      handlers/                 # One handler per agent
        orchestrator.handler.ts # /run — full pipeline
        clarifier.handler.ts    # /clarify
        requirement.handler.ts  # /analyze
        testdesign.handler.ts   # /design
        automation.handler.ts   # /generate
        maintenance.handler.ts  # /fix
        rca.handler.ts          # /rca
        reviewer.handler.ts     # /review
        index.ts                # Command router
    agents/                     # Agent implementations
    orchestrator/               # CLI + pipeline
    ado/                        # Azure DevOps integration
    memory/                     # Persistent memory
    skills/                     # Locator healing, flakiness detection
    utils/                      # LLM router (with tool-calling), logger
  playwright/                   # Config, fixtures, POM, generated tests
```

## Configuration

All via `.env`:

| Variable | Description |
|----------|-------------|
| `ADO_ORG` | Azure DevOps organization |
| `ADO_PROJECT` | Azure DevOps project |
| `ADO_TOKEN` | Personal Access Token |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `MODEL_*` | Per-agent model overrides |
| `PORT` | Copilot Extension server port (default: 3000) |
| `COPILOT_SKIP_VERIFY` | Skip signature verification for local dev |
| `BASE_URL` | Application under test URL |
