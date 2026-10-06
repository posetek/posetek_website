"use strict";
// Isolated candidate entrypoint. This file is NOT the production functions index.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
// Capability only: settings still require exact fixed-mailbox flow acceptance
// and a guarded capture-binding migration before the translator can be used.
const mailIdentityEnabled = true;
Object.assign(exports, require("./issue-tracker-bridge-entrypoints").createIssueTrackerBridgeEntrypoints(functions, admin, { normalize: normalizeIssueTracker, mailIdentityEnabled }));
