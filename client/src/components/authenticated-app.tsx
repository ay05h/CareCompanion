import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Channel, ChannelFilters, ChannelSort, User } from "stream-chat";
import { useChatContext } from "stream-chat-react";
import { v4 as uuidv4 } from "uuid";
import { ChatProvider } from "../providers/chat-provider";
import { ChatInterface } from "./chat-interface";
import { ChatSidebar } from "./chat-sidebar";

interface AuthenticatedAppProps {
  user: User;
  onLogout: () => void;
}

export const AuthenticatedApp = ({ user, onLogout }: AuthenticatedAppProps) => (
  <ChatProvider user={user}>
    <AuthenticatedCore user={user} onLogout={onLogout} />
  </ChatProvider>
);

const AuthenticatedCore = ({ user, onLogout }: AuthenticatedAppProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const { client, setActiveChannel } = useChatContext();
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId: string }>();
  const backendUrl = import.meta.env.VITE_BACKEND_URL as string;

  useEffect(() => {
    const syncChannelWithUrl = async () => {
      if (!client) return;

      if (channelId) {
        const channel = client.channel("messaging", channelId);
        await channel.watch();
        setActiveChannel(channel);
      } else {
        setActiveChannel(undefined);
      }
    };
    syncChannelWithUrl();
  }, [channelId, client, setActiveChannel]);

  const handleNewChatMessage = async (message: { text: string }) => {
    if (!user.id) return;

    try {
      // Extract the actual text from the JSON message
      let channelName = "New Writing Session";
      try {
        const parsed = JSON.parse(message.text);
        channelName = parsed.text?.substring(0, 50) || "New Writing Session";
      } catch {
        // If it's not JSON, use the text as-is
        channelName = message.text.substring(0, 50);
      }

      // 1. Create a new channel with the user as the only member
      const newChannel = client.channel("messaging", uuidv4(), {
        name: channelName,
        members: [user.id],
        // Optionally add a custom field to specify the medical consultation type
        // custom: { type: "medical_consultation" },
      });
      await newChannel.watch();

      // 2. Set up event listener for when AI agent is added as member
      const memberAddedPromise = new Promise<void>((resolve) => {
        const unsubscribe = newChannel.on("member.added", (event) => {
          // Check if the added member is the AI agent (not the current user)
          if (event.member?.user?.id && event.member.user.id !== user.id) {
            unsubscribe.unsubscribe();
            resolve();
          }
        });
      });

      // 3. Connect the AI agent
      const response = await fetch(`${backendUrl}/start-ai-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: newChannel.id,
          channel_type: "messaging",
        }),
      });

      if (!response.ok) {
        throw new Error("AI agent failed to join the chat.");
      }

      // 4. Set the channel as active and navigate
      setActiveChannel(newChannel);
      navigate(`/chat/${newChannel.id}`);

      // 5. Wait for AI agent to be added as member, then send message
      await memberAddedPromise;
      await newChannel.sendMessage(message);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong";
      console.error("Error creating new medical consultation:", errorMessage);
    }
  };

  const handleNewChatClick = () => {
    setActiveChannel(undefined);
    navigate("/");
    setSidebarOpen(false);
  };

  const handleDeleteClick = (channel: Channel) => {
    setChannelToDelete(channel);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (channelToDelete) {
      try {
        if (channelId === channelToDelete.id) {
          navigate("/");
        }
        await channelToDelete.delete();
      } catch (error) {
        console.error("Error deleting medical consultation:", error);
      }
    }
    setShowDeleteDialog(false);
    setChannelToDelete(null);
  };

  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setChannelToDelete(null);
  };

  if (!client) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Connecting to chat...</p>
      </div>
    );
  }

  const filters: ChannelFilters = {
    type: "messaging",
    members: { $in: [user.id] },
  };
  const sort: ChannelSort = { last_message_at: -1 };
  const options = { state: true, presence: true, limit: 10 };

  return (
    <div className="flex h-full w-full">
      <ChatSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={onLogout}
        onNewChat={handleNewChatClick}
        onChannelDelete={handleDeleteClick}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <ChatInterface
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onNewChatMessage={handleNewChatMessage}
          backendUrl={backendUrl}
        />
      </div>

      {/* Delete Medical Consultation Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Medical Consultation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this medical consultation? This action
              cannot be undone and all data will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Delete Consultation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};