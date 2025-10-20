import React, { useState } from "react";
import { Bot } from "lucide-react";
import { signInWithPopup } from "firebase/auth";
import { auth, provider } from "@/lib/firebase";
import { User } from "stream-chat";
import { Button } from "./ui/button";
import { sha256 } from "js-sha256";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

interface LoginProps {
  onLogin: (user: User) => void;
}

// Function to create deterministic user ID using SHA-256
const createUserIdFromEmail = (email: string) => {
  const hash = sha256(email.toLowerCase().trim());
  return `user_${hash.substring(0, 12)}`; // first 12 chars for readability
};

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const chatUser: User = {
        id: createUserIdFromEmail(user.email || user.uid),
        name: user.displayName || user.email || "Google User",
        image: user.photoURL || undefined,
      };

      onLogin(chatUser);
    } catch (error) {
      console.error("Google login failed:", error);
      alert("Google login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-2">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mx-auto">
            <Bot className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl font-semibold">
            Welcome to Medical AI Assistant
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Sign in with your Google account to start chatting.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 h-10"
          >
            {loading ? (
              "Signing in..."
            ) : (
              <>
                <img
                  src="https://developers.google.com/identity/images/g-logo.png"
                  alt="Google"
                  className="w-5 h-5"
                />
                Sign in with Google
              </>
            )}
          </Button>
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground">
          Secure sign-in powered by Google OAuth 2.0
        </CardFooter>
      </Card>
    </div>
  );
};
