# QA Agents — Multi-Agent Orchestrated QA Platform

An autonomous, production-ready QA system powered by **8 specialized AI agents**, a **Model Context Protocol (MCP) tool layer**, **GitHub Copilot Extension** for VS Code, and a **real-time dashboard**. Agents are defined as `.md` Copilot agent files, invoke tools via MCP, and are orchestrated by a central engine that dynamically routes work through the pipeline.

---

## Highlights

- **8 Copilot `.md` agents** — each with role, model, inputs, outputs, MCP tools, instructions, constraints, and examples
- **14 MCP tools** across 5 modules (ADO, Playwright, Memory, RCA, Logging) exposed via a JSON-RPC MCP server
- **Orchestrator engine** that loads `.md` agent definitions, feeds them as LLM prompts, and routes all tool calls through MCP
- **GitHub Copilot Extension** — SSE streaming server for VS Code Copilot Chat with 8 slash commands
- **Interactive dashboard** — 7-tab responsive UI with clickable stat cards, search, filters, expandable details, confidence visualizations, and 5-second auto-refresh
- **Azure DevOps integration** — fetch stories, create bugs with RCA summary, link to parent stories, deduplicate
- **Root Cause Analysis** — 7 failure categories, confidence scoring, automatic bug creation for product bugs
- **Self-healing locators** — memory-backed selector fix history informs future test generation
- **Flakiness detection** — static code analysis + execution history tracking

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │       Orchestrator Engine     │
                    │    loads .md agents, routes   │
                    │    tool calls through MCP     │
                    └──────────┬───────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
 ┌────────▼──────┐   ┌────────▼──────┐   ┌────────▼──────┐
 │ requirement   │   │ test-designer │   │  automation   │
 │ -agent.md     │   │ -agent.md     │   │  -agent.md    │
 └───────────────┘   └───────────────┘   └───────┬───────┘
                                                  │
                                         Run Playwright Tests
                                                  │
          ┌────────────────────┬──────────────────┘
          │                    │
 ┌────────▼──────┐   ┌────────▼──────┐
 │ maintenance   │   │   rca-agent   │──→ PRODUCT_BUG → ADO Bug
 │ -agent.md     │   │   .md         │──→ TEST_BUG → Fix
 └───────────────┘   └───────┬───────┘──→ ENV_ISSUE → Flag
                              │
                     ┌────────▼──────┐
                     │  reviewer     │──→ APPROVED → Done
                     │  -agent.md    │──→ REJECTED → Loop
                     └───────────────┘

    All agents call tools via MCP Server (14 tools)
    All data flows through the Memory layer (JSON store)
    Dashboard reads from Memory + Logs in real-time
```

### Agents (8)

| # | Agent | File | Role | MCP Tools |
|---|-------|------|------|-----------|
| 1 | **Orchestrator** | `orchestrator-agent.md` | Central brain — routes to sub-agents, manages pipeline lifecycle | `saveMemory`, `retrieveMemory`, `logEvent`, `runTests`, `getFailures`, `createBug`, `linkBugToStory` |
| 2 | **Clarifier** | `clarifier-agent.md` | Identifies ambiguities, asks targeted questions with defaults | `getUserStory`, `retrieveMemory`, `saveMemory`, `logEvent` |
| 3 | **Requirement Analyst** | `requirement-agent.md` | Extracts scenarios, acceptance criteria, edge cases from stories | `getUserStory`, `logEvent`, `saveMemory` |
| 4 | **Test Designer** | `test-designer-agent.md` | Creates prioritized, structured test cases from requirements | `retrieveMemory`, `saveMemory`, `logEvent` |
| 5 | **Automation Engineer** | `automation-agent.md` | Generates Playwright TypeScript tests with POM pattern | `generateTest`, `retrieveMemory`, `saveMemory` |
| 6 | **Maintenance & Fix** | `maintenance-agent.md` | Diagnoses and fixes broken locators, waits, and flows | `getFailures`, `generateTest`, `retrieveMemory`, `saveMemory`, `logEvent` |
| 7 | **RCA** | `rca-agent.md` | Deep root cause analysis — 7 categories, confidence scoring | `analyzeLogs`, `findSimilarFailures`, `calculateConfidence`, `saveMemory`, `logEvent` |
| 8 | **Reviewer** | `reviewer-agent.md` | Governance gate — 8 criteria, scores 0-100, rejects on blockers | `retrieveMemory`, `logEvent` |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/praneethpaturu/MultiOchestratedQaAgents.git
cd MultiOchestratedQaAgents
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Configure
cp .env.example .env
# Edit .env — fill in ADO_ORG, ADO_PROJECT, ADO_TOKEN, API keys

# 4. Verify everything works
npx tsx src/index.ts agents    # List 8 .md agents
npx tsx src/index.ts tools     # List 14 MCP tools
npx tsx src/index.ts config    # Show model routing

# 5. Start the dashboard
npx tsx src/index.ts dashboard --port 4001
# Open http://localhost:4001

# 6. Run the full pipeline
npx tsx src/index.ts run --story-id 12345
```

