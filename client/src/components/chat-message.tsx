import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bot, Check, Copy, Volume2, VolumeX } from "lucide-react";
import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  useAIState,
  useChannelStateContext,
  useMessageContext,
  useMessageTextStreaming,
} from "stream-chat-react";
import { franc } from "franc";

// Language mapping from ISO 639-3 to browser TTS codes
const LANGUAGE_MAP: Record<string, string> = {
  eng: "en-US",
  tam: "ta-IN",
  hin: "hi-IN",
  spa: "es-ES",
  fra: "fr-FR",
  deu: "de-DE",
  ita: "it-IT",
  por: "pt-PT",
  rus: "ru-RU",
  jpn: "ja-JP",
  kor: "ko-KR",
  cmn: "zh-CN",
  ara: "ar-SA",
  ben: "bn-IN",
  tel: "te-IN",
  mar: "mr-IN",
  mal: "ml-IN",
  kan: "kn-IN",
  guj: "gu-IN",
};

interface ChatMessageProps {
  canAutoSpeak?: boolean;
}

// Extract text from potentially incomplete JSON during streaming
const extractTextFromStreamingJSON = (rawText: string): { text: string; lang: string | null; isComplete: boolean } => {
  if (!rawText) return { text: "", lang: null, isComplete: false };

  try {
    const parsed = JSON.parse(rawText);
    if (parsed.text !== undefined) {
      return {
        text: parsed.text,
        lang: parsed.lang || null,
        isComplete: true,
      };
    }
  } catch (e) {
    // JSON is incomplete or invalid, try to extract text field manually
  }

  const textMatch = rawText.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const langMatch = rawText.match(/"lang"\s*:\s*"([^"]*)"/);

  if (textMatch) {
    const extractedText = textMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");

    return {
      text: extractedText,
      lang: langMatch ? langMatch[1] : null,
      isComplete: false,
    };
  }

  if (rawText.trim().startsWith("{")) {
    return { text: "", lang: null, isComplete: false };
  }

  return { text: rawText, lang: null, isComplete: true };
};

