# Planner preview context guard

Published and verified November 1, 2026. See the
[release handoff](../releases/PLANNER_PREVIEW_CONTEXT_GUARD.md) and
[production receipt](../releases/receipts/PLANNER_PREVIEW_CONTEXT_GUARD_PRODUCTION.json).

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
Source and runtime CI, exact artifact verification, and signed-in synthetic
preview assessments passed on both the candidate and production. This does not
claim a real player has retried or that unrelated generation failures are fixed.
Future releases must use the approved runtime and ordinary website artifact
process; do not promote all of main or any held features with this change.
