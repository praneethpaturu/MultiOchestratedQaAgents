import { getAdoClient } from "./client.js";
import { agentLogger } from "../utils/logger.js";
import { config } from "../config/index.js";

const log = agentLogger("ADO:Story");

export interface UserStory {
  id: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  state: string;
  assignedTo: string;
  tags: string[];
  url: string;
}

export async function fetchStory(storyId: number): Promise<UserStory> {
  log.info(`Fetching user story #${storyId}`);
  const client = getAdoClient();

  const response = await client.get(`/wit/workitems/${storyId}`, {
    params: {
      $expand: "all",
      "api-version": config.ado.apiVersion,
    },
    headers: { "Content-Type": "application/json" },
  });

  const fields = response.data.fields;
  const story: UserStory = {
    id: response.data.id,
    title: fields["System.Title"] ?? "",
    description: fields["System.Description"] ?? "",
    acceptanceCriteria:
      fields["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "",
    state: fields["System.State"] ?? "",
    assignedTo:
      fields["System.AssignedTo"]?.displayName ?? "Unassigned",
    tags: (fields["System.Tags"] ?? "")
      .split(";")
      .map((t: string) => t.trim())
      .filter(Boolean),
    url: response.data._links?.html?.href ?? "",
  };

  log.info(`Fetched: "${story.title}" [${story.state}]`);
  return story;
}

export async function fetchStoriesByQuery(wiql: string): Promise<UserStory[]> {
  const client = getAdoClient();

  const queryResult = await client.post(
    "/wit/wiql",
    { query: wiql },
    { headers: { "Content-Type": "application/json" } }
  );

  const ids: number[] = queryResult.data.workItems.map(
    (wi: { id: number }) => wi.id
  );
  if (ids.length === 0) return [];

  const stories = await Promise.all(ids.slice(0, 50).map(fetchStory));
  return stories;
}
