"use client";

import { useMemo } from "react";
import { DbConnection } from "@/module_bindings";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { MainView } from "@/components/MainView";

export function AppShell() {
  const uri = process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "http://localhost:3000";
  const dbName = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "writing-ritual-01";
  const storage =
    typeof window !== "undefined" && window.localStorage ? window.localStorage : null;

  const connectionBuilder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(dbName)
        .onConnectError((_ctx, err) => {
          console.error("SpacetimeDB connection error:", err);
        })
        .onConnect((conn) => {
          if (typeof conn.token === "string" && storage !== null) {
            window.localStorage.setItem("spacetime-token", conn.token);
          }
        })
        .withToken(
          storage !== null ? storage.getItem("spacetime-token") ?? undefined : undefined
        ),
    [uri, dbName]
  );

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <main className="h-screen flex flex-col overflow-hidden">
        <MainView />
      </main>
    </SpacetimeDBProvider>
  );
}
