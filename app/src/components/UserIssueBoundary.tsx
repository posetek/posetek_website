import { Component, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { captureIssue, drainIssues } from "../lib/user-issues";
import { auth } from "../lib/firebase";
export function UserIssueCapture() {
  const location = useLocation();
  useEffect(() => {
    const error = (event: ErrorEvent) => captureIssue(event.error || new Error(event.message), "browser", { force: true });
    const rejected = (event: PromiseRejectionEvent) => captureIssue(event.reason, "unhandled_promise", { force: true });
    const drain = () => { void drainIssues(); };
    window.addEventListener("error", error); window.addEventListener("unhandledrejection", rejected); window.addEventListener("online", drain);
    const off = auth.onAuthStateChanged(drain); const timer = window.setInterval(drain, 60000); drain();
    return () => { off(); clearInterval(timer); window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", rejected); window.removeEventListener("online", drain); };
  }, []);
  return ["/", "/index.html", "/support"].includes(location.pathname) ? null : <Link className="user-issue-help" to="/support#report-problem">Report a problem</Link>;
}
export default class UserIssueBoundary extends Component<{ children: ReactNode }, { failed: boolean; reference: string }> {
  state = { failed: false, reference: "" };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { const reference = captureIssue(error, "screen_render", { force: true }); this.setState({ reference: reference || new Date().toISOString() }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="user-issue-recovery"><h1>This screen couldn’t load</h1><p>Reload the page to try again. Any unsaved changes may need to be entered again.</p>
      <p>Problem reference: {this.state.reference}</p><button onClick={() => window.location.reload()}>Reload</button> <a href="/support#report-problem">Report this problem</a></main>;
  }
}
