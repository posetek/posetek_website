"use strict";
// Isolated candidate entrypoint. This file is NOT the production functions index.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const { normalizeIssueTracker } = require("./issue-tracker-normalize");
Object.assign(exports, require("./issue-tracker-bridge-entrypoints").createIssueTrackerBridgeEntrypoints(functions, admin, { normalize: normalizeIssueTracker }));
