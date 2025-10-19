import { StreamChat } from "stream-chat";
import { apiKey, serverClient } from "../serverClient";
import { OpenAIMedicalAgent } from "./openai/OpenAIAgent";
import {GroqMedicalAgent} from "./groq/GroqAiAgent";
import { AgentPlatform, AIAgent } from "./types";

export const createAgent = async (
  user_id: string,
  platform: AgentPlatform,
  channel_type: string,
  channel_id: string
): Promise<AIAgent> => {
  // Here we used the user with admin privileges to create the token for other users.
  const token = serverClient.createToken(user_id);
  // This is the client for the AI bot user
  const chatClient = new StreamChat(apiKey, undefined, {
    allowServerSideConnect: true,
  });

  await chatClient.connectUser({ id: user_id }, token);
  const channel = chatClient.channel(channel_type, channel_id);
  await channel.watch();

  switch (platform) {
    case AgentPlatform.OPENAI:
      return new OpenAIMedicalAgent(chatClient, channel);
    case AgentPlatform.GROQ:
        return new GroqMedicalAgent(chatClient, channel);
    // case Agent
    default:
      throw new Error(`Unsupported agent platform: ${platform}`);
  }
};