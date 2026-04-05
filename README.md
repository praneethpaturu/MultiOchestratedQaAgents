# QA Agents — Multi-Agent Orchestrated QA Platform

An intelligent, production-ready QA system built on the **GitHub Copilot agent protocol** where a central Orchestrator agent dynamically coordinates specialized sub-agents like a real QA team.

## Architecture

```
                         ┌─────────────────────┐
                         │   @orchestrator      │
                         │   (Central Brain)    │
                         └────────┬────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
     ┌────────▼──────┐  ┌────────▼──────┐  ┌────────▼──────┐
     │  @clarifier   │  │ @requirement  │  │ @test-designer│
     │  Ask user for │  │  -analyst     │  │  Create test  │
     │  clarification│  │  Extract      │  │  cases        │
     └───────────────┘  │  scenarios    │  └───────┬───────┘
                        └───────────────┘          │
              ┌────────────────────────────────────┘
              │
     ┌────────▼──────────┐
     │ @automation       │
     │  -engineer        │──── Run Tests ────┐
     │  Generate PW tests│                   │
     └───────────────────┘                   │
                                    ┌────────▼────────┐
              ┌─────────────────────│   Failures?     │
              │                     └────────┬────────┘
     ┌────────▼──────┐                       │
     │ @maintenance  │◄──────────────────────┘
     │  Fix locators,│
     │  waits, flows │
     └───────┬───────┘
             │ still failing?
     ┌───────▼───────┐
     │    @rca       │
     │  Root cause   │──── PRODUCT_BUG → Create ADO Bug
     │  analysis     │──── TEST_BUG → Back to @automation-engineer
     └───────┬───────┘──── ENV_ISSUE → Flag infra
             │
     ┌───────▼───────┐
     │  @reviewer    │
     │  Governance   │──── APPROVED → Done
     │  gate         │──── REJECTED → Loop back
     └──────────────┘
```

## Copilot Agent Protocol

Every agent implements the GitHub Copilot agent protocol:

- **Agent Card**: Manifest with slug, name, description, and skills
- **Skills**: Invocable capabilities with typed parameters
- **Registry**: Dynamic agent discovery — agents self-register on construction
- **Message Protocol**: Structured request/response with conversation history
- **Tool Calling**: Orchestrator uses LLM function-calling to invoke sub-agents

### Agent Manifest

| Agent | Slug | Role | Default Model |
|-------|------|------|---------------|
| Orchestrator | `@orchestrator` | Central brain, routes to sub-agents | gpt-4o |
| Clarifier | `@clarifier` | Identifies ambiguities, asks user questions | gpt-4o |
| Requirement Analyst | `@requirement-analyst` | Extract scenarios & edge cases | gpt-4o |
| Test Designer | `@test-designer` | Create prioritized test cases | claude-sonnet |
| Automation Engineer | `@automation-engineer` | Generate Playwright tests (POM) | gpt-4o |
| Maintenance Agent | `@maintenance` | Fix broken locators, waits, flows | gpt-4o |
| RCA Agent | `@rca` | Deep root cause analysis | claude-opus |
| Reviewer Agent | `@reviewer` | Governance and quality gate | claude-opus |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Configure environment
cp .env.example .env
# Edit .env with your ADO credentials and API keys

# 4. Run the orchestrated pipeline
npm run qa-agent -- run --story-id 123

# 5. Interactive mode (with clarification)
npm run qa-agent -- interactive --story-id 123
```

## CLI Commands

```bash
# Full orchestrated pipeline
qa-agent run --story-id 123

# Interactive mode (orchestrator pauses for clarification)
qa-agent run --story-id 123 --interactive
qa-agent interactive --story-id 123

# Dry run (generate tests, don't execute)
qa-agent run --story-id 123 --dry-run

# Generate tests only
qa-agent run --story-id 123 --skip-tests

# List all registered agents and skills
qa-agent agents

# View memory
qa-agent memory list
qa-agent memory list --type rca_result
qa-agent memory clear

# Show config and model routing
qa-agent config
```

## How the Orchestrator Works

The Orchestrator is **not a hardcoded pipeline**. It uses LLM-driven tool-calling to dynamically decide what to do:

1. Receives a story ID
2. Invokes `@clarifier` to check for ambiguities
3. If blocking questions exist → pauses for user input
4. Invokes `@requirement-analyst` → `@test-designer` → `@automation-engineer`
5. Runs Playwright tests
6. On failure: dynamically chooses between `@maintenance`, `@rca`, or `@automation-engineer`
7. Based on RCA: files bugs, flags infra, or loops back for fixes
8. Always ends with `@reviewer` for governance
9. Loops on rejection until approved or max loops reached

Each step is a **conscious decision** by the orchestrator's LLM, not a fixed sequence.

## Configuration

All configuration via `.env`:

| Variable | Description |
|----------|-------------|
| `ADO_ORG` | Azure DevOps organization |
| `ADO_PROJECT` | Azure DevOps project |
| `ADO_TOKEN` | Personal Access Token |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `MODEL_ORCHESTRATOR` | Model for the orchestrator agent |
| `MODEL_CLARIFIER` | Model for the clarifier agent |
| `MODEL_REQUIREMENT` | Model for requirement analysis |
| `MODEL_TEST_DESIGN` | Model for test design |
| `MODEL_AUTOMATION` | Model for code generation |
| `MODEL_MAINTENANCE` | Model for fix generation |
| `MODEL_RCA` | Model for root cause analysis |
| `MODEL_REVIEWER` | Model for governance |

## Project Structure

```
qa-agents/
  src/
    agents/
      protocol.ts        # Copilot agent protocol types
      registry.ts        # Agent registry & discovery
      base.ts            # Base agent with auto-registration
      orchestrator.ts    # Central orchestrator (the brain)
      clarifier.ts       # Clarification agent
      requirementAnalyst.ts
      testDesigner.ts
      automationEngineer.ts
      maintenance.ts
      rca.ts
      reviewer.ts
      types.ts           # Shared data types
    skills/              # Locator healing, flakiness detection
    orchestrator/
      pipeline.ts        # Orchestrator-driven pipeline entry
      agentInit.ts       # Agent initialization & registration
      testRunner.ts      # Playwright execution & result parsing
      cli.ts             # CLI commands
    ado/                 # Azure DevOps integration
    memory/              # Persistent memory store
    config/              # Configuration
    utils/               # Logger, LLM router (with tool-calling), helpers
  playwright/
    fixtures/            # Playwright test fixtures
    pages/               # Page Object Models
    tests/generated/     # Generated test specs
```

## RCA Categories

- `UI_CHANGE` — Application UI changed
- `LOCATOR_BROKEN` — Selector is fragile
- `API_FAILURE` — Backend API error
- `DATA_ISSUE` — Test data problems
- `ENVIRONMENT_ISSUE` — Infrastructure problems
- `TEST_BUG` — Bug in the test code
- `PRODUCT_BUG` — Genuine application bug (auto-creates ADO bug)

## Auto Bug Creation

When RCA identifies `PRODUCT_BUG`:
- Bug auto-created in ADO with title, steps, logs, screenshots, RCA summary
- Linked to parent story via `System.LinkTypes.Hierarchy-Reverse`
- Duplicate detection prevents re-filing
