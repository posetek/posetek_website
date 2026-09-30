// PoseTek support page. Public, no-login page: App Store Connect's Support URL
// points here, and App Review expects an easy way to contact us (guideline 1.5).
// Answers describe shipped behavior only; check the iOS app before adding one.
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useThemeColor } from "../../lib/use-theme-color";
import {
  MINIMUM_IOS_VERSION,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  SUPPORT_QUESTIONS,
  type SupportQuestionId,
} from "./support-content";
import "./support.scss";
import ReportProblem from "./ReportProblem";

function SupportEmail() {
  return <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>;
}

function Question({ id, children }: { id: SupportQuestionId; children: ReactNode }) {
  const question = SUPPORT_QUESTIONS.find(entry => entry.id === id)?.question;
  return (
    <div className="question" id={id}>
      <h3>{question}</h3>
      {children}
    </div>
  );
}

export default function SupportPage() {
  useThemeColor(null); // matches the privacy page: light browser chrome default
  useEffect(() => {
    document.title = "Support | PoseTek";
    // Deep links (/support#delete-account) land on their answer; the route is
    // lazy, so the browser's own hash scroll runs before the answer exists.
    const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, []);

  return (
    <div className="pt-support">
      <header>
        <Link to="/" className="logo">Pose<span>Tek</span></Link>
        <Link to="/" className="back-btn">← Home</Link>
      </header>

      <main>
        <div className="page-header">
          <div className="eyebrow">Support</div>
          <h1>PoseTek Support</h1>
          <p className="lead">Help with the PoseTek app and posetek.net. If your answer isn't below, email us and a person on our team will reply.</p>
        </div>

        <ReportProblem />
        <section id="contact" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Contact us</h2>
          <p>Email is the fastest way to reach us, for anything from a sign-in problem to a question about your results.</p>
          <a className="contact-cta" href={SUPPORT_MAILTO}>Email {SUPPORT_EMAIL}</a>
          <p>So we can help on the first reply, please include:</p>
          <ul>
            <li>the email address on your PoseTek account;</li>
            <li>your device model and iOS version;</li>
            <li>what you were doing, what you expected, and what happened instead; and</li>
            <li>a screenshot or screen recording, if you have one.</li>
          </ul>
          <address className="contact-box">
            <strong>PoseTek Inc.</strong><br />
            3618 Cameron Avenue<br />
            Pleasanton, California<br />
            Email: <SupportEmail />
          </address>
        </section>

        <section id="questions" aria-labelledby="questions-heading">
          <h2 id="questions-heading">Common questions</h2>
          <nav className="question-list" aria-label="Common questions">
            <ul>
              {SUPPORT_QUESTIONS.map(entry => (
                <li key={entry.id}><a href={`#${entry.id}`}>{entry.question}</a></li>
              ))}
            </ul>
          </nav>

          <Question id="requirements">
            <p>An iPhone or iPad running iOS {MINIMUM_IOS_VERSION} or later, a PoseTek account, and camera access so you can record training videos. Coaches and players can also sign in at <Link to="/signin">posetek.net/signin</Link> from any modern browser.</p>
          </Question>

          <Question id="create-account">
            <p>Create an account from the sign-in screen in the app or at <Link to="/signin">posetek.net/signin</Link>. If your club uses PoseTek, use the signup link or code your coach gave you, so your account connects to your spot on the team's roster. We send a verification email when you sign up; check your spam folder if it doesn't arrive.</p>
            <p>If your link or code doesn't work, ask your coach to send it again, or email us.</p>
          </Question>

          <Question id="forgot-password">
            <p>Choose <strong>Forgot password?</strong> on the sign-in screen, in the app or on the website, and enter your account email. We'll send a link to set a new password. If it doesn't arrive within a few minutes, check your spam folder, then email us from the address on your account.</p>
          </Question>

          <Question id="camera">
            <p>PoseTek needs camera access to record training videos. Open your device's Settings, find the app in the list, and turn on Camera. Then reopen the app. If recording still fails, restart your device and make sure it has free storage, then email us with your device model and iOS version.</p>
          </Question>

          <Question id="analysis">
            <p>Analysis works best when the player's whole body stays in the frame, the device is propped up or held steady, and the area is well lit. Record the attempt again if any of those were off.</p>
            <p>If a result still looks wrong, email us the date, the drill, and what looked wrong. We review individual results and can correct or remove them.</p>
          </Question>

          <Question id="delete-account">
            <p>Email <SupportEmail /> from the address on your account and ask us to delete your account. We delete the account and its associated data, including training videos. Deletion is permanent. You can also ask us to delete specific videos or results without closing your account.</p>
            <p>Our Privacy Policy explains <Link to="/privacy#your-choices-and-rights">your choices and rights</Link> and <Link to="/privacy#data-retention">how long deletion takes</Link>.</p>
          </Question>

          <Question id="parents">
            <p>A parent or guardian can ask us at any time to review, correct, or delete their child's information, or to withdraw consent. Email <SupportEmail />, or contact your child's club. See <Link to="/privacy#childrens-privacy">Children's privacy</Link> in our Privacy Policy.</p>
          </Question>

          <Question id="coaches-and-clubs">
            <p>Email us to set up your club or team, to get help with player signup links and rosters, or to change which staff can see your players. Tell us your club name and your role.</p>
          </Question>
        </section>

        <section id="policies" aria-labelledby="policies-heading">
          <h2 id="policies-heading">Policies</h2>
          <p>Our <Link to="/privacy">Privacy Policy</Link> explains what information PoseTek collects, how it is used and shared, and the choices you have.</p>
        </section>
      </main>

      <footer>
        <p>© 2026 PoseTek · <Link to="/">Home</Link> · <Link to="/support" onClick={() => window.scrollTo(0, 0)}>Support</Link> · <Link to="/privacy">Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
