import type { ReactElement } from "react";
import type { SocialActivity } from "./contracts";

export interface ActivityCardProps {
  activity: SocialActivity;
  organizationId?: string;
  preview: boolean;
  onChange(activity: SocialActivity): void;
  onPerson(playerId: string): void;
}

/** /feed and /feed.html share this page. ?preview=1 uses sample data only. */
export default function FeedPage(props?: { embedded?: boolean; organizationId?: string; onNavigatePlayer?: (playerId: string) => void }): ReactElement;
export function ActivityCard(props: ActivityCardProps): ReactElement;
