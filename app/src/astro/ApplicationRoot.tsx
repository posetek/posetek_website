import { StrictMode } from "react";
import App from "../App";
import { captureStaffAccessLink } from "../lib/account-access";
import { capturePlayerInvitationLink } from "../pages/landing/player-invitation-link";
import "../styles/base.css";

// This module is loaded only in the browser by Astro's client:only island.
// Capture into the existing module memory before any React effect/analytics runs.
if (typeof window !== "undefined") {
  captureStaffAccessLink(window);
  capturePlayerInvitationLink(window);
}

export default function ApplicationRoot() {
  return <StrictMode><App /></StrictMode>;
}
