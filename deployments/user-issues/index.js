"use strict";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
Object.assign(exports, require("./user-issue-entrypoints").createUserIssueEntrypoints(functions, admin));
