#!/usr/bin/env node

// Fast-path for MCP stdio mode — must attach stdin listener before
// any async work to avoid losing buffered data from VS Code.
if (process.argv[2] === "mcp") {
  // Buffer stdin immediately so no data is lost during module loading
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));

  import("./mcp/server.js").then(async ({ initMCPServer, startStdioTransport }) => {
    initMCPServer();
    await startStdioTransport(chunks);
  });
} else {
  import("./orchestrator/cli.js").then(({ createCLI }) => {
    const cli = createCLI();
    cli.parse(process.argv);
  });
}
