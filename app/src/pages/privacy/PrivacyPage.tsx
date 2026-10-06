// PoseTek privacy policy (September 2026 rewrite of the ported legacy privacy.html).
// Public, no-login page: App Store Connect's Privacy Policy URL points here.
// The first-party usage-measurement disclosures (Sections 3, 4, 6 and 8) are
// relied on by docs/insights/EXPANDED_INSIGHTS_HANDOFF.md; keep them in step
// with functions/insight-usage.js retention.
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useThemeColor } from "../../lib/use-theme-color";
import { injectClarity } from "./clarity";
import {
  POLICY_CONTACT_EMAIL,
  POLICY_EFFECTIVE_DATE,
  POLICY_LAST_UPDATED,
  POLICY_SECTIONS,
  sectionNumber,
  type PolicySectionId,
} from "./privacy-sections";
import "./privacy.scss";

function ContactEmail() {
  return <a href={`mailto:${POLICY_CONTACT_EMAIL}`}>{POLICY_CONTACT_EMAIL}</a>;
}

function PolicySection({ id, children }: { id: PolicySectionId; children: ReactNode }) {
  const title = POLICY_SECTIONS.find(section => section.id === id)?.title;
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}><span className="section-num">{sectionNumber(id)}</span> {title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  useThemeColor(null); // legacy privacy.html had no theme-color meta
  useEffect(() => {
    document.title = "Privacy Policy | PoseTek";
    injectClarity();
    // Deep links (/privacy#childrens-privacy) land on their section; the route
    // is lazy, so the browser's own hash scroll runs before the section exists.
    const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0); // full-page-load parity
  }, []);

  return (
    <div className="pt-privacy">
      <header>
        <Link to="/" className="logo">Pose<span>Tek</span></Link>
        <Link to="/" className="back-btn">← Home</Link>
      </header>

      <main>
        <div className="page-header">
          <div className="eyebrow">Legal</div>
          <h1>PoseTek Privacy Policy</h1>
          <p className="last-updated">
            <strong>Effective date:</strong> {POLICY_EFFECTIVE_DATE}<br />
            <strong>Last updated:</strong> {POLICY_LAST_UPDATED}
          </p>
        </div>

        <nav className="toc" aria-labelledby="privacy-toc-heading">
          <h2 id="privacy-toc-heading">Contents</h2>
          <ol>
            {POLICY_SECTIONS.map(section => (
              <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
            ))}
          </ol>
        </nav>

        <PolicySection id="who-we-are">
          <p>PoseTek ("PoseTek," "we," "us," or "our") is operated by PoseTek Inc., based in California, USA. We provide a soccer training platform that uses video and computer vision to analyze technique, measure performance, and build personalized training plans for players, with tools for coaches, parents, and clubs.</p>
          <p>This Privacy Policy explains what information we collect, how we use and share it, and the choices you have. It applies to the PoseTek mobile app, the PoseTek website at posetek.net, and related services (together, the "Services").</p>
          <p>If you have questions, contact us at <ContactEmail />.</p>
        </PolicySection>

        <PolicySection id="summary">
          <ul>
            <li>We collect the information needed to run a training platform: account details, player profile information, training videos, performance results, and basic app usage and diagnostic data.</li>
            <li>Training videos and performance data are linked to the player's account so we can show progress over time.</li>
            <li>Players' data may be visible to their own club's authorized coaches and administrators. It is not public.</li>
            <li>We do not sell personal information. We do not show third-party ads. We do not track users across other companies' apps or websites.</li>
            <li>Many of our players are minors. We require a parent or guardian's consent for players under 13, and parents can review or delete their child's information at any time.</li>
            <li>You can delete your account and associated data by emailing us.</li>
          </ul>
        </PolicySection>

        <PolicySection id="information-we-collect">
          <h3>Information you provide</h3>
          <ul>
            <li><strong>Account information:</strong> name, email address, password or sign-in credentials, and account role (player, parent, coach, or club administrator).</li>
            <li><strong>Player profile information:</strong> age or date of birth, playing position, team and club affiliation, experience level, training goals, and similar details used to personalize training.</li>
            <li><strong>Training videos and images:</strong> videos you record in the app or choose to upload from your photo library, such as footage of kicks, drills, and performance tests. These videos show the player and may incidentally show other people or surroundings in the frame.</li>
            <li><strong>Performance and training data:</strong> results from measured drills and performance tests, technique analysis results (including body-position and movement data derived from video), workouts assigned and completed, and progress over time.</li>
            <li><strong>Messages to the AI coach:</strong> the questions and requests you type when using in-app chat features, and the responses generated.</li>
            <li><strong>Coach and club input:</strong> feedback, comments, workout adjustments, and notes that coaches or administrators add to a player's profile.</li>
            <li><strong>Communications:</strong> information you send us when you contact support or submit an interest or booking form on our website.</li>
          </ul>

          <h3>Information collected automatically</h3>
          <ul>
            <li><strong>Identifiers:</strong> an account ID we assign to you, and app-installation or device-level identifiers generated by our service providers' software.</li>
            <li><strong>Usage data:</strong> how you interact with the Services, such as screens viewed, features used, and session times. For signed-in players this includes estimated active time and feature categories in the website and supported iPhone builds, associated with the player's account. Collection pauses when the app is in the background or the screen is idle. These usage reports do not contain page addresses, typed text, or screen recordings.</li>
            <li><strong>Diagnostics:</strong> crash logs and performance data, including device model and operating system version.</li>
          </ul>

          <h3>Device permissions</h3>
          <ul>
            <li><strong>Camera:</strong> used to record training videos. We only access the camera when you are actively recording in the app.</li>
            <li><strong>Photo library:</strong> used only when you choose to upload an existing video. We receive only the items you select.</li>
          </ul>
          <p>You can change these permissions at any time in your device settings.</p>

          <h3>Information we do not collect</h3>
          <p>We do not collect precise location, contacts, or advertising identifiers (IDFA), and we do not collect payment card details. The app does not offer in-app purchases. Where paid services are offered through our website, payments are processed by Stripe; we receive confirmation of payment and subscription status, not your card number or banking details.</p>
        </PolicySection>

        <PolicySection id="how-we-use-information">
          <p>We use the information we collect to:</p>
          <ul>
            <li>create and manage accounts and authenticate users;</li>
            <li>analyze training videos and generate technique feedback and performance measurements;</li>
            <li>build, adjust, and track personalized training plans and workouts;</li>
            <li>show players, parents, and authorized coaches a player's progress over time;</li>
            <li>show testing coverage, workout participation, and estimated active use to PoseTek administrators and the player's currently authorized club managers and coaches;</li>
            <li>provide AI coaching and chat features;</li>
            <li>provide customer support and respond to requests;</li>
            <li>monitor, debug, secure, and improve the Services;</li>
            <li>develop and improve our analysis, benchmarks, and recommendations, using de-identified or aggregated data wherever practical; and</li>
            <li>comply with legal obligations and enforce our terms.</li>
          </ul>
          <p>We do not use personal information for third-party advertising or for tracking across other companies' apps and websites.</p>
        </PolicySection>

        <PolicySection id="ai-and-automated-processing">
          <p>PoseTek uses computer vision and artificial intelligence to analyze video, estimate body position and movement, score technique, and generate training recommendations and chat responses. Some of this processing happens on your device and some happens on our servers or those of our service providers.</p>
          <ul>
            <li>Feedback and plans generated by the Services are training guidance only. They are not medical advice and are not a substitute for a qualified coach's or medical professional's judgment.</li>
            <li>Where we use third-party AI providers to generate responses or plans, we send only the information needed for that task, under agreements that prohibit those providers from using it to train their own models.</li>
            <li>We may use de-identified and aggregated training and performance data to improve our own models and to build benchmarks (for example, comparing results against players of a similar age and position). This data is not used to identify any individual player.</li>
          </ul>
        </PolicySection>

        <PolicySection id="how-we-share-information">
          <p>We share personal information only in these circumstances:</p>
          <ul>
            <li><strong>With the player's club and coaches.</strong> If a player is connected to a club or team on PoseTek, that club's authorized coaches and administrators can view the player's profile, videos, performance results, workouts, and estimated active use in order to coach the player. Players are not visible to other clubs or to the public.</li>
            <li><strong>With parents and guardians.</strong> A parent or guardian linked to a minor player's account can view that player's information.</li>
            <li>
              <strong>With service providers.</strong> We use vendors that process information on our behalf under contractual confidentiality and security obligations, including:
              <ul>
                <li>Google (Firebase and Google Cloud) for authentication, databases, file and video storage, hosting, analytics, and crash reporting;</li>
                <li>Google (Vertex AI) and Anthropic for generating coaching responses and training plans;</li>
                <li>Stripe for processing payments made through our website; and</li>
                <li>Microsoft (Clarity) for website usage analytics, such as clicks, scrolling, and page interactions, on parts of posetek.net.</li>
              </ul>
            </li>
            <li><strong>For legal reasons.</strong> We may disclose information if required by law, legal process, or a valid government request, or to protect the rights, safety, and security of our users, PoseTek, or others.</li>
            <li><strong>In a business transfer.</strong> If PoseTek is involved in a merger, acquisition, financing, or sale of assets, information may be transferred as part of that transaction, subject to this Policy's protections. We will notify users of any change in ownership or in how personal information is handled.</li>
            <li><strong>With your consent or at your direction.</strong> For example, if you choose to export or share a video or result.</li>
          </ul>
          <p>We do not sell personal information, and we do not share it with third parties for their own marketing or advertising.</p>
        </PolicySection>

        <PolicySection id="childrens-privacy">
          <p>PoseTek is designed for youth soccer players, and we take the privacy of minors seriously.</p>

          <h3>Players under 13</h3>
          <ul>
            <li>We do not knowingly allow a child under 13 to create an account or provide personal information without verifiable consent from a parent or legal guardian. Accounts for players under 13 are set up through the player's club, after the club has collected consent from the player's parent or guardian.</li>
            <li>We collect from children only the information reasonably necessary to provide the Services described in this Policy: account and profile details, training videos, and performance data.</li>
            <li>We do not show advertising to children, do not use children's information for behavioral advertising, and do not make children's information publicly available.</li>
            <li>A child's information is shared only as described in <a href="#how-we-share-information">Section {sectionNumber("how-we-share-information")}</a>: with the child's linked parent or guardian, with authorized coaches and administrators at the child's own club, and with service providers that help us operate the Services.</li>
          </ul>

          <h3>Parents' and guardians' rights</h3>
          <p>A parent or guardian may at any time:</p>
          <ul>
            <li>review the personal information we hold about their child;</li>
            <li>ask us to correct or delete that information, including videos;</li>
            <li>refuse to permit further collection or use of their child's information, which will end the child's use of the Services; and</li>
            <li>withdraw consent previously given.</li>
          </ul>
          <p>To exercise these rights, email <ContactEmail /> from the email address associated with the account, or contact your child's club. We will take reasonable steps to verify that the requester is the child's parent or guardian before acting.</p>
          <p>If we learn we have collected personal information from a child under 13 without the required consent, we will delete it promptly. If you believe this has happened, contact us at <ContactEmail />.</p>

          <h3>Players aged 13 to 17</h3>
          <p>We encourage teen players to use PoseTek with a parent or guardian's knowledge. The same limits apply: no advertising, no sale of personal information, and no public profiles.</p>
        </PolicySection>

        <PolicySection id="app-feedback">
          <p>Giving feedback is optional and does not affect access to results or saved progress. The updated form explains before you answer whether feedback will be linked to your signed-in account or sent anonymously. Feedback opened from a workout or results requires a signed-in account. Visitors using a shared QR code, message link or direct link can give anonymous feedback when signed out. PoseTek administrators read responses to improve the application. Please do not include additional names, contact details or other personal information in the optional comment.</p>
          <p>We store the form version, selected answers, optional comment, broad invitation source (such as workouts or results), submission time and optional time taken. When you submit through the updated form while signed in, the response also contains your account ID, account name and email address when available, and email verification status. PoseTek administrators can see this account information with the response. It identifies the signed-in account, not a verified real-world person. Feedback is not published as a public profile.</p>
          <p>Responses collected through the earlier anonymous form remain anonymous and are not linked retrospectively to accounts, players, workouts, teams or network logs. New anonymous responses contain no account author information. We do not use historical feedback or network logs to infer who submitted an anonymous response.</p>
          <p>A random identifier for each form opening deduplicates retries and counts form opens, starts and successful submissions. Form-session diagnostic records do not store the submitting account or author information. These counts describe form sessions, not individual people. The feedback page does not load session replay, analytics or advertising scripts.</p>
          <p>A browser timestamp limits automatic workout invitations to once every seven days on that browser; it is not sent with feedback. For abuse prevention, the submission service briefly processes a network address to create a secret-protected, time-window counter. These counters are separate from answers, are not used to identify players, and expire within 30 minutes of their window starting. Hosting and cloud providers may also process network addresses in their ordinary service logs.</p>
          <p>Individual feedback responses and form-session diagnostic records expire after 90 days. Database expiry removal is asynchronous, so physical deletion can follow the expiry time; expired records are excluded from the admin review. Feedback is optional even when a coach or parent shares the form.</p>
        </PolicySection>

        <PolicySection id="data-retention">
          <ul>
            <li>We keep account, profile, video, and performance information for as long as the account is active, so that players can see their progress over time.</li>
            <li>When an account is deleted, we delete or de-identify the associated personal information, including training videos, within 30 days, except where we must retain limited information to comply with law, resolve disputes, or prevent abuse. Backups are overwritten on a rolling schedule of up to 90 days.</li>
            <li>Accounts that are inactive for 24 months may be deleted after notice to the email address on file.</li>
            <li>Detailed active-use records are retained for 90 days and daily usage summaries for 24 months. Older app builds and dates before collection began may have no usage measurements.</li>
            <li>Payment records are retained as required for financial and legal compliance purposes.</li>
            <li>De-identified and aggregated data that can no longer be linked to an individual may be retained.</li>
          </ul>
        </PolicySection>

        <PolicySection id="your-choices-and-rights">
          <ul>
            <li><strong>Access and correction.</strong> You can view and update most account and profile information in the app.</li>
            <li><strong>Delete your account.</strong> You can delete your account and associated data, including training videos, by emailing <ContactEmail />. Deletion is permanent.</li>
            <li><strong>Permissions.</strong> You can turn off camera and photo library access in your device settings. Some features will not work without camera access.</li>
            <li><strong>Club connection.</strong> You can ask to disconnect from a club, which ends that club's access to the player's information going forward.</li>
          </ul>
          <p>Depending on where you live, you may have additional rights under privacy laws, such as the right to know what personal information we hold, to obtain a copy, to correct it, to delete it, and not to be discriminated against for exercising these rights. California residents: we do not sell or share personal information as those terms are defined under California law, and we do not use sensitive personal information for purposes beyond providing the Services. To make a request, email <ContactEmail />. We will verify your identity before responding and will respond within the time required by law.</p>
          <p>Our Services do not respond to browser "Do Not Track" signals because we do not track users across third-party sites.</p>
        </PolicySection>

        <PolicySection id="security">
          <p>We use reasonable administrative, technical, and physical safeguards to protect personal information, including encryption in transit, encryption at rest provided by our cloud infrastructure, role-based access controls that limit each club's staff to their own players, and restricted internal access. No method of transmission or storage is completely secure, and we cannot guarantee absolute security. If we become aware of a breach affecting your personal information, we will notify you as required by law.</p>
        </PolicySection>

        <PolicySection id="where-information-is-processed">
          <p>PoseTek is based in the United States, and information is processed and stored in the United States. If you use the Services from outside the United States, your information will be transferred to and processed in the United States, where privacy laws may differ from those in your location.</p>
        </PolicySection>

        <PolicySection id="changes-to-this-policy">
          <p>We may update this Policy from time to time. If we make material changes, we will notify you in the app or by email before the changes take effect, and where required we will request renewed parental consent. The "Last updated" date at the top shows when this Policy was last revised.</p>
        </PolicySection>

        <PolicySection id="contact-us">
          <address className="contact-box">
            <strong>PoseTek Inc.</strong><br />
            3618 Cameron Avenue<br />
            Pleasanton, California<br />
            Email: <ContactEmail />
          </address>
        </PolicySection>
      </main>

      <footer>
        <p>© 2026 PoseTek · <Link to="/">Home</Link> · <Link to="/support">Support</Link> · <Link to="/privacy" onClick={() => window.scrollTo(0, 0)}>Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
