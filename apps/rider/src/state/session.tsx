import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { setAuthToken, setUnauthorizedHandler } from "../api/client";
import type { Session } from "../api/types";

/**
 * The signed-in session (phone + OTP token), persisted in the device keychain via expo-secure-store so it
 * survives app restarts and never touches plain storage. The API client reads the token through
 * setAuthToken; a 401 anywhere clears the session and drops the user back to sign-in.
 */
const KEY = "tunakula.session";

interface SessionContextValue {
  session: Session | null;
  ready: boolean;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (active && raw) {
          const parsed = JSON.parse(raw) as Session;
          setSession(parsed);
          setAuthToken(parsed.token);
        }
      } catch {
        // corrupt/unavailable keychain — start signed out
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      ready,
      async signIn(s) {
        setSession(s);
        setAuthToken(s.token);
        try {
          await SecureStore.setItemAsync(KEY, JSON.stringify(s));
        } catch {
          // keychain write failed — the in-memory session still works for this run
        }
      },
      async signOut() {
        setSession(null);
        setAuthToken(null);
        try {
          await SecureStore.deleteItemAsync(KEY);
        } catch {
          // ignore
        }
      },
    }),
    [session, ready],
  );

  // Wire the API client's 401 handler to this provider once.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null);
      setAuthToken(null);
      void SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    });
  }, []);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
