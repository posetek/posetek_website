// Shared account entry, retaining the legacy admission callables and identity
// resolution. Managed staff activate server-assigned access separately at /join.
//
// Navigation: the role destinations (coachesview.html / profile.html) are ported,
// so they become client-side navigations to /roster and /athlete with the legacy
// query strings. A safe ?returnTo= is followed with a full navigation because it
// may name an unported legacy page that only exists as a static file.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import firebase, { auth, cloud, db } from "../../lib/firebase";
import { loadAccountAccess, STAFF_RECOVERY_HELP } from "../../lib/account-access";
import { findCoach, findPlayer } from "../../lib/identity";
import { useThemeColor } from "../../lib/use-theme-color";
import { refreshAdminIdentity, upsertAdminProfile } from "../admin/lib/identity";
import { capturePlayerInvitationLink, createInvitedPlayer, forgetPlayerInvitationLink, initialPlayerInvitationLink, readPlayerInvitationLink, unavailablePlayerInvitation } from "./player-invitation-link";
import { accountDestination, accountError } from "./account-entry";
import type { AccountRole } from "./account-entry";
import {
  coachHomeRoute,
  coachOrgInputError,
  coachOrgStep2Copy,
  getSafeReturnToUrl,
  playerSignupRoute,
  validateIndependentSignup,
  validateOrgSignup,
  validatePlayerCodeSignup,
} from "./landing-helpers";
import type { CoachOrgAction, CoachOrgChoice, SignupTab } from "./landing-helpers";
import {
  createCoachDocument,
  createOrganization,
  discardFailedSignup,
  joinOrganization,
  redeemPlayerSignupCode,
} from "./signup-data";
import "./landing.scss";
import AccountRecoveryRequest from "../../components/AccountRecoveryRequest";

