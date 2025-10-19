import OpenAI from "openai";
import type { Channel, DefaultGenerics, Event, StreamChat } from "stream-chat";
import type { AIAgent } from "../types";
import { OpenAIResponseHandler } from "./OpenAIResponseHandler";


export class OpenAIMedicalAgent implements AIAgent {
  private openai?: OpenAI;
  private assistant?: OpenAI.Beta.Assistants.Assistant;
  private openAiThread?: OpenAI.Beta.Threads.Thread;
  private lastInteractionTs = Date.now();

  private handlers: OpenAIResponseHandler[] = [];

  constructor(
    readonly chatClient: StreamChat,
    readonly channel: Channel
  ) {}

  dispose = async () => {
    this.chatClient.off("message.new", this.handleMessage);
    await this.chatClient.disconnectUser();

    this.handlers.forEach((handler) => handler.dispose());
    this.handlers = [];
  };

  get user() {
    return this.chatClient.user;
  }

  getLastInteraction = (): number => this.lastInteractionTs;

  init = async () => {
    const apiKey = process.env.OPENAI_API_KEY as string | undefined;
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }

    this.openai = new OpenAI({ apiKey });
    this.assistant = await this.openai.beta.assistants.create({
      name: "AI Medical Assistant",
      instructions: this.getMedicalAssistantPrompt(),
      model: "gpt-4o",
      tools: [
        { type: "code_interpreter" },
        {
          type: "function",
          function: {
            name: "web_search",
            description:
              "Search the web for current medical information, news, guidelines, or research on any topic",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The medical search query to find information about",
                },
              },
              required: ["query"],
            },
          },
        },
      ],
      temperature: 0.7,
    });
    this.openAiThread = await this.openai.beta.threads.create();

    this.chatClient.on("message.new", this.handleMessage);
  };

  private getMedicalAssistantPrompt = (context?: string): string => {
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return `You are an expert AI Medical Assistant. Your primary purpose is to provide accurate, safe, and up-to-date medical information and support.

**Core Capabilities:**
- Clinical Information, Health Guidance, Interpretation of Medical Data, Recommendations based on evidence, and Patient Education.
- **Web Search**: Ability to search the web for current medical guidelines, research, and news using the 'web_search' tool.
- **Current Date**: Today's date is ${currentDate}. Use this for any time-sensitive queries.

**Essential Instructions:**
1. **ALWAYS use the 'web_search' tool when a user requests current medical information, guidelines, or news.** Use your internal knowledge only when up-to-date sources are unnecessary.
2. When using the 'web_search' tool, base your response strictly on the information provided in the search result. Do not rely on pre-existing knowledge for any topic that requires recent updates.
3. Synthesize information from the web search to provide comprehensive and accurate medical answers. Cite sources if results include URLs.

**Response Format:**
- Be direct and professional in all responses.
- Use medical terminology clearly and responsibly.
- Never begin responses with phrases like "Here's the medical info:", "I found:", or similar.
- Provide responses directly, avoiding unnecessary preambles.

**Medical Context**: ${context || "General medical assistance."}

Your goal is to ensure accuracy, safety, clarity, and empathy in delivering medical information. Failure to use web search for recent medical topics will result in an incorrect answer.`;
  };

  // Retain event handler structure for dependent files
  private handleMessage = async (e: Event<DefaultGenerics>) => {
    if (!this.openai || !this.openAiThread || !this.assistant) {
      console.log("OpenAI not initialized");
      return;
    }

    if (!e.message || e.message.ai_generated) {
      return;
    }

    const message = e.message.text;
    if (!message) return;

    this.lastInteractionTs = Date.now();

    const medicalTask = (e.message.custom as { medicalTask?: string })?.medicalTask;
    const context = medicalTask ? `Medical Task: ${medicalTask}` : undefined;
    const instructions = this.getMedicalAssistantPrompt(context);

    await this.openai.beta.threads.messages.create(this.openAiThread.id, {
      role: "user",
      content: message,
    });

    const { message: channelMessage } = await this.channel.sendMessage({
      text: "",
      ai_generated: true,
    });

    await this.channel.sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_THINKING",
      cid: channelMessage.cid,
      message_id: channelMessage.id,
    });

    const run = this.openai.beta.threads.runs.createAndStream(
      this.openAiThread.id,
      {
        assistant_id: this.assistant.id,
      }
    );

    const handler = new OpenAIResponseHandler(
      this.openai,
      this.openAiThread,
      run,
      this.chatClient,
      this.channel,
      channelMessage,
      () => this.removeHandler(handler)
    );
    this.handlers.push(handler);
    void handler.run();
  };

  private removeHandler = (handlerToRemove: OpenAIResponseHandler) => {
    this.handlers = this.handlers.filter(
      (handler) => handler !== handlerToRemove
    );
  };
}
