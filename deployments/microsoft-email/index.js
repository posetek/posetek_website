"use strict";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
Object.assign(exports, require("./microsoft-email-entrypoints").createMicrosoftEmailEntrypoints(functions, admin));
