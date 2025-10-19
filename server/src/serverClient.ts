import { StreamChat } from "stream-chat";

export const apiKey = process.env.STREAM_API_KEY as string;
export const apiSecret = process.env.STREAM_API_SECRET as string;

if (!apiKey || !apiSecret) {
  throw new Error(
    "Missing required environment variables STREAM_API_KEY or STREAM_API_SECRET"
  );
}

// Server-side Stream client (initialized with API key + secret).
// This client has administrative privileges and should only be used on the backend.
// Typical uses include creating/deleting users, issuing user tokens, and managing channels.
// Never expose the API secret in frontend code — tokens generated here are what client/bot
// instances will use to authenticate with Stream.
export const serverClient = new StreamChat(apiKey, apiSecret);