---

## Project Structure

```
qa-agents/
  agents/                         # .md Copilot agent definitions (8 agents)
    orchestrator-agent.md         #   Central brain — routes to sub-agents, manages pipeline
    clarifier-agent.md            #   Identifies ambiguities, asks targeted questions
    requirement-agent.md          #   Analyze stories → scenarios + edge cases
    test-designer-agent.md        #   Scenarios → prioritized test cases
    automation-agent.md           #   Test cases → Playwright tests (POM)
    maintenance-agent.md          #   Diagnose + fix broken tests
    rca-agent.md                  #   Deep root cause analysis (7 categories)
    reviewer-agent.md             #   Governance gate (8 criteria, 0-100 score)

  src/
    mcp/                          # Model Context Protocol layer
      server.ts                   #   MCP server: registers tools, handles calls, stdio transport
      tools/
        ado.ts                    #   getUserStory, createBug, linkBugToStory, searchBugs
        playwright.ts             #   generateTest, runTests, getFailures
        memory.ts                 #   saveMemory, retrieveMemory, findSimilarFailures
        rca.ts                    #   analyzeLogs, calculateConfidence
        logging.ts                #   logEvent, getAgentLogs

    orchestrator/                 # Pipeline engine
      engine.ts                   #   Loads .md agents, invokes LLMs, routes MCP tools
      agentLoader.ts              #   Parses .md files into structured definitions
      stateManager.ts             #   Pipeline state tracking with per-step timing
      cli.ts                      #   CLI commands (run, serve, mcp, agents, tools, dashboard)
      testRunner.ts               #   Write/run/parse Playwright tests
      pipeline.ts                 #   Alternative pipeline entry via Orchestrator agent

    copilot/                      # GitHub Copilot Extension (VS Code)
      server.ts                   #   Express server with SSE streaming
      verification.ts             #   GitHub signature verification (@copilot-extensions/preview-sdk)
      streaming.ts                #   SSE event helpers (ack, text, refs, confirmations, done)
      state.ts                    #   Per-thread conversation state
      types.ts                    #   Copilot protocol types
      handlers/                   #   One handler per agent/skill
        orchestrator.handler.ts   #     /run — full pipeline
        clarifier.handler.ts      #     /clarify — ambiguity detection
        requirement.handler.ts    #     /analyze — requirement extraction
        testdesign.handler.ts     #     /design — test case creation
        automation.handler.ts     #     /generate — Playwright code gen
        maintenance.handler.ts    #     /fix — test repair
        rca.handler.ts            #     /rca — root cause analysis
        reviewer.handler.ts       #     /review — governance
        index.ts                  #     Command router + natural language

    dashboard/                    # Real-time web UI
      server.ts                   #   Express API (7 endpoints) + embedded responsive HTML

    agents/                       # Class-based agent implementations
    ado/                          # Azure DevOps HTTP client
    memory/                       # Legacy memory store
    skills/                       # Locator healing, flakiness detection
    config/                       # Environment config + model routing
    utils/                        # Logger, LLM router (OpenAI + Anthropic), helpers

  playwright/                     # Playwright setup
    playwright.config.ts          #   Multi-browser config (chromium, firefox, webkit)
    fixtures/                     #   Custom fixtures
    pages/                        #   Base page object
    tests/generated/              #   Generated test specs (from automation agent)
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `qa-agent run -s <id>` | Run the full multi-agent pipeline for a story |
| `qa-agent run -s <id> --dry-run` | Generate tests but skip execution |
| `qa-agent serve --port 4567` | Start GitHub Copilot Extension server |
| `qa-agent mcp` | Start MCP server (stdio transport for VS Code) |
| `qa-agent dashboard --port 4001` | Start the real-time dashboard |
| `qa-agent agents` | List all `.md` agent definitions |
| `qa-agent tools` | List all 14 MCP tools |
| `qa-agent memory list` | List memory entries |
| `qa-agent memory list -t rca_result` | Filter memory by type |
| `qa-agent memory clear` | Clear all memory |
| `qa-agent config` | Show configuration and model routing |

---

## Dashboard

The dashboard is a full-featured responsive web UI with 7 tabs:

| Tab | What It Shows |
|-----|---------------|
| **Overview** | Clickable stat cards (Agent Logs, RCA Results, Bugs, Tests, Failures, Selector Fixes, Active Agents, Memory) — click any card to drill into the relevant tab with filters applied — plus activity timeline |
| **Agents** | All 8 `.md` agent cards with model, file, and MCP tools |
| **RCA** | Root cause analysis table with category badges, confidence bars, search, and category filter |
| **Tests** | Test artifacts (requirements, designs, generated tests, failures) with type filter |
| **Bugs** | Auto-filed ADO bugs with RCA details |
| **Memory** | Full memory store with type filter and search |
| **Logs** | Agent event logs with agent filter and search |

**Every stat card on Overview is clickable** — clicking navigates to the relevant tab with appropriate filters applied. For example, clicking "Failures" opens the Tests tab filtered to `failure` type. Clicking "Selector Fixes" opens the Memory tab filtered to `selector_fix` type.

All tabs feature:
- Search bar with live filtering
- Dropdown filters (category, type, agent)
- Expandable detail rows (click ▶ to see full JSON)
- Relative time formatting ("2m ago", "3h ago")
- 5-second auto-refresh
- Responsive layout (desktop, tablet, mobile)

---

## Copilot Extension (VS Code)

Invoke `@qa-agent` in VS Code Copilot Chat:

| Command | What It Does |
|---------|-------------|
| `/run 12345` | Full multi-agent pipeline |
| `/clarify 12345` | Check story for ambiguities |
| `/analyze 12345` | Extract requirements and scenarios |
| `/design 12345` | Create prioritized test cases |
| `/generate 12345` | Generate Playwright tests |
| `/fix` | Diagnose and fix broken tests (paste errors) |
| `/rca` | Deep root cause analysis (paste failures) |
| `/review` | Governance review of pipeline output |
| `/help` | Show all commands |

**Protocol:** `@copilot-extensions/preview-sdk` v5, SSE streaming, GitHub signature verification, per-thread state.

---

## MCP Tools (14)

| Module | Tools |
|--------|-------|
| **ADO** | `getUserStory`, `createBug`, `linkBugToStory`, `searchBugs` |
| **Playwright** | `generateTest`, `runTests`, `getFailures` |
| **Memory** | `saveMemory`, `retrieveMemory`, `findSimilarFailures` |
| **RCA** | `analyzeLogs`, `calculateConfidence` |
| **Logging** | `logEvent`, `getAgentLogs` |

The MCP server supports both **in-process calls** (orchestrator) and **stdio JSON-RPC** transport (VS Code). Use `qa-agent mcp` to start the stdio server.

---

## Agent `.md` Format

Each agent follows the GitHub Copilot agent definition format:

```markdown
# Agent: <Name>

