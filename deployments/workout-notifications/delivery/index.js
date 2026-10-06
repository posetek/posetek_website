"use strict";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const endpoints = require("./workout-notifications-entrypoints").createWorkoutNotificationEntrypoints(functions, admin, () => { throw new Error("Callable excluded from this deployment scope"); });
for (const name of ["dispatchWorkoutNotification", "sweepWorkoutNotifications"]) exports[name] = endpoints[name];
