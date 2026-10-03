"use strict";
// A Microsoft sender/subject identifies an operational warning, not its flow
// ownership, an athlete, or an exact backend occurrence. Keep those unconfirmed
// until independent flow/tenant evidence is recorded.
function powerAutomateWarning(mail) {
  const sender = String(mail.from?.emailAddress?.address || mail.sender?.emailAddress?.address || mail.from || "").toLowerCase();
  if (sender !== "powerautomatenoreply@microsoft.com") return null;
  const subject = String(mail.subject || "").trim();
  if (/^\d+ of your flows?(?:\(s\))? have failed\.?$/i.test(subject)) return {
    category: "Microsoft Power Automate", operation: "Flow failure warning", reason: "power_automate_flow_failure", scope: "flow_needs_verification",
  };
  if (/^(?:Alert:\s*)?Your operation has been throttled\.?$/i.test(subject)) return {
    category: "Microsoft Power Automate", operation: "Operation throttling warning", reason: "power_automate_operation_throttled", scope: "flow_needs_verification",
  };
  return null;
}
module.exports = { powerAutomateWarning };