## Role
Expert description of the agent's purpose

## Model
gpt-4o / claude-sonnet / claude-opus

## Inputs
What the agent receives

## Outputs
JSON schema of what the agent produces

## MCP Tools Used
- `toolName` — description of when/how the tool is used

## Instructions
Step-by-step logic including tool invocation examples

## Constraints
Rules the agent must follow

## Examples
Input/output examples
```

---

## RCA Categories

| Category | Meaning | Auto Action |
|----------|---------|-------------|
| `UI_CHANGE` | App UI redesigned | Fix test |
| `LOCATOR_BROKEN` | Selector fragile/renamed | Fix test |
| `API_FAILURE` | Backend API error | Create bug or retry |
| `DATA_ISSUE` | Test data stale | Retry |
| `ENVIRONMENT_ISSUE` | Infra/deploy problem | Flag infra team |
| `TEST_BUG` | Test logic error | Fix test |
| `PRODUCT_BUG` | Genuine app bug | **Auto-create ADO bug** |

When `PRODUCT_BUG` is detected, a bug is created in Azure DevOps with:
- Title, description, repro steps
- Expected vs actual results
- Error logs and screenshots
- RCA summary with confidence score
- Link to parent story

---

## Configuration

All via `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `ADO_ORG` | Azure DevOps organization | — |
| `ADO_PROJECT` | Azure DevOps project | — |
| `ADO_TOKEN` | Personal Access Token | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `MODEL_ORCHESTRATOR` | Orchestrator model | `gpt-4o` |
| `MODEL_CLARIFIER` | Clarifier model | `gpt-4o` |
| `MODEL_REQUIREMENT` | Requirement analyst model | `gpt-4o` |
| `MODEL_TEST_DESIGN` | Test designer model | `claude-sonnet-4-20250514` |
| `MODEL_AUTOMATION` | Automation engineer model | `gpt-4o` |
| `MODEL_MAINTENANCE` | Maintenance model | `gpt-4o` |
| `MODEL_RCA` | RCA model | `claude-opus-4-20250514` |
| `MODEL_REVIEWER` | Reviewer model | `claude-opus-4-20250514` |
| `BASE_URL` | App under test URL | `https://example.com` |
| `PORT` | Copilot Extension port | `3000` |
| `COPILOT_SKIP_VERIFY` | Skip GitHub sig verification | `false` |
| `HEADLESS` | Playwright headless mode | `true` |

---

## Running Locally

```bash
# Start the dashboard (port 4001)
npx tsx src/index.ts dashboard --port 4001

# Start the Copilot Extension server (port 4567)
npx tsx src/index.ts serve --port 4567 --skip-verify

# Start the MCP stdio server (for VS Code integration)
npx tsx src/index.ts mcp

# Run the full pipeline (requires API keys in .env)
npx tsx src/index.ts run --story-id 12345

# Dry run (no test execution)
npx tsx src/index.ts run --story-id 12345 --dry-run
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Test Framework | Playwright |
| LLM Providers | OpenAI (gpt-4o) + Anthropic (Claude Sonnet/Opus) |
| Agent Format | `.md` Copilot agent definitions |
| Tool Protocol | MCP (Model Context Protocol) with JSON-RPC stdio |
| Copilot Integration | `@copilot-extensions/preview-sdk` v5 + SSE streaming |
| CI/CD Integration | Azure DevOps REST API v7.0 |
| Dashboard | Express + embedded responsive HTML/CSS/JS |
| Memory | JSON file store (`rcaMemory.json`, `testResults.json`, `logs.json`) |
| CLI | Commander.js |
| Logging | Winston |
