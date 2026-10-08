"use client";

import { useEffect, useState } from "react";

// the signed-in role, "" until it loads or if the call fails
export function useRole(): string {
  const [role, setRole] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setRole(d?.user?.role ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return role;
}
