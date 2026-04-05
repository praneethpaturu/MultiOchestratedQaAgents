/**
 * MCP Tools: Azure DevOps
 *
 * getUserStory — Fetch a user story by ID
 * createBug — Create a bug work item
 * linkBugToStory — Link a bug to its parent story
 * searchBugs — Search for existing bugs (deduplication)
 */

import { config } from "../../config/index.js";
import axios from "axios";
import type { MCPToolDefinition, MCPToolHandler } from "../server.js";

function adoHeaders() {
  return {
    Authorization: `Basic ${Buffer.from(`:${config.ado.token}`).toString("base64")}`,
    "Content-Type": "application/json-patch+json",
  };
}

function adoApi(path: string) {
  return `${config.ado.apiBase}${path}?api-version=${config.ado.apiVersion}`;
}

// ─── Tool Definitions ───

export const adoToolDefinitions: MCPToolDefinition[] = [
  {
    name: "getUserStory",
    description: "Fetch a user story from Azure DevOps by work item ID. Returns title, description, acceptance criteria, state, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        storyId: { type: "number", description: "Azure DevOps work item ID" },
      },
      required: ["storyId"],
    },
  },
  {
    name: "createBug",
    description: "Create a bug work item in Azure DevOps with title, description, repro steps, severity, and RCA summary.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Bug title" },
        description: { type: "string", description: "Detailed description in HTML" },
        reproSteps: { type: "string", description: "Steps to reproduce" },
        severity: { type: "string", description: "Bug severity level", enum: ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"] },
        tags: { type: "string", description: "Semicolon-separated tags" },
        parentStoryId: { type: "number", description: "Parent story ID to link" },
      },
      required: ["title", "description", "reproSteps", "severity"],
    },
  },
  {
    name: "linkBugToStory",
    description: "Link an existing bug to a parent user story in Azure DevOps using hierarchy relation.",
    inputSchema: {
      type: "object",
      properties: {
        bugId: { type: "number", description: "Bug work item ID" },
        storyId: { type: "number", description: "Parent story work item ID" },
      },
      required: ["bugId", "storyId"],
    },
  },
  {
    name: "searchBugs",
    description: "Search for existing bugs in Azure DevOps to prevent duplicates. Searches by title keyword and optional parent story.",
    inputSchema: {
      type: "object",
      properties: {
        titleContains: { type: "string", description: "Keyword to search in bug titles" },
        parentStoryId: { type: "number", description: "Optional: filter by parent story" },
      },
      required: ["titleContains"],
    },
  },
];

// ─── Tool Handlers ───

export const adoToolHandlers: Record<string, MCPToolHandler> = {
  async getUserStory(args: Record<string, unknown>) {
    const storyId = args.storyId as number;
    const res = await axios.get(adoApi(`/wit/workitems/${storyId}`), {
      headers: { ...adoHeaders(), "Content-Type": "application/json" },
      params: { $expand: "all" },
    });
    const f = res.data.fields;
    return {
      id: res.data.id,
      title: f["System.Title"] ?? "",
      description: f["System.Description"] ?? "",
      acceptanceCriteria: f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "",
      state: f["System.State"] ?? "",
      assignedTo: f["System.AssignedTo"]?.displayName ?? "Unassigned",
      tags: (f["System.Tags"] ?? "").split(";").map((t: string) => t.trim()).filter(Boolean),
      url: res.data._links?.html?.href ?? "",
    };
  },

  async createBug(args: Record<string, unknown>) {
    const body = [
      { op: "add", path: "/fields/System.Title", value: args.title },
      { op: "add", path: "/fields/System.Description", value: args.description },
      { op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: args.reproSteps },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: args.severity },
      { op: "add", path: "/fields/System.Tags", value: args.tags ?? "auto-qa-agent" },
    ];

    if (args.parentStoryId) {
      body.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: `${config.ado.apiBase}/wit/workitems/${args.parentStoryId}`,
        } as any,
      });
    }

    const res = await axios.post(adoApi("/wit/workitems/$Bug"), body, {
      headers: adoHeaders(),
    });

    return {
      id: res.data.id,
      url: res.data._links?.html?.href ?? "",
    };
  },

  async linkBugToStory(args: Record<string, unknown>) {
    const body = [
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: `${config.ado.apiBase}/wit/workitems/${args.storyId}`,
        },
      },
    ];
    await axios.patch(adoApi(`/wit/workitems/${args.bugId}`), body, {
      headers: adoHeaders(),
    });
    return { linked: true, bugId: args.bugId, storyId: args.storyId };
  },

  async searchBugs(args: Record<string, unknown>) {
    const title = (args.titleContains as string).replace(/'/g, "''").slice(0, 100);
    let wiql = `SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [System.State] <> 'Closed' AND [System.Title] CONTAINS '${title}'`;
    if (args.parentStoryId) {
      wiql += ` AND [System.Parent] = ${args.parentStoryId}`;
    }

    const res = await axios.post(
      adoApi("/wit/wiql"),
      { query: wiql },
      { headers: { ...adoHeaders(), "Content-Type": "application/json" } }
    );

    return {
      count: res.data.workItems?.length ?? 0,
      bugs: (res.data.workItems ?? []).slice(0, 10).map((wi: any) => ({ id: wi.id })),
    };
  },
};
