## QA Agents — Multi-Agent Orchestrated QA Platform

This workspace contains a multi-agent QA system with 8 specialized AI agents that learn and improve over time.

### Agent Architecture

The **QA Orchestrator** is the central brain. It NEVER does work itself — it analyzes user intent and delegates to the right specialist agent.

| Agent | Specialty | Model |
|-------|-----------|-------|
| **QA Orchestrator** | Routes requests, manages pipeline | GPT-4o |
| **QA Clarifier** | Identifies ambiguities in stories | GPT-4o |
| **QA Requirement Analyst** | Extracts scenarios, ACs, edge cases | GPT-4o |
| **QA Test Designer** | Creates prioritized P0-P3 test cases | Claude Sonnet 4 |
| **QA Automation Engineer** | Generates Playwright tests (POM) | GPT-4o |
| **QA Maintenance** | Fixes broken selectors, timing | GPT-4o |
| **QA Root Cause Analysis** | 7-category failure classification | Claude Opus 4 |
| **QA Reviewer** | Governance gate: 8 criteria, 0-100 | Claude Opus 4 |

### MCP Server Integration

All agents connect to the `qa-agent-mcp` MCP server (configured in `.vscode/mcp.json`) which provides 14 tools:
- **ADO**: getUserStory, createBug, linkBugToStory, searchBugs
- **Playwright**: generateTest, runTests, getFailures
- **Memory**: saveMemory, retrieveMemory, findSimilarFailures
- **RCA**: analyzeLogs, calculateConfidence
- **Logging**: logEvent, getAgentLogs

### Learning & Dashboard

Every agent follows a **learn → act → remember** pattern:
1. **Before acting**: Retrieve relevant history from memory (past fixes, patterns, feedback)
2. **Do the work**: Analyze, generate, fix, review
3. **After acting**: Save results and learnings to memory + log events for dashboard

The dashboard (`npx tsx src/index.ts dashboard`) reads from the same memory store in real-time.

### Feedback Loops

| From | Saves | Consumed By |
|------|-------|-------------|
| Maintenance | `selector_fix` | Automation Engineer (self-healing) |
| RCA | `rca_result` | Maintenance, RCA (pattern matching) |
| Reviewer | `reviewer_feedback` | Test Designer, Automation Engineer |
| Reviewer | `missed_scenarios` | Requirement Analyst |
| All agents | `logEvent` | Dashboard (real-time visibility) |
