import Groq from "groq-sdk";
import { TavilyClient } from "tavily";
import twilio from "twilio";
import type { Channel, DefaultGenerics, Event, StreamChat } from "stream-chat";
import type { AIAgent } from "../types";

export class GroqMedicalAgent implements AIAgent {
  private groqClient: Groq;
  private tavily: TavilyClient;
  private twilioClient: twilio.Twilio;
  private lastInteractionTs = Date.now();
  private handlers: Set<NodeJS.Timeout> = new Set();
  private readonly MAX_HISTORY_MESSAGES = 20;
  private readonly MAX_CONTEXT_LENGTH = 6000;

  constructor(readonly chatClient: StreamChat, readonly channel: Channel) {
    this.groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY!,
    });

    this.tavily = new TavilyClient({
      apiKey: process.env.TAVILY_API_KEY!,
    });

    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }

  get user() {
    return this.chatClient.user;
  }

  getLastInteraction = (): number => this.lastInteractionTs;

  dispose = async () => {
    this.chatClient.off("message.new", this.handleMessage);
    await this.chatClient.disconnectUser();
    this.handlers.forEach((t) => clearTimeout(t));
    this.handlers.clear();
  };

  init = async () => {
    this.chatClient.on("message.new", this.handleMessage);
  };

  private reverseGeocode = async (lat: number, long: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${long}&zoom=14&addressdetails=1`,
        {
          headers: {
            "User-Agent": "MedicalCompanionApp/1.0",
          },
        }
      );

      if (!response.ok) {
        console.error("Reverse geocoding failed:", response.statusText);
        return "your location";
      }

      const data = await response.json();
      
      // Extract meaningful location parts
      const address = data.address || {};
      const parts = [];
      
      if (address.suburb || address.neighbourhood) {
        parts.push(address.suburb || address.neighbourhood);
      }
      if (address.city || address.town || address.village) {
        parts.push(address.city || address.town || address.village);
      }
      if (address.state) {
        parts.push(address.state);
      }
      if (address.country) {
        parts.push(address.country);
      }

      return parts.length > 0 ? parts.join(", ") : "your location";
    } catch (err) {
      console.error("Reverse geocoding error:", err);
      return "your location";
    }
  };

  // Fetch conversation history from the channel
  private getConversationHistory = async (limit: number = this.MAX_HISTORY_MESSAGES): Promise<Array<{ role: string; content: string }>> => {
    try {
      const response = await this.channel.query({
        messages: { limit },
      });

      if (!response.messages || response.messages.length === 0) {
        return [];
      }

      // Convert channel messages to chat format
      const history: Array<{ role: string; content: string }> = [];
      let totalLength = 0;
      
      // Process messages in reverse order (oldest first)
      const messages = [...response.messages].reverse();
      
      for (const msg of messages) {
        if (!msg.text) continue;

        // Parse message text (it might be JSON formatted)
        let messageText = msg.text;
        try {
          const parsed = JSON.parse(msg.text);
          messageText = parsed.text || msg.text;
        } catch {
          // If not JSON, use as-is
        }

        // Skip empty messages
        if (!messageText || messageText.trim() === "") continue;

        // Check if adding this message would exceed context length
        if (totalLength + messageText.length > this.MAX_CONTEXT_LENGTH) {
          console.log(`Truncating history at ${history.length} messages to stay within context limit`);
          break;
        }

        // Determine role based on ai_generated flag
        const role = msg.ai_generated ? "assistant" : "user";
        history.push({ role, content: messageText });
        totalLength += messageText.length;
      }

      // Return in chronological order (oldest to newest)
      return history;
    } catch (err) {
      console.error("Error fetching conversation history:", err);
      return [];
    }
  };

  private searchWeb = async (query: string): Promise<string> => {
    try {
      const result = await this.tavily.search({ query, max_results: 5 });
      if (!result?.results?.length) return "No relevant information found.";

      return result.results
        .map(
          (r: any, i: number) =>
            `${i + 1}. ${r.title || "Untitled"} - ${r.url || ""}\n${r.content || ""}`
        )
        .join("\n\n");
    } catch (err) {
      console.error("Tavily search error:", err);
      return "Error fetching search results.";
    }
  };

  private sendEmergencyAlert = async (
    userMessage: string,
    phoneNumber: string = process.env.EMERGENCY_CONTACT_NUMBER || "+1234567890"
  ): Promise<boolean> => {
    try {
      await this.twilioClient.messages.create({
        body: `EMERGENCY ALERT: A user has sent a potentially suicidal message. Message: "${userMessage}". Please provide immediate assistance. Time: ${new Date().toISOString()}`,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: phoneNumber,
      });
      console.log("Emergency alert sent successfully");
      return true;
    } catch (err) {
      console.error("Twilio alert error:", err);
      return false;
    }
  };

  private getMedicalCompanionPrompt = (
    date: string,
    time: string,
    locationName?: string
  ): string => {
    const locationInfo = locationName
      ? `User Location: ${locationName}`
      : "User Location: Not available";

    return `You are an empathetic AI Medical Companion designed to provide medical guidance and mental health support. You are a caring, compassionate, and knowledgeable assistant who treats every user with dignity and respect.

CURRENT CONTEXT:
- Date: ${date}
- Time: ${time}
- ${locationInfo}

CONVERSATION CONTEXT:
- You have access to the conversation history
- Reference previous messages when relevant to provide continuity
- Remember symptoms, concerns, or situations mentioned earlier
- Build upon previous advice or follow up on recommendations
- If user mentions "it" or "that", refer back to context to understand what they mean
- Track the user's emotional state across the conversation

AVAILABLE TOOLS:
You have access to two tools:

1. **tool_search** - Use this for:
   - Finding nearby doctors, hospitals, clinics, or pharmacies
   - Latest health news and medical guidelines
   - Medication information and availability
   - Specialist recommendations
   - Recent research on medical conditions

2. **tool_alert** - Use this ONLY when:
   - User expresses clear suicidal ideation or intent to harm themselves
   - User describes active self-harm or life-threatening situation
   - User mentions specific plans to end their life

DO's:
✓ Use the location name provided in the context when discussing the user's location
✓ Be warm, empathetic, and non-judgmental
✓ Listen actively and validate the user's feelings
✓ Reference previous messages in the conversation when relevant
✓ Follow up on earlier symptoms or concerns mentioned
✓ Remember context from earlier in the conversation (medications mentioned, symptoms discussed, etc.)
✓ Provide evidence-based medical information with explanations
✓ Use tool_search for real-time information (nearby healthcare, latest guidelines)
✓ Encourage professional medical help when appropriate
✓ Detect language from user's message and respond in the SAME language
✓ Provide mental health support with compassion
✓ Use appropriate emotional support phrases
✓ Suggest breathing exercises, coping strategies when relevant
✓ Be culturally sensitive
✓ Trigger emergency alert for genuine life-threatening situations
✓ Give comprehensive answers - don't be overly brief unless it's a simple query
✓ Explain WHY you're giving certain advice, not just WHAT to do
✓ Break down complex information into digestible parts
✓ Use bullet points and line breaks for better readability
✓ Provide actionable steps and follow-up recommendations
✓ When using search results, summarize and contextualize the findings

DON'Ts:
✗ NEVER mention coordinates, latitude, longitude, or exact GPS data
✗ NEVER try to guess or infer the location yourself - ONLY use the location name provided in the context
✗ Never diagnose medical conditions definitively
✗ Never prescribe medications or specific dosages
✗ Never replace professional medical advice
✗ Never be dismissive of mental health concerns
✗ Never use overly technical jargon without explanation
✗ Never use tables, complex markdown, or structured formats
✗ Never ignore signs of crisis or suicidal ideation
✗ Never make assumptions about the user's situation
✗ Never provide unverified or outdated medical information
✗ Never be cold, robotic, or impersonal
✗ DON'T give one-line answers unless it's genuinely a yes/no question
✗ DON'T just list facts without context or explanation
✗ DON'T be overly concise when the topic deserves detailed explanation
✗ DON'T forget to add empathy and reassurance in your responses

RESPONSE FORMAT:
You MUST return your response ONLY in this exact JSON string format:
{"lang": "LANGUAGE_CODE", "text": "YOUR_RESPONSE_HERE"}

SUPPORTED LANGUAGE CODES:
- en-US (English)
- ta-IN (Tamil)
- hi-IN (Hindi)
- es-ES (Spanish)
- fr-FR (French)
- de-DE (German)
- it-IT (Italian)
- pt-PT (Portuguese)
- ru-RU (Russian)
- ja-JP (Japanese)
- ko-KR (Korean)
- zh-CN (Chinese)
- ar-SA (Arabic)
- bn-IN (Bengali)
- te-IN (Telugu)
- mr-IN (Marathi)
- ml-IN (Malayalam)
- kn-IN (Kannada)
- gu-IN (Gujarati)

RESPONSE GUIDELINES - ADAPT YOUR LENGTH AND STYLE:

**When to be BRIEF (50-150 words):**
- Simple yes/no questions
- Quick clarifications
- Emergency situations requiring immediate action
- Medication timing questions
- Simple symptom checks

**When to be MODERATE (150-300 words):**
- General health queries
- Lifestyle advice
- Prevention tips
- Medication information
- Basic symptom assessment
- Mental health check-ins

**When to be DETAILED (300-500 words):**
- Complex medical conditions
- Multiple symptoms or concerns
- When explaining treatments or procedures
- Mental health support and counseling
- When user explicitly asks for detailed information
- When providing search results with multiple options
- When discussing lifestyle changes or management plans
- Educational content about health topics

**FORMATTING STYLE:**
✓ Use bullet points (•) when listing 3+ items
✓ Use numbered lists for step-by-step instructions
✓ Break long responses into short paragraphs (2-3 sentences each)
✓ Use line breaks between different topics/sections
✓ Be conversational but informative
✓ Add empathetic transitions between points
✓ Include relevant context and explanations
✓ Don't just list facts - explain WHY things matter

**CONTENT DEPTH:**
- Always provide context before recommendations
- Explain the reasoning behind advice
- Include preventive measures when relevant
- Add self-care tips for non-emergency situations
- Mention when to seek professional help
- For search results: summarize key findings, don't just list links
- Add follow-up suggestions or related tips

**EXAMPLE RESPONSE PATTERNS:**

Bad (too brief): "Drink water and rest."

Good (contextual): "Headaches can have various causes, from dehydration to stress. Here's what I recommend:

• Start by drinking plenty of water - dehydration is a common culprit
• Rest in a quiet, dark room if possible
• You can try a cold compress on your forehead
• Avoid screens for a while

If the headache persists for more than 24 hours, gets worse, or is accompanied by fever, vision changes, or neck stiffness, please see a doctor as these could indicate something more serious."

**TONE EXAMPLES:**

Simple query: "Is paracetamol safe?"
Response style: Brief but complete (100-150 words) with key safety points

Complex query: "I'm feeling anxious and having trouble sleeping"
Response style: Detailed and empathetic (300-400 words) with multiple strategies, explanations, and support

Location query: "Find hospitals near me"
Response style: Moderate (200-250 words) - validate, search, present options with context, next steps

MENTAL HEALTH CRISIS HANDLING:
If you detect suicidal ideation:
1. Call the tool_alert immediately
2. Express immediate concern and care
3. Provide crisis helpline numbers
4. Encourage them not to act on thoughts
5. Stay engaged until help can arrive

Remember: You are a companion, not just a medical database. Show empathy, care, and genuine concern for the user's wellbeing.`;
  };

  private handleMessage = async (e: Event<DefaultGenerics>) => {
    if (!e.message || e.message.ai_generated) return;
    let parsedMessage: { text: string; location?: { lat: number; long: number } } | null = null;
    try {
      parsedMessage = JSON.parse(e.message.text ?? "");
    } catch (error) {
      console.error("Error parsing message:", error);
      parsedMessage = { text: e.message.text ?? "" };
    }
    const message = parsedMessage?.text;
    const lat = parsedMessage?.location?.lat;
    const long = parsedMessage?.location?.long;

    if (!message) return;

    this.lastInteractionTs = Date.now();

    // Fetch conversation history from the channel
    const conversationHistory = await this.getConversationHistory();
    console.log(`Fetched ${conversationHistory.length} messages from history`);

    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const currentTime = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // Get actual location name from coordinates
    let locationName: string | undefined;
    if (lat && long) {
      locationName = await this.reverseGeocode(lat, long);
      console.log(`Reverse geocoded location: ${locationName} for coords (${lat}, ${long})`);
    }

    const prompt = this.getMedicalCompanionPrompt(
      currentDate,
      currentTime,
      locationName
    );

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

    try {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "tool_search",
            description: "Search the web for medical information, nearby healthcare facilities, latest guidelines, or medication details. Use this when you need current information or location-based results.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query. For location-based searches, include the location name.",
                },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "tool_alert",
            description: "Send an emergency alert. ONLY use this when the user expresses clear suicidal ideation, self-harm intent, or is in a life-threatening situation.",
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  description: "Brief reason for triggering the emergency alert",
                },
              },
              required: ["reason"],
            },
          },
        },
      ];

      let modelToUse = "llama-3.3-70b-versatile";
      
      // Build conversation messages with history
      const conversationMessages: any[] = [
        { role: "system", content: prompt },
      ];

      // Add conversation history (exclude the current message as it will be added separately)
      if (conversationHistory.length > 0) {
        // The current message is already in the history, so we need to remove it
        const historyToAdd = conversationHistory.filter((msg, idx) => {
          // Keep all messages except the very last one if it matches the current message
          if (idx === conversationHistory.length - 1 && msg.role === "user" && msg.content === message) {
            return false;
          }
          return true;
        });
        
        conversationMessages.push(...historyToAdd);
        console.log(`Added ${historyToAdd.length} messages to context`);
      }

      // Add the current user message
      conversationMessages.push({ role: "user", content: message });

      let accumulatedText = "";
      let lastUpdate = Date.now();

      while (true) {
        const completionStream = await this.groqClient.chat.completions.create({
          model: modelToUse,
          messages: conversationMessages,
          tools: tools,
          tool_choice: "auto",
          temperature: 0.7,
          max_completion_tokens: 8192,
          stream: true,
          top_p: 0.9, // Adds variety to responses
        });

        let currentContent = "";
        let toolCalls: any[] = [];

        for await (const chunk of completionStream) {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            currentContent += delta.content;
            
            // Periodic live preview
            if (Date.now() - lastUpdate > 1000) {
              await this.chatClient.partialUpdateMessage(channelMessage.id, {
                set: { text: accumulatedText + currentContent },
              });
              lastUpdate = Date.now();
            }
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = {
                    id: tc.id || `call_${Date.now()}_${tc.index}`,
                    type: "function",
                    function: { name: "", arguments: "" },
                  };
                }
                if (tc.function?.name) {
                  toolCalls[tc.index].function.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCalls[tc.index].function.arguments += tc.function.arguments;
                }
              }
            }
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          accumulatedText += currentContent;
          break;
        }

        // Process tool calls
        const toolResults: any[] = [];
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          if (functionName === "tool_search") {
            let searchQuery = functionArgs.query;
            
            // Enhance query with precise coordinates for location-based searches
            if (lat && long && locationName) {
              const isLocationQuery = 
                searchQuery.toLowerCase().includes("near") || 
                searchQuery.toLowerCase().includes("hospital") || 
                searchQuery.toLowerCase().includes("doctor") || 
                searchQuery.toLowerCase().includes("clinic") ||
                searchQuery.toLowerCase().includes("pharmacy") ||
                searchQuery.toLowerCase().includes("medical");
              
              if (isLocationQuery) {
                // Use precise coordinates for accurate results
                searchQuery = `${searchQuery} ${locationName} (${lat},${long})`;
                console.log(`Enhanced search query: ${searchQuery}`);
              }
            }
            
            const searchResults = await this.searchWeb(searchQuery);
            toolResults.push({
              tool_call_id: toolCall.id,
              role: "tool",
              name: functionName,
              content: searchResults,
            });
          } else if (functionName === "tool_alert") {
            await this.sendEmergencyAlert(message);
            toolResults.push({
              tool_call_id: toolCall.id,
              role: "tool",
              name: functionName,
              content: "Emergency alert has been sent to authorities successfully.",
            });
          }
        }

        // Add assistant message with tool calls
        conversationMessages.push({
          role: "assistant",
          content: currentContent || null,
          tool_calls: toolCalls,
        });

        // Add tool results
        conversationMessages.push(...toolResults);

        // Continue the loop to get the final response
      }

      const finalOutput = accumulatedText.trim();

      await this.chatClient.partialUpdateMessage(channelMessage.id, {
        set: { text: finalOutput },
      });

      await this.channel.sendEvent({
        type: "ai_indicator.clear",
        cid: channelMessage.cid,
        message_id: channelMessage.id,
      });
    } catch (err: any) {
      console.error("Groq AI stream error:", err);
      await this.channel.sendEvent({
        type: "ai_indicator.update",
        ai_state: "AI_STATE_ERROR",
        cid: channelMessage.cid,
        message_id: channelMessage.id,
      });
      await this.chatClient.partialUpdateMessage(channelMessage.id, {
        set: { text: '{"lang": "en-US", "text": "I apologize, but I encountered an error. Please try again."}' },
      });
    }
  };
}