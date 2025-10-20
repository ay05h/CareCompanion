import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ArrowRight, Square, X, Mic, MicOff, Bot, Hand } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MedicalPromptsToolbar } from "./writing-prompts-toolbar";

export interface ChatInputProps {
  className?: string;
  sendMessage: (message: {
    text: string;
  }) => Promise<void> | void;
  isGenerating?: boolean;
  onStopGenerating?: () => void;
  placeholder?: string;
  value: string;
  onValueChange: (text: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  showPromptToolbar?: boolean;
  canAutoSpeak?: boolean;
  setCanAutoSpeak?: (value: boolean) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  className,
  sendMessage,
  isGenerating,
  onStopGenerating,
  placeholder = "Describe symptoms, patient history, or clinical questions...",
  value,
  onValueChange,
  textareaRef: externalTextareaRef,
  showPromptToolbar = false,
  canAutoSpeak = false,
  setCanAutoSpeak,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<{ lat: number; long: number } | null>(null);
  const [isListening, setIsListening] = useState(true);
  const [isSupported, setIsSupported] = useState(true);
  const [isVoiceBotActive, setIsVoiceBotActive] = useState(false);
  const [isSignLanguageOpen, setIsSignLanguageOpen] = useState(false);
  
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const recognitionRef = useRef<any>(null);
  const lastCommandTimeRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Function to speak text
  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      // Small delay to ensure cancellation completes
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';
        
        utterance.onstart = () => {
          console.log("Speech started:", text);
        };
        
        utterance.onerror = (event) => {
          console.error("Speech error:", event);
        };
        
        utterance.onend = () => {
          console.log("Speech ended");
        };
        
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      }, 100);
    } else {
      console.warn("Speech synthesis not supported");
    }
  }, []);

  // Fetch and cache location when component mounts
  useEffect(() => {
    const fetchLocation = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocation({ lat: pos.coords.latitude, long: pos.coords.longitude });
          },
          (err) => console.error("Location error:", err),
          { enableHighAccuracy: true }
        );
      }
    };

    fetchLocation();
    const interval = setInterval(fetchLocation, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle voice commands
  const handleVoiceCommand = useCallback(async (transcript: string) => {
    const lowerTranscript = transcript.toLowerCase().trim();

    // Check for "cancel" command to end voice bot session
    if (isVoiceBotActive && (lowerTranscript === "cancel" || lowerTranscript.endsWith(" cancel"))) {
      setIsVoiceBotActive(false);
      return;
    }

    // Check for "health assistant" command to start voice bot session
    if (!isVoiceBotActive && lowerTranscript.startsWith("health assistant")) {
      setIsVoiceBotActive(true);
      const query = transcript.substring("health assistant".length).trim();
      if (query) {
        const cleanQuery = query.replace(/^[,.:;]\s*/, "");
        if (cleanQuery) {
          // Send immediately when starting with a query
          setIsLoading(true);
          try {
            const payload = {text: cleanQuery, location : location || undefined};
            await sendMessage({
              text: JSON.stringify(payload),
            });
          } catch (error) {
            console.error("Error sending message:", error);
          } finally {
            setIsLoading(false);
          }
        }
      }
      return;
    }

    // If voice bot is active, send queries directly
    if (isVoiceBotActive && transcript.trim()) {
      setIsLoading(true);
      try {
        const payload = {text: transcript.trim(), location : location || undefined};
        await sendMessage({
          text: JSON.stringify(payload),
        });
      } catch (error) {
        console.error("Error sending message:", error);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Old behavior: populate text field with "send" command
    if (!isVoiceBotActive) {
      if (lowerTranscript === "send" || lowerTranscript.endsWith(" send")) {
        if (value.trim()) {
          setIsLoading(true);
          try {
            const payload = {text: value.trim(), location : location || undefined};
            await sendMessage({
              text: JSON.stringify(payload),
            });
            onValueChange("");
            if (textareaRef.current) textareaRef.current.style.height = "auto";
          } catch (error) {
            console.error("Error sending message:", error);
          } finally {
            setIsLoading(false);
          }
        }
      }
    }
  }, [value, location, onValueChange, sendMessage, textareaRef, isVoiceBotActive]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    // @ts-ignore - Web Speech API types
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognitionAPI) {
      console.warn("Speech recognition not supported");
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        }
      }

      if (finalTranscript) {
        handleVoiceCommand(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("Speech recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current && isListening) {
        try {
          recognitionRef.current.start();
        } catch (err) {
          // Already started, ignore
        }
      }
    };

    recognitionRef.current = recognition;

    if (isListening) {
      try {
        recognition.start();
      } catch (err) {
        console.error("Error starting recognition:", err);
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isListening, handleVoiceCommand]);

  // Toggle listening state
  const toggleListening = () => {
    setIsListening((prev) => {
      const newState = !prev;
      
      if (recognitionRef.current) {
        try {
          if (newState) {
            recognitionRef.current.start();
          } else {
            recognitionRef.current.stop();
            setIsVoiceBotActive(false);
          }
        } catch (err) {
          // Already started/stopped, ignore
        }
      }
      
      return newState;
    });
  };

  // Start voice bot session
  const startVoiceBot = () => {
    if (!isListening) {
      toggleListening();
    }
    setIsVoiceBotActive(true);
    
    if (setCanAutoSpeak) {
      setCanAutoSpeak(true);
    }
    
    setTimeout(() => {
      speak("Hello there, how can I help you today?");
    }, 300);
  };

  // Cancel voice bot session
  const cancelVoiceBot = () => {
    setIsVoiceBotActive(false);
    
    if (setCanAutoSpeak) {
      setCanAutoSpeak(false);
    }
    
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handlePromptSelect = (prompt: string) => {
    onValueChange(value ? `${value.trim()} ${prompt}` : prompt);
    textareaRef.current?.focus();
  };

  const updateTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 120;
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [textareaRef]);

  useEffect(() => {
    updateTextareaHeight();
  }, [value, updateTextareaHeight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading || isGenerating || !sendMessage) return;

    setIsLoading(true);
    try {
      const payload = {text: value.trim(), location : location || undefined}; 
      await sendMessage({
        text: JSON.stringify(payload),
      });
      console.log(location)
      onValueChange("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSignLanguageOpen) {
        setIsSignLanguageOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isSignLanguageOpen]);

  return (
    <>
      <div className={cn("flex flex-col bg-background", showPromptToolbar && "border-t border-border/50")}>
        {showPromptToolbar && <MedicalPromptsToolbar onPromptSelect={handlePromptSelect} />}
        <div className={cn("p-4", className)}>
          <div onSubmit={handleSubmit}>
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={isVoiceBotActive ? "" : value}
                onChange={(e) => !isVoiceBotActive && onValueChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isVoiceBotActive ? "🎤 Voice bot is listening..." : placeholder}
                className={cn(
                  "min-h-[44px] max-h-[120px] resize-none py-3 pl-4 pr-28 text-sm",
                  "border-input focus:border-primary/50 rounded-lg",
                  "transition-all duration-200 bg-background",
                  isVoiceBotActive && "bg-primary/5 border-primary/50 cursor-not-allowed animate-pulse"
                )}
                disabled={isLoading || isGenerating || isVoiceBotActive}
                readOnly={isVoiceBotActive}
              />

              {value.trim() && !isLoading && !isGenerating && !isVoiceBotActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onValueChange("")}
                  className="absolute right-32 bottom-2 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                  title="Clear text"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}

              {isSupported && (
                <>
                  <Button
                    type="button"
                    onClick={toggleListening}
                    className={cn(
                      "absolute right-20 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0",
                      "transition-all duration-200",
                      isListening 
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground" 
                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                    )}
                    variant={isListening ? "default" : "ghost"}
                    title={isListening ? "Stop listening" : "Start listening"}
                    disabled={isVoiceBotActive}
                  >
                    {isListening ? (
                      <Mic className="h-4 w-4" />
                    ) : (
                      <MicOff className="h-4 w-4" />
                    )}
                  </Button>

                  {!isVoiceBotActive ? (
                    <Button
                      type="button"
                      onClick={startVoiceBot}
                      className={cn(
                        "absolute right-11 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0",
                        "transition-all duration-200",
                        "bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70",
                        "text-primary-foreground shadow-md"
                      )}
                      variant="default"
                      title="Start voice bot"
                    >
                      <Bot className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={cancelVoiceBot}
                      className={cn(
                        "absolute right-11 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0",
                        "transition-all duration-200",
                        "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      )}
                      variant="destructive"
                      title="Cancel voice bot"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
              
              {isGenerating ? (
                <Button
                  type="button"
                  onClick={onStopGenerating}
                  className="absolute right-2 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0"
                  variant="destructive"
                  title="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!value.trim() || isLoading || isGenerating || isVoiceBotActive}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSubmit(e);
                  }}
                  className={cn(
                    "absolute right-2 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0",
                    "transition-all duration-200",
                    "disabled:opacity-30 disabled:cursor-not-allowed",
                    !value.trim() ? "bg-muted hover:bg-muted" : ""
                  )}
                  variant={value.trim() ? "default" : "ghost"}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                onClick={() => setIsSignLanguageOpen(true)}
                className={cn(
                  "absolute right-32 bottom-2 h-8 w-8 rounded-md flex-shrink-0 p-0",
                  "transition-all duration-200",
                  "bg-purple-600 hover:bg-purple-700 text-white"
                )}
                variant="default"
                title="Open Sign language Chat"
              >
                <Hand className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {isSupported && isListening && !isVoiceBotActive && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>Listening... Say "health assistant" to start voice bot, or "send" to submit</span>
            </div>
          )}

          {isSupported && isVoiceBotActive && (
            <div className="mt-2 flex items-center gap-2 text-xs text-primary font-medium">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>🤖 Voice bot active - Speak your query or say "cancel" to stop</span>
            </div>
          )}
        </div>
      </div>

      {/* Sign Language Modal */}
      {isSignLanguageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop with blur */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={() => setIsSignLanguageOpen(false)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-[95vw] h-[90vh] max-w-7xl bg-background rounded-lg shadow-2xl overflow-hidden border border-border">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-600 rounded-lg">
                  <Hand className="h-5 w-5 text-white" />
                </div>
                <h2 className="text-lg font-semibold">Sign Language Chat</h2>
              </div>
              <Button
                onClick={() => setIsSignLanguageOpen(false)}
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive"
                title="Close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            {/* Iframe */}
            <iframe
              src="http://localhost:4200"
              className="w-full h-[calc(100%-64px)] border-0"
              title="Sign Language Chat"
              allow="camera; microphone"
            />
          </div>
        </div>
      )}
    </>
  );
};