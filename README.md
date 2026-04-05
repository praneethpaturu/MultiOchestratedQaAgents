# QA Agents — Autonomous Multi-Agent QA Platform

An intelligent, production-ready QA system where specialized AI agents collaborate like a real QA team. Built with Playwright, TypeScript, and Azure DevOps integration.

## Architecture

```
ADO Story → Requirement Agent → Test Designer → Automation Engineer → Run Tests
                                                                        ↓
                    Reviewer ← RCA Agent ← Maintenance Agent ← Failures?
                       ↓
                Pass? → DONE
                Fail? → Loop Back
```

### Agents

| Agent | Role | Default Model |
|-------|------|---------------|
| Requirement Analyst | Extract scenarios & edge cases from stories | gpt-4o |
| Test Designer | Create prioritized test cases | claude-sonnet |
| Automation Engineer | Generate Playwright tests (POM) | gpt-4o |
| Maintenance Agent | Fix broken locators, waits, flows | gpt-4o |
| RCA Agent | Deep root cause analysis | claude-opus |
| Reviewer Agent | Governance and quality gate | claude-opus |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Configure environment
cp .env.example .env
# Edit .env with your ADO credentials and API keys

# 4. Run the pipeline
npm run qa-agent -- run --story-id 123

# Or using tsx directly
npx tsx src/index.ts run --story-id 123
```

## CLI Commands

```bash
# Full pipeline
qa-agent run --story-id 123

# Dry run (generate tests, don't execute)
qa-agent run --story-id 123 --dry-run

# Generate tests only (write to disk, skip execution)
qa-agent run --story-id 123 --skip-tests

# View memory
qa-agent memory list
qa-agent memory list --type rca_result
qa-agent memory clear

# Show config
qa-agent config
```

## Configuration

All configuration is via environment variables (`.env` file):

| Variable | Description |
|----------|-------------|
| `ADO_ORG` | Azure DevOps organization name |
| `ADO_PROJECT` | Azure DevOps project name |
| `ADO_TOKEN` | Personal Access Token |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `MODEL_REQUIREMENT` | Model for requirement analysis |
| `MODEL_TEST_DESIGN` | Model for test design |
| `MODEL_AUTOMATION` | Model for code generation |
| `MODEL_MAINTENANCE` | Model for fix generation |
| `MODEL_RCA` | Model for root cause analysis |
| `MODEL_REVIEWER` | Model for review/governance |
| `BASE_URL` | Application under test URL |

## Project Structure

```
qa-agents/
  src/
    agents/           # All 6 AI agents
    skills/           # Locator healing, flakiness detection
    orchestrator/     # Pipeline, CLI, test runner
    ado/              # Azure DevOps integration
    memory/           # Persistent memory store
    config/           # Configuration
    utils/            # Logger, LLM router, helpers
  playwright/
    fixtures/         # Playwright test fixtures
    pages/            # Page Object Models
    tests/generated/  # Generated test specs
  reports/            # Test execution reports
```

## RCA Categories

When tests fail persistently, the RCA agent classifies the root cause:

- `UI_CHANGE` — Application UI changed
- `LOCATOR_BROKEN` — Selector is fragile
- `API_FAILURE` — Backend API error
- `DATA_ISSUE` — Test data problems
- `ENVIRONMENT_ISSUE` — Infrastructure problems
- `TEST_BUG` — Bug in the test code
- `PRODUCT_BUG` — Genuine application bug (auto-creates ADO bug)

## Auto Bug Creation

When RCA identifies a `PRODUCT_BUG`, a bug is automatically created in ADO with:
- Title and description
- Steps to reproduce
- Expected vs actual results
- Error logs and screenshots
- RCA summary
- Link to parent story

Duplicate detection prevents filing the same bug twice.
