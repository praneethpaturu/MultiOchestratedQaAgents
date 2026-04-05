## QA Agents — Multi-Agent Orchestrated QA Platform

This workspace contains a multi-agent QA system with 8 specialized AI agents.

### Agent Architecture

The **QA Orchestrator** is the central brain. It NEVER does work itself — it analyzes user intent and delegates to the right specialist agent:

| Agent | Speciality |
|-------|-----------|
| **QA Orchestrator** | Routes requests to the correct agent, manages pipeline |
| **QA Clarifier** | Identifies ambiguities in user stories |
| **QA Requirement Analyst** | Extracts scenarios, ACs, edge cases |
| **QA Test Designer** | Creates prioritized P0-P3 test cases |
| **QA Automation Engineer** | Generates Playwright TypeScript tests (POM) |
| **QA Maintenance** | Fixes broken selectors, timing, stale flows |
| **QA Root Cause Analysis** | 7-category failure classification with confidence |
| **QA Reviewer** | Governance gate: 8 criteria, score 0-100 |

### Pipeline Flow

```
Story → Clarifier → Requirement Analyst → Test Designer → Automation Engineer → Reviewer
                                                              ↓ (if failures)
                                                        Maintenance → RCA → Bug Filing
```

### Test Framework
- **Playwright** with TypeScript
- Page Object Model pattern
- Stable selectors: `data-testid` > `getByRole` > `getByLabel`
- Tests in `playwright/tests/generated/`
- Page objects in `playwright/pages/`

### Key Directories
- `.github/agents/` — Agent definitions (used by Copilot)
- `agents/` — Legacy agent definitions (used by CLI)
- `src/` — Backend source code (orchestrator, MCP server, dashboard)
- `playwright/` — Test framework configuration
