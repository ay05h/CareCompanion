import type { Channel, StreamChat, User } from "stream-chat";

export interface AIAgent {
  user?: User;
  channel: Channel;
  chatClient: StreamChat;
  getLastInteraction: () => number;
  init: () => Promise<void>;
  dispose: () => Promise<void>;
}

export enum AgentPlatform {
  OPENAI = "openai",
  GROQ = "groq",
}


export interface MedicalMessage {
  custom?: {
    messageType?: "user_input" | "ai_response" | "system_message";
    medicalTask?: string;
    findings?: string[];
    recommendations?: string[];
  };
}

