import './feedback-invitation.css';

export default function PlayerFeedbackInvitation({ onDismiss }: { onDismiss: () => void }) {
  return <section className="portal-card player-feedback-invitation" aria-label="Optional feedback">
    <p className="eyebrow">Your workout is saved</p>
    <h2>Help us improve PoseTek — three quick questions.</h2>
    <p>Tell the PoseTek team what worked and what got in your way. Giving feedback is your choice.</p>
    <div className="player-feedback-actions">
      <a className="primary-cta" href="/feedback?source=workout" rel="noreferrer">Give feedback <span aria-hidden="true">↗</span></a>
      <button className="text-button" onClick={onDismiss}>Not now</button>
    </div>
  </section>;
}

export function PlayerResultsFeedbackLink() {
  return <p className="player-feedback-results"><a href="/feedback?source=results" rel="noreferrer">Give feedback <span aria-hidden="true">↗</span></a></p>;
}
