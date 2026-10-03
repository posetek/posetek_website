"use strict";
// Isolated candidate entrypoint. This file is NOT the production functions index.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
// Enable only in a separately verified package after the fixed-mailbox Graph
// translation flow and its endpoint secret pass tenant/caller acceptance.
const mailIdentityEnabled = false;
Object.assign(exports, require("./issue-tracker-bridge-entrypoints").createIssueTrackerBridgeEntrypoints(functions, admin, { normalize: normalizeIssueTracker, mailIdentityEnabled }));
