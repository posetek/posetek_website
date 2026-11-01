# Planner preview context guard

Source candidate, November 1, 2026. Not published.

When whole-body preview is enabled, **Preview priorities** previously submitted
an empty training context before the player had chosen training days or a start
date. The gateway rejected that payload. Generation already withheld its action
until the context was complete; preview now follows the same context readiness
check and explains the required schedule and equipment confirmation beside the
button. The handler also refuses incomplete input before loading evidence.

The shared personalized request builder validates an explicitly included context
as a final submission guard. Complete contexts preserve their values, including
Sunday as weekday zero. Requests with no training context retain their prior
behavior. This does not fill in a player's schedule, confirm equipment for them,
change server eligibility, or generate a plan automatically.

Regression tests reproduce empty and duplicate weekday payloads, check missing
dates and confirmations, and preserve complete and context-free requests.
Focused tests, lint and TypeScript checks are local source evidence. Browser
interaction, production artifact verification and deployed acceptance remain
required before calling this fixed for a player. Release must use the current
approved runtime and ordinary website artifact process; do not promote all of
main or any held features with this change.
