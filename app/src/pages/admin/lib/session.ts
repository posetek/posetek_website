// The admin session the `/admin/*` routes render from.
//
// This is UI routing, not security: the guard decides which screen to draw, and
// the Firestore/Storage rules decide what the browser may actually read and
// write (ADMIN_IDENTITY_CONTRACT.md §2.2). An `/admin` route guarded only in
// React would not be a boundary at all.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { auth } from "../../../lib/firebase";
import { refreshAdminIdentity, upsertAdminProfile } from "./identity";
import type { AdminIdentity } from "./identity";

export type AdminSession =
  | { kind: "checking" }
  | { kind: "signedOut" }
  | { kind: "unverified"; email: string }
  | { kind: "notAdmin"; email: string }
  | { kind: "ready"; identity: AdminIdentity };

export function useAdminSession(): AdminSession {
  const [session, setSession] = useState<AdminSession>({ kind: "checking" });

  useEffect(() => {
    let live = true;
    let epoch = 0;
    const unsubscribe = auth.onAuthStateChanged(async (user: any) => {
      const requestEpoch = ++epoch;
      if (!user) {
        if (live) setSession({ kind: "signedOut" });
        return;
      }
      setSession({ kind: "checking" });
      const identity = await refreshAdminIdentity(user);
      if (!live || epoch !== requestEpoch || auth.currentUser?.uid !== user.uid) return;
      if (identity.isAdmin) {
        setSession({ kind: "ready", identity });
        void upsertAdminProfile(identity);
      } else if (identity.adminDomain) {
        setSession({ kind: "unverified", email: identity.email });
      } else {
        setSession({ kind: "notAdmin", email: identity.email });
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return session;
}
