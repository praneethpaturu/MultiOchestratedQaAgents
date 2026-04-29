#!/usr/bin/env node
// Minimal MCP server to test if VS Code can communicate at all
let buffer = Buffer.alloc(0);

process.stderr.write("TEST MCP: starting\n");

process.stdin.on("data", (chunk) => {
  process.stderr.write(`TEST MCP: received ${chunk.length} bytes\n`);
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.subarray(0, headerEnd).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const len = parseInt(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = JSON.parse(buffer.subarray(bodyStart, bodyStart + len).toString());
    buffer = buffer.subarray(bodyStart + len);
    process.stderr.write(`TEST MCP: method=${body.method} id=${body.id}\n`);
    let resp = null;
    if (body.method === "initialize") {
      resp = { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "qa-agent-mcp", version: "2.0.0" } } };
    } else if (body.method === "tools/list") {
      resp = { jsonrpc: "2.0", id: body.id, result: { tools: [] } };
    } else if (body.method === "notifications/initialized") {
      // no response needed
    } else {
      resp = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } };
    }
    if (resp) {
      const s = JSON.stringify(resp);
      process.stdout.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
      process.stderr.write(`TEST MCP: sent response for id=${resp.id}\n`);
    }
  }
});

process.stdin.on("end", () => {
  process.stderr.write("TEST MCP: stdin closed\n");
});