export default function LandingPage() {
  useThemeColor("#04130e"); // kickai.html: <meta name="theme-color" content="#04130e">
  const navigate = useNavigate();
  const [invitationLink, setInvitationLink] = useState(() => { capturePlayerInvitationLink(window); return initialPlayerInvitationLink(); });
  const [signedIn, setSignedIn] = useState(Boolean(auth.currentUser));
  const [invitationCheck, setInvitationCheck] = useState<"checking" | "ready" | "unavailable" | "error" | null>(invitationLink.present ? "checking" : null);

  // Overlay modals (the login panel is inline now — legacy showModal(loginModal)
  // only scrolls it into view and focuses the email field).
  const [signupOpen, setSignupOpen] = useState(invitationLink.present);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [coachOrgOpen, setCoachOrgOpen] = useState(false);
  const loginPanelRef = useRef<HTMLElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const signupDialogRef = useRef<HTMLDivElement>(null);
  const loginFocusTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(loginFocusTimerRef.current), []);

  // Signup tabs
  const [activeTab, setActiveTab] = useState<SignupTab>("playerCode");

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [pendingActivation, setPendingActivation] = useState(false);
  const [signInHelp, setSignInHelp] = useState(false);
  const loginMounted = useRef(false);
  const authEpoch = useRef(0);

  // Player-code signup form
  const [playerCode, setPlayerCode] = useState(invitationLink.code);
  const [playerEmail, setPlayerEmail] = useState("");
  const [playerPassword, setPlayerPassword] = useState("");
  const [playerConfirmPassword, setPlayerConfirmPassword] = useState("");
  const [playerCodeError, setPlayerCodeError] = useState("");
  const [playerCodeSuccess, setPlayerCodeSuccess] = useState("");
  const [playerCodeLoading, setPlayerCodeLoading] = useState(false);
  const pendingPlayerSignup = useRef<firebase.User | null>(null);
  const verificationSentFor = useRef<string | null>(null);

  useEffect(() => {
    // Pasting another invitation into an already-open sign-in tab is a fragment
    // navigation, not a document reload. Consume it just like the initial link.
    const openInvitation = () => {
      if (!readPlayerInvitationLink(window.location.href).invitation.present) return;
      capturePlayerInvitationLink(window);
      const next = initialPlayerInvitationLink();
      setInvitationLink(next); setPlayerCode(next.code); setActiveTab("playerCode");
      setSignupOpen(true); setPlayerCodeError(""); setInvitationCheck("checking");
    };
    window.addEventListener("hashchange", openInvitation);
    window.addEventListener("popstate", openInvitation);
    return () => { window.removeEventListener("hashchange", openInvitation); window.removeEventListener("popstate", openInvitation); };
  }, []);

  // Organization signup form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgSignupError, setOrgSignupError] = useState("");
  const [orgSignupSuccess, setOrgSignupSuccess] = useState("");
  const [orgSignupLoading, setOrgSignupLoading] = useState(false);

  // Independent (coach) signup form
  const [indFirstName, setIndFirstName] = useState("");
  const [indLastName, setIndLastName] = useState("");
  const [indEmail, setIndEmail] = useState("");
  const [indPassword, setIndPassword] = useState("");
  const [indConfirmPassword, setIndConfirmPassword] = useState("");
  const [independentError, setIndependentError] = useState("");
  const [independentSuccess, setIndependentSuccess] = useState("");
  const [independentLoading, setIndependentLoading] = useState(false);

  // Forgot-password modal (promise-based, like legacy showForgotPasswordModal)
  const [forgotEmail, setForgotEmail] = useState("");
  const forgotResolver = useRef<((value: string | null) => void) | null>(null);
  const forgotInputRef = useRef<HTMLInputElement>(null);

  // Coach organization setup modal (promise-based, like legacy showCoachOrgModal)
  const [coachOrgStep, setCoachOrgStep] = useState<1 | 2>(1);
  const [coachOrgAction, setCoachOrgAction] = useState<CoachOrgAction | null>(null);
  const [coachOrgInput, setCoachOrgInput] = useState("");
  const [coachOrgError, setCoachOrgError] = useState("");
  const coachOrgResolver = useRef<((value: CoachOrgChoice | null) => void) | null>(null);
  const coachOrgInputRef = useRef<HTMLInputElement>(null);

  // Post-signup redirect timer: legacy full page loads implicitly cancelled it;
  // in the SPA it must not fire after the user navigates away from this page.
  const redirectTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(redirectTimerRef.current), []);

  // Authentication and invitation fields must never enter session replay.
  useEffect(() => {
    document.title = "Sign In | PoseTek";
    return () => forgetPlayerInvitationLink();
  }, []);

  useEffect(() => {
    if (!invitationLink.present) return;
    let current = true;
    if (!/^[A-Za-z0-9-]{6,64}$/.test(playerCode.trim())) { setInvitationCheck("unavailable"); return; }
    setInvitationCheck("checking");
    const timer = window.setTimeout(() => {
      cloud.httpsCallable("validatePlayerSignupInvitation")({ code: playerCode })
        .then(result => { if (current) setInvitationCheck((result.data as { valid?: boolean })?.valid === true ? "ready" : "unavailable"); })
        .catch(() => { if (current) setInvitationCheck("error"); });
    }, 350);
    return () => { current = false; window.clearTimeout(timer); };
  }, [invitationLink.present, playerCode]);

  // Check auth state to update UI (legacy: a signed-out visitor carrying a safe
  // returnTo gets the login panel brought into view)
  useEffect(() => {
    loginMounted.current = true;
    const unsubscribe = auth.onAuthStateChanged((user: any) => {
      ++authEpoch.current;
      setSignedIn(Boolean(user));
      setPendingActivation(false);
      if (!user && getSafeReturnToUrl()) showLoginPanel();
    });
    return () => { loginMounted.current = false; ++authEpoch.current; unsubscribe(); };
  }, []);

  // Close every open overlay with Escape (legacy: all `.modal-overlay.active`).
  // The promise-based modals resolve null here — legacy only hid them, which
  // left the awaiting signup handler (and its spinner) stuck forever.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (signupOpen) setSignupOpen(false);
      if (forgotOpen) finishForgotModal(null);
      if (coachOrgOpen) finishCoachOrgModal(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signupOpen, forgotOpen, coachOrgOpen]);

  useEffect(() => {
    if (!signupOpen || coachOrgOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = signupDialogRef.current;
    // The overlay changes CSS visibility in this render. Wait for that style
    // to apply before moving focus away from the button that opened it.
    const focusFrame = window.requestAnimationFrame(() => dialog?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(control => control.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { window.cancelAnimationFrame(focusFrame); document.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, [signupOpen, coachOrgOpen]);

  // legacy showModal(loginModal)
  function showLoginPanel() {
    window.clearTimeout(loginFocusTimerRef.current);
    loginFocusTimerRef.current = window.setTimeout(() => {
      // Signup can be closing in the current render; check the committed UI.
      if (document.querySelector('.modal-overlay.active')) return;
      loginPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      emailInputRef.current?.focus();
    }, 220);
  }

  function openSignupModal(tab: SignupTab = "playerCode") {
    setSignupOpen(true);
    setActiveTab(tab);
  }
  function closeSignupModal() {
    setSignupOpen(false);
  }

  // Promise-based forgot password modal
  function showForgotPasswordModal(prefillEmail?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      forgotResolver.current = resolve;
      setForgotEmail(prefillEmail || "");
      setForgotOpen(true);
      setTimeout(() => {
        if (!prefillEmail) forgotInputRef.current?.focus();
      }, 300);
    });
  }
  function finishForgotModal(value: string | null) {
    setForgotOpen(false);
    const resolve = forgotResolver.current;
    forgotResolver.current = null;
    if (resolve) resolve(value);
  }
  function handleForgotConfirm() {
    const val = forgotEmail.trim();
    if (val) finishForgotModal(val);
  }

  // Promise-based coach org modal
  function showCoachOrgModal(): Promise<CoachOrgChoice | null> {
    return new Promise<CoachOrgChoice | null>((resolve) => {
      coachOrgResolver.current = resolve;
      setCoachOrgStep(1);
      setCoachOrgAction(null);
      setCoachOrgInput("");
      setCoachOrgError("");
      setCoachOrgOpen(true);
    });
  }
  function finishCoachOrgModal(value: CoachOrgChoice | null) {
    setCoachOrgOpen(false);
    const resolve = coachOrgResolver.current;
    coachOrgResolver.current = null;
    if (resolve) resolve(value);
  }
  function goToCoachOrgStep2(action: CoachOrgAction) {
    setCoachOrgAction(action);
    setCoachOrgError("");
    setCoachOrgInput("");
    setCoachOrgStep(2);
    setTimeout(() => coachOrgInputRef.current?.focus(), 150);
  }
  function handleCoachOrgConfirm() {
    const val = coachOrgInput.trim();
    if (!val) {
      setCoachOrgError(coachOrgInputError(coachOrgAction));
      return;
    }
    finishCoachOrgModal({ action: coachOrgAction as CoachOrgAction, value: val });
  }

  function redirectAfterAuth(role: AccountRole, playerId: string | null = null) {
    const destination = accountDestination(role, playerId, window.location.search, window.location.href, window.location.origin);
    if (destination.startsWith("http") || destination === "/admin") window.location.href = destination;
    else navigate(destination);
  }

  // Login handler (legacy loginForm submit)
  async function handleLogin() {
    const email = loginEmail;
    const password = loginPassword;

    const initialRevision = authEpoch.current;
    let isCurrent = () => loginMounted.current && authEpoch.current === initialRevision;
    try {
      setLoginLoading(true);
      setLoginError(""); setLoginSuccess(""); setPendingActivation(false);
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user: any = userCredential.user;
      if (!user || !loginMounted.current || auth.currentUser?.uid !== user.uid) return;
      const revision = authEpoch.current;
      isCurrent = () => loginMounted.current && authEpoch.current === revision && auth.currentUser?.uid === user.uid;

      const access = await loadAccountAccess(user, isCurrent);
      if (!isCurrent()) return;
      if (access.kind === "activation") {
        const returnTo = getSafeReturnToUrl();
        if (access.reason === "unlinked" && returnTo && new URL(returnTo).pathname === "/join") { redirectAfterAuth("pending"); return; }
        setPendingActivation(access.reason !== "staff-inactive");
        setLoginSuccess(access.reason === "admin-unverified"
          ? "You are signed in. Ask a PoseTek administrator for your account activation link, then open it to finish access. No email has been sent."
          : access.reason === "staff-inactive"
            ? "You are signed in, but your staff access is not active. Ask your organization admin to check your assignment."
            : "You are signed in. Open your staff access link to connect your account. If you expected a player profile, ask your coach to check your account link.");
        return;
      }
      if (access.role === "admin") {
        const identity = await refreshAdminIdentity(user);
        if (!isCurrent()) return;
        if (!identity.isAdmin) throw new Error("Account access changed. Sign in again.");
        await upsertAdminProfile(identity);
      } else if (access.role === "independent") {
        const coachDoc = await findCoach(db, user.uid);
        if (!isCurrent()) return;
        await coachDoc?.ref.update({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() });
      } else if (access.role === "player" && access.playerId) {
        await db.collection("players").doc(access.playerId).update({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() });
      }
      if (isCurrent()) redirectAfterAuth(access.role, access.playerId || null);
    } catch (error: any) {
      if (isCurrent()) setLoginError(accountError(error, "We could not load your account access. Your sign-in has been kept; try again, or use your staff invitation to finish activation."));
    } finally {
      if (loginMounted.current) setLoginLoading(false);
    }
  }

  // Password Reset
  async function handleForgotPassword() {
    const existing = loginEmail.trim();
    const email = existing || (await showForgotPasswordModal());
    if (email) {
      const revision = authEpoch.current;
      const current = () => loginMounted.current && authEpoch.current === revision;
      setLoginLoading(true);
      setLoginError(""); setLoginSuccess("");
      try {
        await auth.sendPasswordResetEmail(email);
        if (current()) setLoginSuccess("If this email has an account, a password reset link has been requested. Check your inbox and spam folder. If it does not arrive, request sign-in help below.");
      } catch (error: any) {
        if (current()) setLoginError(accountError(error, "The reset email could not be requested. Check your connection and retry, or request sign-in help below."));
      } finally {
        if (current()) setLoginLoading(false);
      }
    }
  }

  // Organization signup handler
  async function handleOrgSignup() {
    const firstNameVal = firstName.trim();
    const lastNameVal = lastName.trim();
    const email = signupEmail;
    const password = signupPassword;
    const confirmPasswordVal = confirmPassword;
    const userTypeVal = userType;
    const orgCodeVal = orgCode.trim();
    let user: any = null;

    try {
      setOrgSignupLoading(true);
      setOrgSignupError("");
      setOrgSignupSuccess("");

      const problem = validateOrgSignup({
        firstName: firstNameVal,
        lastName: lastNameVal,
        password,
        confirmPassword: confirmPasswordVal,
        userType: userTypeVal,
        orgCode: orgCodeVal,
      });
      if (problem) throw new Error(problem);

      let coachSetup: CoachOrgChoice | null = null;
      if (userTypeVal === "coach") {
        coachSetup = await showCoachOrgModal();
        if (!coachSetup) throw new Error("Organization setup cancelled");
      }

      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      user = userCredential.user;
      await user.sendEmailVerification();

      if (userTypeVal === "player") {
        await joinOrganization(orgCodeVal, "player", firstNameVal, lastNameVal);
        navigate(playerSignupRoute(null)); // legacy: profile.html?userType=player
      } else {
        // validateOrgSignup only lets "coach" past here, and the modal was confirmed above.
        const setup = coachSetup as CoachOrgChoice;
        if (setup.action === "create") await createOrganization(setup.value, firstNameVal, lastNameVal);
        else await joinOrganization(setup.value, "coach", firstNameVal, lastNameVal);
        navigate(coachHomeRoute()); // legacy: coachesview.html?userType=coach
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      await discardFailedSignup(user);
      setOrgSignupError(accountError(error, error.message));
    } finally {
      setOrgSignupLoading(false);
    }
  }

  // Player code signup handler
  async function handlePlayerCodeSignup() {
    const code = playerCode.trim();
    const email = playerEmail;
    const password = playerPassword;
    const confirmPasswordVal = playerConfirmPassword;

    try {
      setPlayerCodeLoading(true);
      setPlayerCodeError("");
      setPlayerCodeSuccess("");

      const problem = validatePlayerCodeSignup({ code, password, confirmPassword: confirmPasswordVal });
      if (problem) throw new Error(problem);

      const playerId = await createInvitedPlayer({ code, email, password }, {
        currentUser: () => auth.currentUser,
        validate: async value => (await cloud.httpsCallable("validatePlayerSignupInvitation")({ code: value })).data?.valid === true,
        create: async (address, secret) => {
          const result = await auth.createUserWithEmailAndPassword(address, secret);
          if (!result.user) throw new Error("Your account could not be created. Please try again.");
          return result.user;
        },
        verify: async user => {
          if (verificationSentFor.current !== user.uid) {
            await user.sendEmailVerification(); verificationSentFor.current = user.uid;
          }
        },
        redeem: redeemPlayerSignupCode,
        resolve: async user => (await findPlayer(db, user.uid))?.id || null,
        created: user => { pendingPlayerSignup.current = user; },
        discard: async user => {
          try { await user.delete(); }
          catch { throw new Error("Your new account could not be cleared after signup stopped. Keep this page open and try Create Account again when your connection is available."); }
          pendingPlayerSignup.current = null; verificationSentFor.current = null;
        },
      }, pendingPlayerSignup.current);

      forgetPlayerInvitationLink();
      pendingPlayerSignup.current = null;
      const signupUid = auth.currentUser?.uid;
      if (!signupUid) throw new Error("Your account was created. Sign in to open your athlete profile.");
      setPlayerCodeSuccess("Account created. Check your inbox for the verification email.");
      redirectTimerRef.current = window.setTimeout(() => {
        if (auth.currentUser?.uid !== signupUid) { setPlayerCodeError("Your account was created. Sign in with that account to open your athlete profile."); return; }
        // The trusted redemption response selects the existing canonical profile.
        navigate(invitationLink.present ? `/athlete?player=${encodeURIComponent(playerId)}` : playerSignupRoute(playerId));
      }, 1500);
    } catch (error: any) {
      setPlayerCodeError(accountError(error, error?.message || "Your account could not be created. Please try again."));
    } finally {
      setPlayerCodeLoading(false);
    }
  }

  // Independent signup handler
  async function handleIndependentSignup() {
    const firstNameVal = indFirstName.trim();
    const lastNameVal = indLastName.trim();
    const email = indEmail;
    const password = indPassword;
    const confirmPasswordVal = indConfirmPassword;

    try {
      setIndependentLoading(true);
      setIndependentError("");
      setIndependentSuccess("");

      const problem = validateIndependentSignup({
        firstName: firstNameVal,
        lastName: lastNameVal,
        password,
        confirmPassword: confirmPasswordVal,
      });
      if (problem) throw new Error(problem);

      // Create user in Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user: any = userCredential.user;
      await user.sendEmailVerification();

      await createCoachDocument(user.uid, email, firstNameVal, lastNameVal);
      navigate(coachHomeRoute()); // legacy: coachesview.html?userType=coach
    } catch (error: any) {
      console.error("Signup error:", error);
      setIndependentError(accountError(error, error.message));
    } finally {
      setIndependentLoading(false);
    }
  }

  const step2 = coachOrgStep2Copy(coachOrgAction);
  // legacy showModal()/hideModal() toggled body.style.overflow for the overlays
  const modalOpen = signupOpen || forgotOpen || coachOrgOpen;

  return (
    <div className={`pt-landing${modalOpen ? " modal-open" : ""}`}>
      <header className="site-chrome">
        <Link to="/" className="brand-lockup" aria-label="PoseTek home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>POSETEK</span>
        </Link>
      </header>

      <main>
        <div className="auth-shell">
          <section className="auth-context" aria-labelledby="auth-page-title">
            <p className="eyebrow">Athlete performance system · 2026</p>
            <h1 id="auth-page-title">Your performance lives here.</h1>
            <p className="auth-intro">
              Sign in to review test results, movement video, and the training work that follows each session.
            </p>
            <ul className="access-list" aria-label="PoseTek account access">
              <li>
                <strong>Coaches</strong> Manage athletes
              </li>
              <li>
                <strong>Athletes</strong> Review results
              </li>
              <li>
                <strong>Teams</strong> Track progress
              </li>
            </ul>
          </section>

          <section id="loginModal" className="login-panel" aria-labelledby="login-title" ref={loginPanelRef}>
            <div className="login-card">
              <p className="login-kicker">Secure account access</p>
              <div className="modal-header">
                <h2 className="modal-title" id="login-title">
                  Sign in to PoseTek
                </h2>
                <p className="login-support">One sign-in for players, coaches and admins.</p>
                {/* legacy: hidden by CSS; its click handler (hideModal(loginModal)) is a no-op */}
                <button className="close-btn" id="closeModal" type="button" tabIndex={-1} aria-hidden="true">
                  &times;
                </button>
              </div>
              <form
                id="loginForm"
                data-clarity-mask="true"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLogin();
                }}
              >
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    required
                    ref={emailInputRef}
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="password">Password</label>
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                  <button className="password-visibility" type="button" aria-pressed={showLoginPassword} onClick={() => setShowLoginPassword(value => !value)}>{showLoginPassword ? "Hide password" : "Show password"}</button>
                </div>
                <div className="login-form-row">
                  <div className="checkbox-group">
                    <input type="checkbox" id="rememberMe" />
                    <label htmlFor="rememberMe">Remember me</label>
                  </div>
                  <a
                    href="#"
                    className="text-link"
                    id="forgotPassword"
                    onClick={(e) => {
                      e.preventDefault();
                      setSignInHelp(value => !value);
                    }}
                  >
                    Forgot password or need sign-in help?
                  </a>
                </div>
                <div className="error-message" id="loginError" role="alert" style={{ display: loginError ? "block" : "none" }}>
                  {loginError}
                </div>
                <div
                  className="success-message"
                  id="loginSuccess"
                  role="status"
                  aria-live="polite"
                  style={{ display: loginSuccess ? "block" : "none" }}
                >
                  {loginSuccess}
                </div>
                <button type="submit" className="submit-btn" id="loginSubmit" disabled={loginLoading}>
                  <span style={{ opacity: loginLoading ? 0.5 : 1 }}>Sign In</span>
                  <span
                    className="spinner"
                    id="loginSpinner"
                    aria-hidden="true"
                    style={{ display: loginLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
              {signInHelp && <aside className="account-signin-help" aria-label="Sign-in help"><strong>Forgot your password?</strong><p>Players and independent coaches can request a reset email for their existing account.</p><button className="secondary-action" type="button" disabled={loginLoading} onClick={() => { void handleForgotPassword(); }}>Reset password by email</button><p>{STAFF_RECOVERY_HELP}</p><Link className="text-link" to="/join">Open a private recovery or access code</Link><AccountRecoveryRequest initialEmail={loginEmail} /></aside>}
              {pendingActivation && <Link className="secondary-action activation-pending" to="/join">Finish staff activation</Link>}
              <div className="signup-prompt">
                <p>Joining PoseTek?</p>
                <div className="account-entry-options">
                  <button type="button" className="secondary-action" id="getStartedBtn" onClick={() => openSignupModal()}><strong>Player</strong><span>Use your player signup code</span></button>
                  <Link className="secondary-action" to="/join"><strong>Coach or admin</strong><span>Use your access link or code</span></Link>
                </div>
                <details className="account-entry-legacy"><summary>Independent coach or organization code</summary><p>Existing independent coaching and organization-code signup remain available.</p><div className="account-entry-options">
                  <button type="button" className="secondary-action" onClick={() => openSignupModal("independent")}>Create an independent coach account</button>
                  <button type="button" className="secondary-action" onClick={() => openSignupModal("organization")}>Organization-code signup</button>
                </div></details>
              </div>
              <p className="access-note">
                Your account permissions determine which athlete and team data you can access.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Signup Modal */}
      <div className={`modal-overlay${signupOpen ? " active" : ""}`} id="signupModal" data-clarity-mask="true">
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="signup-title" tabIndex={-1} ref={signupDialogRef}>
          <div className="modal-content-wrapper">
            <div className="modal-header">
              <h3 className="modal-title" id="signup-title">{activeTab === "playerCode" ? "Create your player account" : activeTab === "independent" ? "Independent coach signup" : "Organization-code signup"}</h3>
              <button
                className="close-btn"
                id="closeSignupModal"
                type="button"
                aria-label="Close account creation"
                onClick={closeSignupModal}
              >
                &times;
              </button>
            </div>

            <p className="login-support account-modal-invite">Invited as a coach or organization admin? <Link to="/join">Activate staff access</Link> using your staff invitation.</p>
            <div className="tab-container account-signup-tabs" aria-label="Signup options">
              <button
                className={`tab${activeTab === "playerCode" ? " active" : ""}`}
                type="button"
                data-tab="playerCode"
                aria-pressed={activeTab === "playerCode"}
                onClick={() => setActiveTab("playerCode")}
              >
                Player code
              </button>
              <button
                className={`tab${activeTab === "organization" ? " active" : ""}`}
                type="button"
                data-tab="organization"
                aria-pressed={activeTab === "organization"}
                onClick={() => setActiveTab("organization")}
              >
                Organization code
              </button>
              <button
                className={`tab${activeTab === "independent" ? " active" : ""}`}
                type="button"
                data-tab="independent"
                aria-pressed={activeTab === "independent"}
                onClick={() => setActiveTab("independent")}
              >
                Independent coach
              </button>
            </div>

            {/* Player Tab */}
            <div className={`tab-content${activeTab === "playerCode" ? " active" : ""}`} id="playerCodeTab">
              <p className="login-support">Use the player signup code your coach or organization shared with you. It connects this login to your existing player profile.</p>
              {invitationLink.present && <p className="login-support" role="status">
                {invitationCheck === "checking" ? "Checking your player invitation…" : invitationCheck === "ready" ? "Your player code is filled in. Enter your email and choose a password to open your existing profile." : invitationCheck === "error" ? "We could not check your invitation. Try Create Account again when your connection is available." : unavailablePlayerInvitation}
              </p>}
              {signedIn && !pendingPlayerSignup.current && <p className="login-support">You are already signed in. <button type="button" className="secondary-action" onClick={() => { void auth.signOut().catch(() => setPlayerCodeError("Could not sign out. Please try again.")); }}>Sign out to create another account</button></p>}
              <p className="login-support"><button type="button" className="secondary-action" onClick={() => { closeSignupModal(); showLoginPanel(); }}>Already have an account? Sign in</button></p>
              <form
                id="playerCodeForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handlePlayerCodeSignup();
                }}
              >
                <div className="form-group">
                  <label htmlFor="playerCode">Player signup code</label>
                  <input
                    type="text"
                    id="playerCode"
                    name="player-code"
                    placeholder="Enter login code"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={playerCode}
                    data-clarity-mask="true"
                    onChange={(e) => { setPlayerCode(e.target.value); setPlayerCodeError(""); }}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerEmail">Email</label>
                  <input
                    type="email"
                    id="playerEmail"
                    name="player-email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    required
                    value={playerEmail}
                    onChange={(e) => setPlayerEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerPassword">Password</label>
                  <input
                    type="password"
                    id="playerPassword"
                    name="player-password"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={playerPassword}
                    onChange={(e) => setPlayerPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerConfirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="playerConfirmPassword"
                    name="player-confirm-password"
                    placeholder="Enter the password again"
                    autoComplete="new-password"
                    required
                    value={playerConfirmPassword}
                    onChange={(e) => setPlayerConfirmPassword(e.target.value)}
                  />
                </div>
                <div
                  className="error-message"
                  id="playerCodeError"
                  role="alert"
                  style={{ display: playerCodeError ? "block" : "none" }}
                >
                  {playerCodeError}
                </div>
                <div
                  className="success-message"
                  id="playerCodeSuccess"
                  role="status"
                  aria-live="polite"
                  style={{ display: playerCodeSuccess ? "block" : "none" }}
                >
                  {playerCodeSuccess}
                </div>
                <button type="submit" className="submit-btn" id="playerCodeSubmit" disabled={playerCodeLoading || (signedIn && !pendingPlayerSignup.current) || invitationCheck === "checking" || (invitationLink.present && invitationCheck === "unavailable" && !pendingPlayerSignup.current)}>
                  <span style={{ opacity: playerCodeLoading ? 0.5 : 1 }}>Create Account</span>
                  <span
                    className="spinner"
                    id="playerCodeSpinner"
                    style={{ display: playerCodeLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            {/* Organization Tab */}
            <div className={`tab-content${activeTab === "organization" ? " active" : ""}`} id="organizationTab">
              <p className="login-support">For existing organization-code access. Coaches can join or create an independent organization. Organization admin access is assigned separately through a staff invitation.</p>
              <form
                id="orgSignupForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleOrgSignup();
                }}
              >
                <div className="name-fields">
                  <div className="form-group">
                    <label htmlFor="firstName">First Name</label>
                    <input
                      type="text"
                      id="firstName"
                      name="first-name"
                      placeholder="First name"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="lastName">Last Name</label>
                    <input
                      type="text"
                      id="lastName"
                      name="last-name"
                      placeholder="Last name"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="signupEmail">Email</label>
                  <input
                    type="email"
                    id="signupEmail"
                    name="signup-email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    required
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="signupPassword">Password (min 6 characters)</label>
                  <input
                    type="password"
                    id="signupPassword"
                    name="signup-password"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirm-password"
                    placeholder="Enter the password again"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="userType">I am a:</label>
                  <select id="userType" required value={userType} onChange={(e) => setUserType(e.target.value)}>
                    <option value="">Select account type</option>
                    <option value="player">Player</option>
                    <option value="coach">Coach</option>
                  </select>
                </div>
                <div className="form-group" id="orgCodeGroup">
                  <label htmlFor="orgCode">Organization Code (if joining existing)</label>
                  <input
                    type="text"
                    id="orgCode"
                    name="organization-code"
                    placeholder="Enter organization code"
                    autoComplete="off"
                    spellCheck={false}
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value)}
                  />
                </div>
                <div
                  className="error-message"
                  id="orgSignupError"
                  role="alert"
                  style={{ display: orgSignupError ? "block" : "none" }}
                >
                  {orgSignupError}
                </div>
                <div
                  className="success-message"
                  id="orgSignupSuccess"
                  role="status"
                  aria-live="polite"
                  style={{ display: orgSignupSuccess ? "block" : "none" }}
                >
                  {orgSignupSuccess}
                </div>
                <button type="submit" className="submit-btn" id="orgSignupSubmit" disabled={orgSignupLoading}>
                  <span style={{ opacity: orgSignupLoading ? 0.5 : 1 }}>Sign Up</span>
                  <span
                    className="spinner"
                    id="orgSignupSpinner"
                    style={{ display: orgSignupLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            {/* Coach Tab */}
            <div className={`tab-content${activeTab === "independent" ? " active" : ""}`} id="independentTab">
              <p className="login-support">Create your own coaching roster. To join a managed organization, use its staff invitation instead.</p>
              <form
                id="independentSignupForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleIndependentSignup();
                }}
              >
                <div className="name-fields">
                  <div className="form-group">
                    <label htmlFor="indFirstName">First Name</label>
                    <input
                      type="text"
                      id="indFirstName"
                      name="coach-first-name"
                      placeholder="First name"
                      autoComplete="given-name"
                      required
                      value={indFirstName}
                      onChange={(e) => setIndFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="indLastName">Last Name</label>
                    <input
                      type="text"
                      id="indLastName"
                      name="coach-last-name"
                      placeholder="Last name"
                      autoComplete="family-name"
                      required
                      value={indLastName}
                      onChange={(e) => setIndLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="indEmail">Email</label>
                  <input
                    type="email"
                    id="indEmail"
                    name="coach-email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    required
                    value={indEmail}
                    onChange={(e) => setIndEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="indPassword">Password</label>
                  <input
                    type="password"
                    id="indPassword"
                    name="coach-password"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={indPassword}
                    onChange={(e) => setIndPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="indConfirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="indConfirmPassword"
                    name="coach-confirm-password"
                    placeholder="Enter the password again"
                    autoComplete="new-password"
                    required
                    value={indConfirmPassword}
                    onChange={(e) => setIndConfirmPassword(e.target.value)}
                  />
                </div>
                <div
                  className="error-message"
                  id="independentError"
                  role="alert"
                  style={{ display: independentError ? "block" : "none" }}
                >
                  {independentError}
                </div>
                <div
                  className="success-message"
                  id="independentSuccess"
                  role="status"
                  aria-live="polite"
                  style={{ display: independentSuccess ? "block" : "none" }}
                >
                  {independentSuccess}
                </div>
                <button type="submit" className="submit-btn" id="independentSubmit" disabled={independentLoading}>
                  <span style={{ opacity: independentLoading ? 0.5 : 1 }}>Sign Up</span>
                  <span
                    className="spinner"
                    id="independentSpinner"
                    style={{ display: independentLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            <div className="auth-links">
              <a
                href="#"
                id="showLogin"
                onClick={(e) => {
                  e.preventDefault();
                  closeSignupModal();
                  showLoginPanel();
                }}
              >
                Already have an account? Login
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <div className={`modal-overlay${forgotOpen ? " active" : ""}`} id="forgotPasswordModal">
        <div className="auth-modal">
          <div className="modal-content-wrapper">
            <div className="modal-header">
              <h3 className="modal-title">Reset Password</h3>
              <button
                className="close-btn"
                id="closeForgotModal"
                type="button"
                aria-label="Close password reset"
                onClick={() => finishForgotModal(null)}
              >
                &times;
              </button>
            </div>
            <p className="mini-modal-copy">Enter your email and we’ll send you a reset link.</p>
            <div className="form-group">
              <label htmlFor="forgotEmailInput">Email Address</label>
              <input
                type="email"
                id="forgotEmailInput"
                name="reset-email"
                placeholder="name@example.com"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                ref={forgotInputRef}
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
            </div>
            <div className="mini-modal-buttons">
              <button className="mini-cancel-btn" id="forgotCancelBtn" onClick={() => finishForgotModal(null)}>
                Cancel
              </button>
              <button className="submit-btn" id="forgotConfirmBtn" style={{ flex: 1 }} onClick={handleForgotConfirm}>
                Send Reset Email
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coach Organization Setup Modal */}
      <div className={`modal-overlay${coachOrgOpen ? " active" : ""}`} id="coachOrgModal">
        <div className="auth-modal">
          <div className="modal-content-wrapper">
            {/* Step 1: Choose action */}
            <div id="coachOrgStep1" style={{ display: coachOrgStep === 1 ? "block" : "none" }}>
              <div className="modal-header">
                <h3 className="modal-title">Organization Setup</h3>
                <button
                  className="close-btn"
                  id="closeCoachOrgModal"
                  type="button"
                  aria-label="Close organization setup"
                  onClick={() => finishCoachOrgModal(null)}
                >
                  &times;
                </button>
              </div>
              <p className="mini-modal-copy">As a coach, how would you like to get started?</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <button className="org-choice-btn" id="coachCreateOrgBtn" onClick={() => goToCoachOrgStep2("create")}>
                  <span className="org-choice-icon">＋</span>
                  <div>
                    <div className="org-choice-title">Create a new organization</div>
                    <div className="org-choice-sub">Set up your own team or club</div>
                  </div>
                </button>
                <button className="org-choice-btn" id="coachJoinOrgBtn" onClick={() => goToCoachOrgStep2("join")}>
                  <span className="org-choice-icon">→</span>
                  <div>
                    <div className="org-choice-title">Join an existing organization</div>
                    <div className="org-choice-sub">Enter a code to join a club</div>
                  </div>
                </button>
              </div>
            </div>
            {/* Step 2: Input org name or join code */}
            <div id="coachOrgStep2" style={{ display: coachOrgStep === 2 ? "block" : "none" }}>
              <div className="modal-header">
                <h3 className="modal-title" id="coachOrgStep2Title">
                  {step2.title}
                </h3>
                <button
                  className="close-btn"
                  id="closeCoachOrgModal2"
                  type="button"
                  aria-label="Close organization setup"
                  onClick={() => finishCoachOrgModal(null)}
                >
                  &times;
                </button>
              </div>
              <div className="form-group">
                <label id="coachOrgInputLabel" htmlFor="coachOrgInput">
                  {step2.label}
                </label>
                <input
                  type="text"
                  id="coachOrgInput"
                  name="coach-organization"
                  placeholder={step2.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  ref={coachOrgInputRef}
                  value={coachOrgInput}
                  onChange={(e) => setCoachOrgInput(e.target.value)}
                />
              </div>
              <div id="coachOrgInputError" className="error-message" style={{ display: coachOrgError ? "block" : "none" }}>
                {coachOrgError}
              </div>
              <div className="mini-modal-buttons">
                <button className="mini-cancel-btn" id="coachOrgBackBtn" onClick={() => setCoachOrgStep(1)}>
                  ← Back
                </button>
                <button className="submit-btn" id="coachOrgConfirmBtn" style={{ flex: 1 }} onClick={handleCoachOrgConfirm}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="site-footer">
        <span>© 2026 PoseTek</span>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
