import { BaseAgent } from "./base.js";
import { extractJSON } from "../utils/helpers.js";
import { AgentCard, AgentRequest, AgentResponse } from "./protocol.js";
import { UserStory } from "../ado/storyService.js";

const SYSTEM_PROMPT = `You are a QA Clarifier Agent. Your job is to analyze user stories, requirements, or context and identify ambiguities, missing information, or assumptions that need human confirmation before testing can begin.

You are the bridge between the product team and the QA pipeline. You ONLY ask questions when genuine ambiguity exists — do not ask obvious questions.

Respond with JSON:
{
  "needsClarification": boolean,
  "questions": [
    {
      "id": string ("Q1", "Q2", ...),
      "question": string,
      "context": string (why this question matters for testing),
      "category": "requirement" | "scope" | "data" | "environment" | "priority" | "behavior",
      "blocking": boolean (if true, testing cannot proceed without an answer),
      "defaultAssumption": string (what you'll assume if no answer is given)
    }
  ],
  "assumptions": string[] (things you'll assume are true unless corrected),
  "summary": string
}

Rules:
- Only flag GENUINE ambiguities (missing AC, unclear flows, undefined edge cases)
- Never ask more than 7 questions
- Mark blocking: true only when testing literally cannot proceed
- Always provide a defaultAssumption so the pipeline can continue if the user is unavailable
- Category helps the orchestrator route the question to the right person
`;

export interface ClarificationResult {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  assumptions: string[];
  summary: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  context: string;
  category: "requirement" | "scope" | "data" | "environment" | "priority" | "behavior";
  blocking: boolean;
  defaultAssumption: string;
}

export class ClarifierAgent extends BaseAgent {
  constructor() {
    super("ClarifierAgent", "clarifier");
  }

  getAgentCard(): AgentCard {
    return {
      slug: "clarifier",
      name: "Clarifier Agent",
      description: "Identifies ambiguities in user stories and requirements, asks targeted clarification questions",
      instructions: "Analyzes requirements for missing information, undefined behavior, and assumptions. Asks the user targeted questions and provides sensible defaults so the pipeline can proceed even without answers.",
      skills: [
        {
          name: "analyze_clarity",
          description: "Analyze a user story or requirement for ambiguities and generate clarification questions",
          parameters: [
            { name: "story", type: "object", description: "UserStory object from ADO", required: true },
          ],
        },
        {
          name: "process_answers",
          description: "Process user answers to clarification questions and produce enriched context",
          parameters: [
            { name: "originalQuestions", type: "array", description: "Original ClarificationQuestion array", required: true },
            { name: "answers", type: "object", description: "Map of question ID → user answer", required: true },
            { name: "story", type: "object", description: "Original UserStory", required: true },
          ],
        },
      ],
      isOrchestrator: false,
    };
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    const skill = request.skillName ?? "analyze_clarity";

    if (skill === "analyze_clarity") {
      const story = request.arguments?.story as UserStory;
      if (!story) {
        return this.error("story is required");
      }
      try {
        const result = await this.analyzeClarity(story);
        if (result.needsClarification) {
          return {
            agentSlug: "clarifier",
            messages: [{
              role: "agent",
              agentSlug: "clarifier",
              content: result.summary,
              data: result,
              timestamp: new Date().toISOString(),
            }],
            data: result,
            needsUserInput: result.questions.some((q) => q.blocking),
            questions: result.questions.map((q) => `[${q.id}] ${q.question}`),
            status: result.questions.some((q) => q.blocking) ? "needs_input" : "complete",
          };
        }
        return this.success("No clarification needed — requirements are clear", result);
      } catch (err) {
        return this.error(`Clarity analysis failed: ${(err as Error).message}`);
      }
    }

    if (skill === "process_answers") {
      const questions = request.arguments?.originalQuestions as ClarificationQuestion[];
      const answers = request.arguments?.answers as Record<string, string>;
      const story = request.arguments?.story as UserStory;
      if (!questions || !answers || !story) {
        return this.error("originalQuestions, answers, and story are required");
      }
      try {
        const enriched = await this.processAnswers(questions, answers, story);
        return this.success("Clarification processed — enriched context ready", enriched);
      } catch (err) {
        return this.error(`Failed to process answers: ${(err as Error).message}`);
      }
    }

    return this.error(`Unknown skill: ${skill}`);
  }

  async analyzeClarity(story: UserStory): Promise<ClarificationResult> {
    this.log.info(`Analyzing clarity of story #${story.id}: "${story.title}"`);

    const userPrompt = `Analyze this user story for ambiguities and missing information:

## Story #${story.id}: ${story.title}

### Description
${story.description || "(no description)"}

### Acceptance Criteria
${story.acceptanceCriteria || "(no acceptance criteria specified)"}

### Tags
${story.tags.join(", ") || "(none)"}

Identify any ambiguities, missing information, or assumptions that need clarification before QA testing can begin. Respond with JSON only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 3000,
    });

    const result = extractJSON<ClarificationResult>(response.content);
    this.log.info(
      `Clarity analysis: ${result.needsClarification ? `${result.questions.length} question(s)` : "clear"}`
    );
    return result;
  }

  async processAnswers(
    questions: ClarificationQuestion[],
    answers: Record<string, string>,
    story: UserStory
  ): Promise<{ enrichedContext: string; resolvedAssumptions: string[] }> {
    this.log.info(`Processing ${Object.keys(answers).length} clarification answers`);

    const qaPairs = questions.map((q) => {
      const answer = answers[q.id];
      return `Q: ${q.question}\nA: ${answer ?? `(no answer — assuming: ${q.defaultAssumption})`}`;
    });

    const userPrompt = `Based on these clarification Q&A, produce an enriched context summary for the QA pipeline.

## Original Story
${story.title}: ${story.description}

## Clarification Q&A
${qaPairs.join("\n\n")}

Respond with JSON:
{
  "enrichedContext": string (a paragraph summarizing all resolved requirements),
  "resolvedAssumptions": string[] (list of confirmed assumptions)
}`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 2000,
    });

    return extractJSON(response.content);
  }
}
