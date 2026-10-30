// Shared markup helpers ported from athlete-mobile-pages.js (pageHeader,
// loading, empty, requireAccount) plus the context the mobile views consume.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Fragment } from "react";
import type { Access } from "../lib/loaders";
import type { ReviewedResult } from "../../../lib/reviewed-results";
import type { ProvisionalEstimate } from "../../../lib/provisional-estimates";

export interface PortalContext {
  access: Access;
  playerId: string | null;
  athlete: any;
  notify: (text: string) => void;
  allStatsReps: () => any[];
  provisionalEstimates?: ProvisionalEstimate[];
  reviewedResults?: ReviewedResult[];
  allResultReps?: () => any[];
}

export function PageHero({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: string }) {
  return (
    <header className="mobile-page-hero">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <span className="hero-icon"><span className="material-symbols-outlined">{icon}</span></span>
    </header>
  );
}

export function PortalLoading({ message }: { message: string }) {
  return (
    <div className="portal-loading">
      <span className="spinner" />
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="mobile-empty">
      <span className="material-symbols-outlined">{icon}</span>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

// requireAccount() — the locked page shown to shared-link visitors.
export function LockedPage({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="mobile-page">
      <PageHero eyebrow="Private athlete feature" title={title} description={copy} icon="lock" />
      <section className="portal-card">
        <EmptyState
          icon="shield_lock"
          title="Sign-in protected"
          message="For athlete privacy, this page is only available to the athlete or their connected coach. The shared results link continues to include Athlete Home and Drill Results."
        />
      </section>
    </section>
  );
}

// Legacy rendered `escape(text).replace(/\n/g, "<br>")` — same output as JSX.
export function MultilineText({ text }: { text: string }) {
  const lines = String(text ?? "").split("\n");
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}