// Fallback language detection using franc
const detectLanguageFallback = (text: string): string => {
  const cleanText = text
    .replace(/[#*`~_\[\](){}]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  if (cleanText.length < 10) {
    return "en-US";
  }

  try {
    const detectedCode = franc(cleanText, { minLength: 10 });
    
    if (detectedCode === "und") {
      return "en-US";
    }

    return LANGUAGE_MAP[detectedCode] || "en-US";
  } catch (error) {
    console.warn("Language detection failed:", error);
    return "en-US";
  }
};

const ChatMessage: React.FC<ChatMessageProps> = ({ canAutoSpeak = false }) => {
  const { message } = useMessageContext();
  const { channel } = useChannelStateContext();
  const { aiState } = useAIState(channel);

  const { streamedMessageText } = useMessageTextStreaming({
    text: message.text ?? "",
    renderingLetterCount: 10,
    streamingLetterIntervalMs: 50,
  });

  const isUser = !message.user?.id?.startsWith("ai-bot");
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const componentMounted = useRef(true);
  const messageIdRef = useRef(message.id);
  const hasAutoSpokenForThisMessage = useRef(false);
  const streamingCompleteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamedLengthRef = useRef(0);

  // Extract and parse message content from streaming or complete text
  const messageContent = useMemo(() => {
    const rawText = streamedMessageText || message.text || "";
    
    if (!rawText) {
      return { displayText: "", language: "en-US", isComplete: false };
    }

    const extracted = extractTextFromStreamingJSON(rawText);
    
    let language = "en-US";
    if (extracted.lang) {
      const langCode = extracted.lang.toLowerCase();
      if (langCode.includes("-")) {
        language = extracted.lang;
      } else {
        language = LANGUAGE_MAP[langCode] || extracted.lang;
      }
    } else if (extracted.text) {
      language = detectLanguageFallback(extracted.text);
    }
    
    return {
      displayText: extracted.text,
      language: language,
      isComplete: extracted.isComplete,
    };
  }, [streamedMessageText, message.text]);

  // Stop any ongoing speech
  const stopSpeech = () => {
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      
      utteranceRef.current = null;
      
      if (componentMounted.current) {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("Error stopping speech:", error);
    }
  };

  // Clean text for speech (remove markdown formatting)
  const cleanTextForSpeech = (text: string): string => {
    return text
      .replace(/#{1,6}\s/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`{1,3}(.*?)`{1,3}/g, "$1")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/>/g, "")
      .replace(/\n+/g, " ")
      .trim();
  };

  // Get available voices for a language with preference for quality voices
  const getVoiceForLanguage = (language: string): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    
    if (voices.length === 0) {
      return null;
    }

    const langPrefix = language.split("-")[0].toLowerCase();
    
    // For Indian languages, prefer Google, Microsoft, or native voices
    if (['hi', 'ta', 'te', 'bn', 'mr', 'ml', 'kn', 'gu'].includes(langPrefix)) {
      // Try Google voices first
      const googleVoice = voices.find(v => 
        v.lang.toLowerCase().startsWith(langPrefix) && 
        v.name.toLowerCase().includes('google')
      );
      if (googleVoice) return googleVoice;
      
      // Try Microsoft voices
      const microsoftVoice = voices.find(v => 
        v.lang.toLowerCase().startsWith(langPrefix) && 
        v.name.toLowerCase().includes('microsoft')
      );
      if (microsoftVoice) return microsoftVoice;
      
      // Try any female/male voice
      const namedVoice = voices.find(v => 
        v.lang.toLowerCase().startsWith(langPrefix) && 
        (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('male'))
      );
      if (namedVoice) return namedVoice;
    }
    
    // Try exact language match
    let voice = voices.find(v => v.lang.toLowerCase() === language.toLowerCase());
    if (voice) return voice;
    
    // Try language prefix match
    voice = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));
    if (voice) return voice;
    
    // Try any voice containing the language prefix
    voice = voices.find(v => v.lang.toLowerCase().includes(langPrefix));
    
    return voice || null;
  };

  // Text-to-speech function with robust error handling
  const speakText = (text: string, language: string, isAutoPlay: boolean = false) => {
    if (!text || !componentMounted.current) return;

    stopSpeech();

    setTimeout(() => {
      if (!componentMounted.current) return;

      const cleanText = cleanTextForSpeech(text);
      if (!cleanText || cleanText.length < 3) return;

      try {
        // Ensure voices are loaded
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0 && !voicesLoaded) {
          console.warn("Voices not loaded yet, retrying in 200ms...");
          setTimeout(() => speakText(text, language, isAutoPlay), 200);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = language;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const matchingVoice = getVoiceForLanguage(language);
        
        if (matchingVoice) {
          utterance.voice = matchingVoice;
          console.log(`🔊 Using voice: ${matchingVoice.name} (${matchingVoice.lang}) for language: ${language}`);
        } else {
          console.warn(`⚠️ No specific voice found for ${language}, using browser default`);
        }

        utterance.onstart = () => {
          if (componentMounted.current) {
            setIsSpeaking(true);
            console.log("✅ Speech started successfully");
          }
        };

        utterance.onend = () => {
          if (componentMounted.current) {
            setIsSpeaking(false);
            utteranceRef.current = null;
            console.log("✅ Speech ended");
          }
        };

        utterance.onerror = (event) => {
          console.error("❌ Speech synthesis error:", event.error, event);
          
          if (componentMounted.current) {
            setIsSpeaking(false);
            utteranceRef.current = null;
          }
          
          // Retry with fallback for specific errors
          if (event.error === 'synthesis-failed' || event.error === 'voice-unavailable') {
            console.log("🔄 Retrying with default voice...");
            setTimeout(() => {
              if (!componentMounted.current) return;
              
              const fallbackUtterance = new SpeechSynthesisUtterance(cleanText);
              fallbackUtterance.lang = language;
              fallbackUtterance.rate = 0.95;
              fallbackUtterance.pitch = 1.0;
              fallbackUtterance.volume = 1.0;
              
              window.speechSynthesis.speak(fallbackUtterance);
            }, 250);
          }
        };

        utteranceRef.current = utterance;
        
        // Ensure clean state before speaking
        window.speechSynthesis.cancel();
        setTimeout(() => {
          if (componentMounted.current) {
            window.speechSynthesis.speak(utterance);
          }
        }, 100);
      } catch (error) {
        console.error("❌ Error creating speech utterance:", error);
        if (componentMounted.current) {
          setIsSpeaking(false);
        }
      }
    }, 150);
  };

  // Detect when streaming is complete and trigger auto-speak
  useEffect(() => {
    if (!isUser && streamedMessageText && canAutoSpeak) {
      const currentLength = streamedMessageText.length;
      
      if (streamingCompleteTimerRef.current) {
        clearTimeout(streamingCompleteTimerRef.current);
      }

      if (currentLength === lastStreamedLengthRef.current && currentLength > 0) {
        return;
      }

      lastStreamedLengthRef.current = currentLength;

      streamingCompleteTimerRef.current = setTimeout(() => {
        const finalLength = streamedMessageText.length;
        
        if (finalLength === lastStreamedLengthRef.current && finalLength > 0) {
          if (
            canAutoSpeak &&
            !hasAutoSpokenForThisMessage.current &&
            messageContent.displayText &&
            messageContent.displayText.trim().length > 10 &&
            componentMounted.current &&
            voicesLoaded
          ) {
            console.log("🎙️ Auto-speak triggered for message:", message.id);
            console.log("📝 Text length:", messageContent.displayText.length);
            console.log("🌐 Detected language:", messageContent.language);
            
            hasAutoSpokenForThisMessage.current = true;
            
            setTimeout(() => {
              if (componentMounted.current && canAutoSpeak && messageContent.displayText) {
                speakText(messageContent.displayText, messageContent.language, true);
              }
            }, 200);
          }
        }
      }, 400);
    }

    return () => {
      if (streamingCompleteTimerRef.current) {
        clearTimeout(streamingCompleteTimerRef.current);
      }
    };
  }, [streamedMessageText, isUser, canAutoSpeak, messageContent, message.id, voicesLoaded]);

  // Reset state when message changes
  useEffect(() => {
    if (messageIdRef.current !== message.id) {
      console.log("🔄 New message detected, resetting state");
      messageIdRef.current = message.id;
      hasAutoSpokenForThisMessage.current = false;
      lastStreamedLengthRef.current = 0;
      stopSpeech();
      
      if (streamingCompleteTimerRef.current) {
        clearTimeout(streamingCompleteTimerRef.current);
      }
    }
  }, [message.id]);

  // Reset state when canAutoSpeak changes to false
  useEffect(() => {
    if (!canAutoSpeak) {
      console.log("🔇 Auto-speak disabled, stopping speech");
      stopSpeech();
      hasAutoSpokenForThisMessage.current = false;
    } else {
      console.log("🔊 Auto-speak enabled");
    }
  }, [canAutoSpeak]);

  // Cleanup on unmount
  useEffect(() => {
    componentMounted.current = true;
    
    return () => {
      componentMounted.current = false;
      stopSpeech();
      if (streamingCompleteTimerRef.current) {
        clearTimeout(streamingCompleteTimerRef.current);
      }
    };
  }, []);

  // Ensure voices are loaded with robust initialization
  useEffect(() => {
    if (!window.speechSynthesis) {
      console.error("❌ Speech Synthesis not supported in this browser");
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setVoicesLoaded(true);
        console.log(`✅ Loaded ${voices.length} voices:`);
        
        // Log available voices for debugging
        const voicesByLang: Record<string, string[]> = {};
        voices.forEach(v => {
          const lang = v.lang.split('-')[0];
          if (!voicesByLang[lang]) voicesByLang[lang] = [];
          voicesByLang[lang].push(`${v.name} (${v.lang})`);
        });
        
        console.log("Available voices by language:", voicesByLang);
      }
    };
    
    // Initial load attempt
    loadVoices();
    
    // Handle async voice loading
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    // Force voice loading with dummy utterance (helps on some browsers)
    setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        console.log("🔄 Forcing voice load with dummy utterance...");
        const dummyUtterance = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(dummyUtterance);
        window.speechSynthesis.cancel();
        
        setTimeout(loadVoices, 150);
      }
    }, 100);

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const copyToClipboard = async () => {
    if (messageContent.displayText) {
      await navigator.clipboard.writeText(messageContent.displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSpeakClick = () => {
    if (isSpeaking) {
      stopSpeech();
    } else {
      if (messageContent.displayText) {
        speakText(messageContent.displayText, messageContent.language, false);
      }
    }
  };

  const getAiStateMessage = () => {
    switch (aiState) {
      case "AI_STATE_THINKING":
        return "Thinking...";
      case "AI_STATE_GENERATING":
        return "Generating response...";
      case "AI_STATE_EXTERNAL_SOURCES":
        return "Accessing external sources...";
      case "AI_STATE_ERROR":
        return "An error occurred.";
      default:
        return null;
    }
  };

  const formatTime = (timestamp: string | Date) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      className={cn(
        "flex w-full mb-4 px-4 group",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex max-w-[70%] sm:max-w-[60%] lg:max-w-[50%]",
          isUser ? "flex-row-reverse" : "flex-row"
        )}
      >
        {!isUser && (
          <div className="flex-shrink-0 mr-3 self-end">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          </div>
        )}

        <div className="flex flex-col space-y-1">
          <div
            className={cn(
              "px-4 py-3 rounded-2xl text-sm leading-relaxed transition-all duration-200",
              isUser
                ? "str-chat__message-bubble str-chat__message-bubble--me rounded-br-md"
                : "str-chat__message-bubble rounded-bl-md"
            )}
          >
            <div className="break-words">
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
                  ),
                  code: ({ children, ...props }) => {
                    const { node, ...rest } = props;
                    const isInline = !rest.className?.includes("language-");

                    return isInline ? (
                      <code
                        className="px-1.5 py-0.5 rounded text-xs font-mono bg-black/10 dark:bg-white/10"
                        {...rest}
                      >
                        {children}
                      </code>
                    ) : (
                      <pre className="p-3 rounded-md overflow-x-auto my-2 text-xs font-mono bg-black/5 dark:bg-white/5">
                        <code {...rest}>{children}</code>
                      </pre>
                    );
                  },
                  ul: ({ children }) => (
                    <ul className="list-disc ml-4 mb-3 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal ml-4 mb-3 space-y-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">{children}</li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-3 pl-3 my-2 italic border-current/30">
                      {children}
                    </blockquote>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-lg font-semibold mb-2 mt-4 first:mt-0">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-semibold mb-2 mt-3 first:mt-0">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold mb-2 mt-3 first:mt-0">
                      {children}
                    </h3>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold">{children}</strong>
                  ),
                  em: ({ children }) => <em className="italic">{children}</em>,
                }}
              >
                {messageContent.displayText || ""}
              </ReactMarkdown>
            </div>

            {aiState && !messageContent.displayText && (
              <div className="flex items-center gap-2 mt-2 pt-2">
                <span className="text-xs opacity-70">
                  {getAiStateMessage()}
                </span>
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-current rounded-full typing-dot opacity-70"></div>
                  <div className="w-1 h-1 bg-current rounded-full typing-dot opacity-70"></div>
                  <div className="w-1 h-1 bg-current rounded-full typing-dot opacity-70"></div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground/70">
              {formatTime(message.created_at || new Date())}
            </span>

            {!isUser && !!messageContent.displayText && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSpeakClick}
                  className="h-6 px-2 text-xs hover:bg-muted rounded-md"
                  title={isSpeaking ? "Stop speaking" : "Read aloud"}
                >
                  {isSpeaking ? (
                    <>
                      <VolumeX className="h-3 w-3 mr-1 text-orange-600" />
                      <span className="text-orange-600">Stop</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3 w-3 mr-1" />
                      <span>Speak</span>
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToClipboard}
                  className="h-6 px-2 text-xs hover:bg-muted rounded-md"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-green-600" />
                      <span className="text-green-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      <span>Copy</span>
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;