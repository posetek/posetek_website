"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { relevance } = require("./issue-tracker-mail-capture");
const { powerAutomateWarning } = require("./issue-tracker-mail-classification");
const mail = (subject, body = "", sender = "PowerAutomateNoReply@microsoft.com") => ({ subject, body: { content: body }, sender: { emailAddress: { address: sender } } });
test("Power Automate failures and throttling remain captured without PoseTek or failure body keywords", () => {
  for (const value of [mail("1 of your flow(s) have failed"), mail("3 of your flows have failed"), mail("Alert: Your operation has been throttled.", "Action limit exceeded")]) {
    const decision = relevance(value);
    assert.equal(decision.relevant, true); assert.equal(decision.category, "Microsoft Power Automate"); assert.equal(decision.scope, "flow_needs_verification");
  }
});
test("an operational warning does not prove flow ownership or an exact backend incident", () => {
  const warning = powerAutomateWarning(mail("1 of your flow(s) have failed", "PoseTek tracker - read Dylan mailbox"));
  assert.equal(warning.scope, "flow_needs_verification"); assert.equal(warning.actorUid, undefined); assert.equal(warning.exactJoin, undefined);
  assert.equal(powerAutomateWarning(mail("1 of your flow(s) have failed", "", "lookalike@microsoft.com.example.org")), null);
  assert.equal(powerAutomateWarning(mail("Sales newsletter", "Your flow failed")), null);
});
test("Google project and project-unknown notices are retained while successful workouts stay out of the issue tracker", () => {
  assert.equal(relevance(mail("Google Cloud notice", "kickai-69dd0", "noreply@google.com")).reason, "google_cloud_project_notice");
  assert.equal(relevance(mail("Google Cloud Billing notice", "Budget update", "noreply@google.com")).reason, "google_cloud_notice_project_needs_verification");
  assert.equal(relevance(mail("[PoseTek workout completed] Sample", "Workout completed successfully", "alerts@posetek.net")).relevant, false);
  assert.equal(relevance(mail("Blank", "")).relevant, false);
});
