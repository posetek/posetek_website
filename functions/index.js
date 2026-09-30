const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe");
const crypto = require("crypto");
const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");

admin.initializeApp();
const db = admin.firestore();
// Private workout delivery is additive and disabled until its settings are enabled.
Object.assign(exports, require("./workout-notifications-entrypoints").createWorkoutNotificationEntrypoints(functions, admin, requireCaller));
const { createDiagnosticUploads } = require("./diagnostic-uploads");
const diagnosticUploads = createDiagnosticUploads({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
exports.beginDiagnosticUpload = functions.https.onCall((data, context) => diagnosticUploads.authorize(data || {}, requireCaller(context)));

const { createDiagnosticRetention } = require("./diagnostic-retention");
const diagnosticRetention = createDiagnosticRetention({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
exports.acknowledgeDiagnosticArtifacts = functions.firestore.document("failureCases/{incidentId}").onWrite((_, context) => diagnosticRetention.acknowledge(context.params.incidentId));
exports.acknowledgeDiagnosticAttempt = functions.firestore.document("processingAttempts/{attemptId}").onWrite((_, context) => diagnosticRetention.acknowledge(context.params.attemptId, "processingAttempts"));
exports.setDiagnosticInvestigationHold = functions.https.onCall((data, context) => diagnosticRetention.protect(data || {}, requireCaller(context)));
exports.cleanupDiagnosticArtifacts = functions.runWith({ timeoutSeconds: 120, memory: "256MB" }).pubsub.schedule("every 24 hours").onRun(() => diagnosticRetention.sweep());
exports.ingestDevicePerformanceV1 = require("./device-performance-ingestion").createIngestDevicePerformanceV1(functions, admin, requireCaller);
exports.getDevicePerformanceV1 = require("./device-performance").createDevicePerformanceCallable("getDevicePerformanceV1", functions, admin, requireCaller);
exports.getDevicePerformanceDetailV1 = require("./device-performance").createDevicePerformanceCallable("getDevicePerformanceDetailV1", functions, admin, requireCaller);
exports.getDevicePerformanceAttemptV1 = require("./device-performance").createDevicePerformanceCallable("getDevicePerformanceAttemptV1", functions, admin, requireCaller);
exports.setDevicePerformanceLabelV1 = require("./device-performance").createDevicePerformanceCallable("setDevicePerformanceLabelV1", functions, admin, requireCaller);

// Additive reporting and engagement endpoints; existing callables stay intact.
const insightEntrypoints = require("./insights-entrypoints").createInsightsEntrypoints(functions, admin, requireCaller);
Object.assign(exports, insightEntrypoints);
// AI observability Phase 1: projectFailedLlmJobs + foldAiIncidents (aiIncidents).
Object.assign(exports, require("./ai-incidents").createAiIncidentEntrypoints(functions, admin));
const { createPlayerInvitations } = require("./player-invitations");
const playerInvitations = createPlayerInvitations({ db, FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const { createPlayerInvitationChecks } = require("./player-invitation-checks");
const playerInvitationChecks = createPlayerInvitationChecks({ db, HttpsError: functions.https.HttpsError });
exports.getPlayerSignupInvitation = functions.https.onCall((data, context) => playerInvitations.getInvitation(data?.playerId, requireCaller(context)));
exports.validatePlayerSignupInvitation = functions.https.onCall(async (data, context) => {
  await playerInvitationChecks(context.rawRequest);
  return playerInvitations.validate(data?.code);
});
exports.ensurePlayerSignupInvitation = functions.https.onCall((data, context) => playerInvitations.ensure(data?.playerId, requireCaller(context), { rotate: data?.rotate === true }));
exports.createCoachPlayer = functions.https.onCall((data, context) => playerInvitations.createCoachPlayer(data || {}, requireCaller(context)));
exports.ensurePlayerInvitationOnWrite = functions.runWith({ failurePolicy: true }).firestore.document("players/{playerId}").onWrite((_, context) => playerInvitations.ensure(context.params.playerId));

const { createSocial } = require("./social");
const social = createSocial({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError });
for (const [endpoint, handler] of Object.entries({
  getSocialAdminDirectory: "adminDirectory", getSocialContext: "getContext", getSocialFeed: "getFeed", getSocialActivity: "getDetail",
  saveSocialPreferences: "savePreferences", setSocialVisibility: "setVisibility", getSocialPeople: "people",
  socialConnection: "connect", setSocialKudos: "kudos", getSocialComments: "comments", saveSocialComment: "comment",
  reportSocialActivity: "report", moderateSocialActivity: "moderation", getSocialMedia: "media",
})) exports[endpoint] = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => social[handler](data || {}, requireCaller(context)));
// Re-read authoritative inputs in a transaction: duplicate and out-of-order
// mobile/web writes cannot publish an older projection over a newer result.
exports.projectSocialReps = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("players/{playerId}/reps/{repId}").onWrite((change, context) => {
  const before = change.before?.data?.() || {};
  const after = change.after?.data?.() || {};
  return after.testingEventId || before.testingEventId ? null : social.rebuild(context.params.playerId);
});
exports.projectSocialWorkouts = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("players/{playerId}/workoutLogs/{logId}").onWrite((_, context) => social.rebuild(context.params.playerId));
exports.projectSocialSessions = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("players/{playerId}/trainingSessions/{sessionId}").onWrite((_, context) => social.rebuild(context.params.playerId));
exports.projectSocialPlayer = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("players/{playerId}").onWrite((_, context) => social.rebuild(context.params.playerId));
// Auth deletion can precede roster cleanup. Immediately make retained results
// unavailable socially without deleting the club's original athlete records.
exports.closeSocialAccount = functions.runWith({ failurePolicy: true }).auth.user().onDelete(user =>
  db.collection("socialPreferences").doc(user.uid).set({ accountDeleted: true, audience: "private", automatic: false, videos: false }, { merge: true }));

const { createAdmission } = require("./admission");
const { createTeamLeaderboard } = require("./team-leaderboard");
const { createClubInsights } = require("./club-insights");
const { createAthleteShares } = require("./athlete-shares");
const { createClubs } = require("./clubs");
const { createClubBranding } = require("./club-branding");
const { createRepRevisions } = require("./rep-revisions");
const { createAnalysisReviews } = require("./analysis-reviews");
const { createTestingEvents } = require("./testing-events");
const { createTrainingAuthoring } = require("./training-authoring");
const trainingAuthoring = createTrainingAuthoring({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), authDirectory: admin.auth(), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
exports.trainingGetDrillAuthoring = functions.https.onCall((data, context) => trainingAuthoring.getAuthoring(data || {}, requireCaller(context)));
exports.trainingSaveDrillAuthoring = functions.https.onCall((data, context) => trainingAuthoring.saveAuthoring(data || {}, requireCaller(context)));
exports.trainingSaveDrill = functions.https.onCall((data, context) => trainingAuthoring.saveDrill(data || {}, requireCaller(context)));
exports.trainingReviewDrill = functions.https.onCall((data, context) => trainingAuthoring.reviewDrill(data || {}, requireCaller(context)));
exports.trainingApproveDrillMedia = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => trainingAuthoring.approveMedia(data || {}, requireCaller(context)));
exports.trainingPublishDrill = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => trainingAuthoring.publishDrill(data || {}, requireCaller(context)));
exports.trainingSetReviewer = functions.https.onCall((data, context) => trainingAuthoring.setReviewer(data || {}, requireCaller(context)));
exports.trainingGetReadiness = functions.https.onCall((data, context) => trainingAuthoring.getReadiness(data || {}, requireCaller(context)));
exports.trainingSaveReadiness = functions.https.onCall((data, context) => trainingAuthoring.saveReadiness(data || {}, requireCaller(context)));
const analysisReviews = createAnalysisReviews({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const clubBranding = createClubBranding({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const clubs = createClubs({ invitations: playerInvitations, db, FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const { createAccountAccess } = require("./account-access");
const accountAccess = createAccountAccess({ db, authDirectory: admin.auth(), clubs, FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const testingEvents = createTestingEvents({
  db,
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
  HttpsError: functions.https.HttpsError,
  finalizePlayer: async (playerId) => {
    await insightEntrypoints.rebuildInsightPlayer(playerId);
    await social.rebuild(playerId);
  },
  operatorIdentity: async (uid) => {
    try {
      const user = await admin.auth().getUser(uid);
      return user.disabled ? { uid } : { uid, email: user.email, emailVerified: user.emailVerified, isAnonymous: false };
    } catch { return { uid }; }
  },
  storageSessionFloors: async (playerId) => {
    const prefix = `${playerId}/`;
    const [files] = await admin.storage().bucket("kickai-69dd0.firebasestorage.app").getFiles({ prefix });
    return files.reduce((floors, file) => {
      const segments = file.name.split("/");
      const drillType = segments[1] || "";
      const sessionFolder = segments[2] || "";
      const match = /^session(\d+)$/.exec(sessionFolder);
      if (drillType && match) floors[drillType] = Math.max(floors[drillType] || 0, Number(match[1]));
      return floors;
    }, {});
  },
});
// Admin rep tools (see rep-revisions.js): the only writer of athlete reps
// outside the phone, gated on the same verified @posetek.net predicate the rules use.
const repRevisions = createRepRevisions({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError });
const { createEffectiveResults } = require("./effective-results");
const effectiveResults = createEffectiveResults({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError });
exports.getAthleteEffectiveResults = functions.runWith({ timeoutSeconds: 120, memory: "512MB" }).https.onCall((data, context) => effectiveResults.getResults(data || {}, requireCaller(context)));
exports.getAthleteRepMedia = functions.runWith({ timeoutSeconds: 120, memory: "512MB" }).https.onCall((data, context) => effectiveResults.getMedia(data || {}, requireCaller(context)));

// Signed, server-issued result shares (see athlete-shares.js). Legacy
// documents were client-writable; their tokens and pointers are never accepted.
const athleteShareFunctions = functions.runWith({ secrets: ["ATHLETE_SHARE_SIGNING_KEY"], timeoutSeconds: 120, memory: "512MB" });
const athleteShares = createAthleteShares({
  db, crypto, Timestamp: admin.firestore.Timestamp, HttpsError: functions.https.HttpsError,
  signingKey: () => process.env.ATHLETE_SHARE_SIGNING_KEY,
});
const { athleteShareError, verifiedAthleteShare } = athleteShares;
const admission = createAdmission({
  invitations: playerInvitations,
  db, FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError,
  randomInt: (max) => crypto.randomInt(max),
});
const teamLeaderboard = createTeamLeaderboard({ db, HttpsError: functions.https.HttpsError, effectiveResults });
const clubInsights = createClubInsights({ db, HttpsError: functions.https.HttpsError });
const ATHLETE_ARTIFACT_URL_TTL_MS = 15 * 60 * 1000;
const ATHLETE_SHARE_REP_TYPES = {
  shooting: new Set(["side_kick", "deadballShot", "shooting"]),
  sprint: new Set(["sprint"]),
  jump: new Set(["jump"]),
  broadJump: new Set(["broadJump"]),
  changeOfDirection: new Set(["changeOfDirection"]),
  dribbling: new Set(["dribbling"]),
  freeRecord: new Set(["freeRecord"]),
};
const ATHLETE_SHARE_ARTIFACTS = {
  shooting: ["pose.json", "metadata.json", "ball_detections.json"],
  sprint: ["pose.json", "metadata.json", "tracking.json"],
  jump: ["pose.json", "metadata.json", "com_height.json", "torso_midpoints.json"],
  broadJump: [
    "pose.json",
    "metadata.json",
    "foot_piecewise_fit.json",
    "key_frames.json",
    "foot_centers.json",
    "com_midpoints.json",
    "com_height.json",
  ],
  changeOfDirection: ["pose.json", "metadata.json", "tracking.json"],
  dribbling: ["pose.json", "metadata.json", "tracking.json"],
  freeRecord: ["pose.json", "metadata.json", "ball_detections.json"],
};

const AI_COACH_GATEWAY_URL =
  "https://agent-gateway-keycy7dkua-uw.a.run.app/v1/chat/stream";
const AI_COACH_WEB_ORIGINS = new Set([
  "https://posetek.net",
  "https://www.posetek.net",
  "https://kickai-69dd0.web.app",
  "https://kickai-69dd0.firebaseapp.com",
]);

function allowedAiCoachWebOrigin(origin) {
  if (AI_COACH_WEB_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch (_) {
    return false;
  }
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerNumber(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function repMatchesDrill(rep, drill) {
  const accepted = ATHLETE_SHARE_REP_TYPES[drill];
  return Boolean(
    accepted && (accepted.has(rep.repType) || accepted.has(rep.drillType))
  );
}

function sanitizedAthleteRep(doc, drill) {
  const data = doc.data() || {};
  const common = {
    id: doc.id,
    repType: drill,
    drillType: drill,
    sessionNumber: integerNumber(data.sessionNumber),
    repNumber: integerNumber(data.repNumber),
    absoluteRepNumber: integerNumber(data.absoluteRepNumber),
    createdAtMillis: data.createdAt?.toMillis?.() || null,
  };
  if (drill === "broadJump") {
    return {
      ...common,
      broadJumpDistance: finiteNumber(data.broadJumpDistance),
      jumpHeight: finiteNumber(data.jumpHeight),
      takeoffFrame: integerNumber(data.takeoffFrame),
      landingFrame: integerNumber(data.landingFrame),
    };
  }
  if (drill === "shooting") {
    return {
      ...common,
      velocity: finiteNumber(data.velocity),
    };
  }
  if (drill === "jump") {
    return {
      ...common,
      jumpHeight: finiteNumber(data.jumpHeight),
    };
  }
  if (drill === "sprint") {
    const maxAcceleration = finiteNumber(data.max_acceleration) ?? finiteNumber(data.maxAcceleration);
    const maxVelocity = finiteNumber(data.max_velocity) ?? finiteNumber(data.maxVelocity);
    return {
      ...common,
      max_acceleration: maxAcceleration,
      maxAcceleration,
      max_velocity: maxVelocity,
      maxVelocity,
      totalTime: finiteNumber(data.totalTime),
    };
  }
  return {
    ...common,
    totalTime: finiteNumber(data.totalTime),
    totalDistance: finiteNumber(data.totalDistance),
    outboundDistance: finiteNumber(data.outboundDistance),
    returnDistance: finiteNumber(data.returnDistance),
    phase1Time: finiteNumber(data.phase1Time),
    phase2Time: finiteNumber(data.phase2Time),
    phase3Time: finiteNumber(data.phase3Time),
    avgBallDistance: finiteNumber(data.avgBallDistance),
    phase1Percent: finiteNumber(data.phase1Percent),
    phase2Percent: finiteNumber(data.phase2Percent),
    phase3Percent: finiteNumber(data.phase3Percent),
    markerDistance: finiteNumber(data.markerDistance),
    startFrame: integerNumber(data.startFrame),
    apexFrame: integerNumber(data.apexFrame),
    endFrame: integerNumber(data.endFrame),
    phase1EndFrame: integerNumber(data.phase1EndFrame),
    phase2EndFrame: integerNumber(data.phase2EndFrame),
  };
}

async function sharedFreeRecordRows(playerDocId) {
  const prefix = `${playerDocId}/freeRecord/`;
  const [files] = await admin.storage().bucket().getFiles({ prefix });
  const grouped = new Map();
  for (const file of files) {
    const relative = file.name.slice(prefix.length);
    const parts = relative.split("/").filter(Boolean);
    if (!parts.length) continue;
    const sessionFolder = parts[0];
    if (!/^session\d+$/i.test(sessionFolder)) continue;
    const repFolder = /^kick\d+$/i.test(parts[1] || "") ? parts[1] : "";
    const key = `${sessionFolder}/${repFolder || "root"}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `freeRecord-${sessionFolder}-${repFolder || "root"}`,
        repType: "freeRecord",
        drillType: "freeRecord",
        sessionFolder,
        repFolder,
        sessionRoot: !repFolder,
        sessionNumber: Number(sessionFolder.replace(/\D/g, "")) || 1,
        repNumber: Number(repFolder.replace(/\D/g, "")) || 1,
        createdAtMillis: file.metadata?.updated
          ? Date.parse(file.metadata.updated)
          : null,
      });
    }
  }
  const rows = [...grouped.values()];
  const sessionsWithRepFolders = new Set(
    rows.filter((row) => !row.sessionRoot).map((row) => row.sessionFolder)
  );
  return rows
    .filter(
      (row) =>
        !row.sessionRoot || !sessionsWithRepFolders.has(row.sessionFolder)
    )
    .sort(
    (left, right) =>
      (right.createdAtMillis || 0) - (left.createdAtMillis || 0) ||
      right.sessionNumber - left.sessionNumber ||
      right.repNumber - left.repNumber
    );
}

/** Creates one accountless athlete-results link; see athlete-shares.js. */
exports.createAthleteResultsShare = athleteShareFunctions.https.onCall((data, context) =>
  athleteShares.createAthleteResultsShare({ ...requireCaller(context), playerDocId: data?.playerDocId })
);

/** Returns whitelisted metrics for a valid accountless share link. */
exports.getAthleteResultsShare = athleteShareFunctions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const { share, playerDoc } = await verifiedAthleteShare(data?.token, drill);
  const playerRef = db.collection("players").doc(share.playerDocId);
  let reps;
  if (drill === "freeRecord") {
    reps = await sharedFreeRecordRows(share.playerDocId);
  } else {
    reps = (await effectiveResults.listForPlayer(share.playerDocId, drill)).reps;
  }
  await verifiedAthleteShare(data?.token, drill);
  const player = playerDoc.data() || {};
  return {
    athlete: {
      firstName: String(player.firstName || "").slice(0, 100),
      lastName: String(player.lastName || "").slice(0, 100),
      name: String(player.name || "").slice(0, 200),
      height: finiteNumber(player.height),
      weight: finiteNumber(player.weight),
    },
    reps,
    expiresAtMillis: share.expiresAt?.toMillis?.() || null,
  };
});

/** Returns 15-minute signed URLs for one permitted rep's JSON artifacts. */
exports.getAthleteSharedRepArtifacts = athleteShareFunctions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const repId = String(data?.repId || "").trim();
  if (!repId || repId.includes("/")) throw athleteShareError();
  const { share } = await verifiedAthleteShare(data?.token, drill);
  if (drill !== "freeRecord") {
    const result = await effectiveResults.mediaForPlayer(share.playerDocId, drill, repId);
    await verifiedAthleteShare(data?.token, drill);
    return result;
  }
  const bucket = admin.storage().bucket();
  const fileNames = ATHLETE_SHARE_ARTIFACTS[drill] || [];
  let folders;
  if (drill === "freeRecord") {
    const sessionNumber = integerNumber(data?.sessionNumber);
    const repNumber = integerNumber(data?.repNumber);
    if (!sessionNumber || repNumber === null || repNumber < 0) {
      throw athleteShareError();
    }
    const root = `${share.playerDocId}/freeRecord/session${sessionNumber}`;
    folders = [repNumber === 0 ? root : `${root}/kick${repNumber}`];
  } else {
    const repDoc = await db
      .collection("players")
      .doc(share.playerDocId)
      .collection("reps")
      .doc(repId)
      .get();
    if (!repDoc.exists) throw athleteShareError();
    const rep = repDoc.data() || {};
    if (!repMatchesDrill(rep, drill)) throw athleteShareError();
    try {
      folders = storageFolderCandidates(share.playerDocId, drill, rep, bucket.name);
    } catch (_) {
      throw athleteShareError();
    }
  }
  let selectedFolder = null;
  for (const folder of folders) {
    const [poseExists, metadataExists, listed] = await Promise.all([
      bucket.file(`${folder}/pose.json`).exists().then(([exists]) => exists),
      bucket
        .file(`${folder}/metadata.json`)
        .exists()
        .then(([exists]) => exists),
      bucket.getFiles({ prefix: `${folder}/`, maxResults: 10 }).then(([files]) => files.length > 0),
    ]);
    if (poseExists || metadataExists || listed) {
      selectedFolder = folder;
      break;
    }
  }
  if (!selectedFolder) return { artifactUrls: {}, mediaUrl: null };

  const expires = Date.now() + ATHLETE_ARTIFACT_URL_TTL_MS;
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const file = bucket.file(`${selectedFolder}/${fileName}`);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [url] = await file.getSignedUrl({ action: "read", expires });
      return [fileName, url];
    })
  );
  const [folderFiles] = await bucket.getFiles({ prefix: `${selectedFolder}/` });
  const directFiles = folderFiles.filter((file) => {
    const relative = file.name.slice(selectedFolder.length + 1);
    return relative && !relative.includes("/");
  });
  const movie = directFiles.find((file) => /\.(mov|mp4)$/i.test(file.name));
  const mediaUrl = movie
    ? (await movie.getSignedUrl({ action: "read", expires }))[0]
    : null;
  return {
    artifactUrls: Object.fromEntries(entries.filter(Boolean)),
    mediaUrl,
  };
});

/**
 * Trusted admission (see admission.js). Firestore rules deny the legacy client
 * writes these replace: invitation redemption, organization membership and
 * roster attachment now run only here, against the verified caller UID.
 */
function requireCaller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null, emailVerified: context.auth.token?.email_verified === true, authTime: context.auth.token?.auth_time, isAnonymous: false };
}

// Explicit exports keep Firebase deployment discovery stable across releases.
exports.importClubLogo = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => clubBranding.importClubLogo(data, requireCaller(context)));
exports.getClubContext = functions.https.onCall((data, context) => clubs.getClubContext(data, requireCaller(context)));
exports.createClubOrganization = functions.https.onCall((data, context) => clubs.createClubOrganization(data, requireCaller(context)));
exports.saveClubTeam = functions.https.onCall((data, context) => clubs.saveClubTeam(data, requireCaller(context)));
exports.createClubStaffInvitation = functions.https.onCall(async (data, context) => {
  const caller = requireCaller(context);
  if (data?.activationMode !== "manual") return clubs.createClubStaffInvitation(data, caller);
  await accountAccess.rate(context.rawRequest, caller, "issue", 30);
  return accountAccess.issueStaffActivation(data, caller);
});
exports.replaceClubStaffInvitation = functions.https.onCall(async (data, context) => {
  const caller = requireCaller(context);
  await accountAccess.rate(context.rawRequest, caller, "issue", 30);
  return accountAccess.replaceClubStaffInvitation(data || {}, caller);
});
for (const name of ["issueInternalAdminAccess", "issueAccountRecovery", "listAccountAccessLinks", "revokeAccountAccessLink"]) {
  exports[name] = functions.https.onCall(async (data, context) => {
    const caller = requireCaller(context);
    await accountAccess.rate(context.rawRequest, caller, "manage", 60);
    return accountAccess[name](data || {}, caller);
  });
}
for (const name of ["getAccountAccessLink", "completeAccountAccessLink"]) {
  exports[name] = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
    const caller = context.auth ? requireCaller(context) : null;
    await accountAccess.rate(context.rawRequest, caller, name === "getAccountAccessLink" ? "check" : "complete", name === "getAccountAccessLink" ? 60 : 10);
    return accountAccess[name](data || {}, caller);
  });
}
exports.redeemClubStaffInvitation = functions.https.onCall((data, context) => clubs.redeemClubStaffInvitation(data, requireCaller(context)));
exports.setClubStaffTeams = functions.https.onCall((data, context) => clubs.setClubStaffTeams(data, requireCaller(context)));
exports.revokeClubStaffInvitation = functions.https.onCall((data, context) => clubs.revokeClubStaffInvitation(data, requireCaller(context)));
exports.setClubPlayerTeam = functions.https.onCall((data, context) => clubs.setClubPlayerTeam(data, requireCaller(context)));
exports.issueClubPlayerInvitation = functions.https.onCall((data, context) => clubs.issueClubPlayerInvitation(data, requireCaller(context)));
exports.createClubPlayer = functions.https.onCall((data, context) => clubs.createClubPlayer(data, requireCaller(context)));
exports.createTestingEvent = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => testingEvents.createTestingEvent(data || {}, requireCaller(context)));
exports.addTestingParticipant = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => testingEvents.addTestingParticipant(data || {}, requireCaller(context)));
exports.startTestingEvent = functions.runWith({ timeoutSeconds: 540 }).https.onCall((data, context) => testingEvents.startTestingEvent(data || {}, requireCaller(context)));
exports.updateTestingRepCounts = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => testingEvents.updateTestingRepCounts(data || {}, requireCaller(context)));
exports.createTestingEventInvite = functions.https.onCall((data, context) => testingEvents.createTestingEventInvite(data || {}, requireCaller(context)));
exports.joinTestingEvent = functions.https.onCall((data, context) => testingEvents.joinTestingEvent(data || {}, requireCaller(context)));
exports.claimTestingStation = functions.https.onCall((data, context) => testingEvents.claimTestingStation(data || {}, requireCaller(context)));
exports.renewTestingStationLease = functions.https.onCall((data, context) => testingEvents.renewTestingStationLease(data || {}, requireCaller(context)));
exports.takeOverTestingStation = functions.https.onCall((data, context) => testingEvents.takeOverTestingStation(data || {}, requireCaller(context)));
exports.resetTestingStationCalibration = functions.https.onCall((data, context) => testingEvents.resetTestingStationCalibration(data || {}, requireCaller(context)));
exports.closeTestingEvent = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => testingEvents.closeTestingEvent(data || {}, requireCaller(context)));
exports.reconcileTestingRepProgress = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("players/{playerId}/reps/{repId}").onWrite((change, context) => testingEvents.onRepWrite(change, context));
exports.reconcileTestingStationProgress = functions.runWith({ timeoutSeconds: 120, failurePolicy: true }).firestore.document("testingEvents/{eventId}/progress/{progressId}").onWrite((change, context) => testingEvents.onProgressWrite(change, context));
exports.sweepTestingEventFinalizations = functions.runWith({ timeoutSeconds: 540 }).pubsub.schedule("every 15 minutes").onRun(() => testingEvents.sweepTestingFinalizations());
exports.getClubInsights = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => clubInsights.getClubInsights(data, requireCaller(context)));
exports.adminReviseRep = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => repRevisions.reviseRep(data, requireCaller(context)));
exports.adminRestoreRepRevision = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => repRevisions.restoreRepRevision(data, requireCaller(context)));
exports.adminSaveAnalysisReview = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => analysisReviews.saveReview(data, requireCaller(context)));
exports.adminExportAnalysisReviews = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => analysisReviews.exportReviews(data, requireCaller(context)));

exports.redeemPlayerSignupCode = functions.https.onCall((data, context) =>
  admission.redeemPlayerSignupCode({ ...requireCaller(context), code: data?.code })
);
exports.joinOrganization = functions.https.onCall((data, context) =>
  admission.joinOrganization({ ...requireCaller(context), role: data?.role, code: data?.code, firstName: data?.firstName, lastName: data?.lastName })
);
exports.createOrganization = functions.https.onCall((data, context) =>
  admission.createOrganization({ ...requireCaller(context), firstName: data?.firstName, lastName: data?.lastName, name: data?.name })
);
exports.attachPlayerByCode = functions.https.onCall((data, context) =>
  admission.attachPlayerByCode({ ...requireCaller(context), code: data?.code })
);

/** Whitelisted team standings for the athlete's own roster (team-leaderboard.js). */
exports.getTeamLeaderboard = functions.https.onCall((data, context) =>
  teamLeaderboard.getTeamLeaderboard({ ...requireCaller(context), teamId: data?.teamId })
);

/**
 * Public marketing pages may not read waitlist submissions (they carry parent
 * and child names); the remaining-spot figure is an aggregate computed here.
 */
const PUBLIC_SPOT_TOTALS = { subscriptionWaitlist: 50 };
exports.getPublicSpotCount = functions.https.onCall(async (data) => {
  const collection = String(data?.collection || "");
  if (!Object.hasOwn(PUBLIC_SPOT_TOTALS, collection)) {
    throw new functions.https.HttpsError("invalid-argument", "Unknown reservation list.");
  }
  const total = PUBLIC_SPOT_TOTALS[collection];
  const aggregate = await db.collection(collection).count().get();
  return { total, remaining: Math.max(0, total - (aggregate.data().count || 0)) };
});

/**
 * stripeWebhook
 *
 * Handles verified Stripe webhooks:
 * - checkout.session.completed — premium unlock (mode payment) OR subscription waitlist (mode subscription)
 * - payment_intent.succeeded — performance_test bookings (bookPerformanceTest.html)
 * - invoice.payment_succeeded / invoice.payment_failed — subscription billing (waitlist)
 * - customer.subscription.deleted — subscription cancelled (waitlist)
 *
 * Register all handled event types on this endpoint in the Stripe Dashboard.
 */

async function handleSubscriptionCheckoutCompleted(session) {
  const waitlistDocId = session.client_reference_id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!waitlistDocId || !subscriptionId) {
    console.warn(
      "Subscription checkout missing client_reference_id or subscription:",
      session.id
    );
    return;
  }
  const stripeEmail = session.customer_details?.email || null;
  await db.collection("subscriptionWaitlist").doc(waitlistDocId).update({
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: session.customer || null,
    subscriptionStatus: "trialing",
    stripeEmail: stripeEmail,
    stripeCheckoutSessionId: session.id,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Waitlist ${waitlistDocId} subscription recorded (${subscriptionId})`);
}

async function findWaitlistDocByStripeSubscriptionId(subscriptionId) {
  const snap = await db
    .collection("subscriptionWaitlist")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function handleInvoicePaymentSucceeded(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  // Skip $0 invoices (e.g. trial line items) — first real charge has amount_paid > 0
  if (!invoice.amount_paid || invoice.amount_paid <= 0) {
    console.log("Skipping zero-amount invoice for subscription", subId);
    return;
  }
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) {
    console.log("No waitlist doc for subscription invoice:", subId);
    return;
  }
  await doc.ref.update({
    subscriptionStatus: "active",
    firstChargedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked active after payment:", subId);
}

async function handleInvoicePaymentFailed(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "past_due",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked past_due:", subId);
}

async function handleSubscriptionDeleted(subscription) {
  const subId = subscription.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "cancelled",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked cancelled:", subId);
}

async function handlePremiumPaymentCheckoutCompleted(session) {
  const playerDocId = session.client_reference_id;
  const customerEmail = session.customer_details?.email || null;
  const amountPaid = session.amount_total ? session.amount_total / 100 : null;

  const purchaseData = {
    stripeSessionId: session.id,
    playerDocId: playerDocId || null,
    customerEmail: customerEmail,
    amountPaid: amountPaid,
    currency: session.currency || "usd",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection("premiumPurchases").add(purchaseData);
    console.log("Purchase record written:", session.id);
  } catch (err) {
    console.error("Failed to write purchase record:", err);
  }

  if (playerDocId) {
    try {
      await db.collection("players").doc(playerDocId).update({
        premium_content_locked: false,
        premiumPurchasedAt: admin.firestore.FieldValue.serverTimestamp(),
        premiumStripeSessionId: session.id,
      });
      console.log(`Unlocked premium for player: ${playerDocId}`);
    } catch (err) {
      console.error(`Failed to unlock premium for player ${playerDocId}:`, err);
      throw err;
    }
  } else {
    console.log("Guest purchase (no playerDocId) — email:", customerEmail);
  }
}

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const stripeClient = stripe(functions.config().stripe.secret_key);
  const webhookSecret = functions.config().stripe.webhook_secret;

  // Verify the event came from Stripe
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(
      req.rawBody, // raw buffer — required for signature verification
      req.headers["stripe-signature"],
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    if (pi.metadata && pi.metadata.booking_type === "performance_test") {
      try {
        await db.collection("performanceTestBookings").add({
          fullName: pi.metadata.fullName || null,
          email: pi.metadata.email || null,
          appointmentDate: pi.metadata.appointmentDate || null,
          timeSlot: pi.metadata.timeSlot || null,
          stripePaymentIntentId: pi.id,
          amountPaid: pi.amount_received ? pi.amount_received / 100 : null,
          currency: pi.currency || "usd",
          bookedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("Performance test booking recorded:", pi.id);
      } catch (err) {
        console.error("Failed to record performance test booking:", err);
      }
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "invoice.payment_succeeded") {
    try {
      await handleInvoicePaymentSucceeded(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentSucceeded failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "invoice.payment_failed") {
    try {
      await handleInvoicePaymentFailed(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentFailed failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    try {
      await handleSubscriptionDeleted(event.data.object);
    } catch (err) {
      console.error("handleSubscriptionDeleted failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (
      session.mode === "subscription" &&
      session.client_reference_id &&
      session.subscription
    ) {
      try {
        await handleSubscriptionCheckoutCompleted(session);
      } catch (err) {
        console.error("handleSubscriptionCheckoutCompleted failed:", err);
        return res.status(500).send("Failed to update subscription waitlist");
      }
      return res.status(200).json({ received: true });
    }

    // One-time premium purchase (Payment Link / createPremiumCheckoutSession)
    if (session.mode === "payment") {
      try {
        await handlePremiumPaymentCheckoutCompleted(session);
      } catch (err) {
        console.error("handlePremiumPaymentCheckoutCompleted failed:", err);
        const playerDocId = session.client_reference_id;
        if (playerDocId) {
          return res.status(500).send("Failed to unlock premium");
        }
      }
      return res.status(200).json({ received: true });
    }

    console.log(
      "checkout.session.completed ignored (mode:",
      session.mode,
      ")"
    );
    return res.status(200).json({ received: true });
  }

  return res.status(200).send("Ignored event type");
});

/**
 * createPerformanceTestPaymentIntent
 *
 * HTTPS endpoint (CORS-enabled) that creates a Stripe PaymentIntent for the
 * performance-test booking page. The client mounts Stripe Payment Element with
 * the returned clientSecret — card data never touches PoseTek servers.
 *
 * Configure amount (cents): firebase functions:config:set performance_test.amount_cents="5000"
 */
exports.createPerformanceTestPaymentIntent = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const { fullName, email, appointmentDate, timeSlot } = body || {};
    if (!fullName || !email || !appointmentDate || !timeSlot) {
      return res.status(400).json({
        error: "Missing required fields: fullName, email, appointmentDate, timeSlot",
      });
    }

    const stripeClient = stripe(functions.config().stripe.secret_key);
    const amountCents = Number(
      functions.config().performance_test?.amount_cents || 5000
    );

    try {
      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: String(email).trim(),
        metadata: {
          booking_type: "performance_test",
          fullName: String(fullName).trim().slice(0, 200),
          email: String(email).trim().slice(0, 200),
          appointmentDate: String(appointmentDate).slice(0, 50),
          timeSlot: String(timeSlot).slice(0, 50),
        },
      });

      return res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        amountCents: amountCents,
      });
    } catch (err) {
      console.error("createPerformanceTestPaymentIntent failed:", err);
      return res.status(500).json({
        error: "Could not start payment. Please try again later.",
      });
    }
  }
);

/**
 * createPremiumCheckoutSession
 *
 * Creates a Stripe Checkout Session (one-time payment) with client_reference_id = player
 * Firestore doc ID. Webhook checkout.session.completed unlocks premium (see stripeWebhook).
 *
 * Configure optional price override (cents):
 *   firebase functions:config:set premium.amount_cents="3000"
 * Public site URL for success/cancel redirects:
 *   firebase functions:config:set site.public_url="https://yourdomain.com"
 */
exports.createPremiumCheckoutSession = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const playerDocId =
      body && body.playerDocId ? String(body.playerDocId).trim() : "";
    if (!playerDocId) {
      return res.status(400).json({ error: "playerDocId required" });
    }

    let siteUrl =
      (functions.config().site && functions.config().site.public_url) ||
      "https://kickai-69dd0.web.app";
    siteUrl = siteUrl.replace(/\/$/, "");

    const amountCents = Number(
      functions.config().premium?.amount_cents || 3000
    );

    const stripeClient = stripe(functions.config().stripe.secret_key);

    const successUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=success`;
    const cancelUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=cancelled`;

    try {
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        client_reference_id: playerDocId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "PoseTek Premium Access",
                description:
                  "Full premium analysis features for your athlete profile",
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("createPremiumCheckoutSession failed:", err);
      return res.status(500).json({
        error: "Could not start checkout. Please try again later.",
      });
    }
  }
);

/**
 * aiCoachStreamProxy
 *
 * The native app can call the Cloud Run SSE endpoint directly. Browsers cannot
 * because that endpoint intentionally has no public CORS policy, so this thin
 * authenticated proxy preserves the same streaming contract for posetek.net.
 */
exports.aiCoachStreamProxy = functions
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const origin = req.get("origin") || "";
    if (allowedAiCoachWebOrigin(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, X-Firebase-AppCheck, X-PoseTek-Request-Id, X-PoseTek-Client"
    );
    res.set("Access-Control-Expose-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return allowedAiCoachWebOrigin(origin)
        ? res.status(204).send("")
        : res.status(403).send("Origin not allowed");
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!allowedAiCoachWebOrigin(origin)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: { code: "unauthenticated", message: "Sign in required." } });
    }

    try {
      await admin.auth().verifyIdToken(match[1]);
    } catch (error) {
      console.warn("aiCoachStreamProxy rejected token", error.message);
      return res.status(401).json({ error: { code: "unauthenticated", message: "Your sign-in has expired." } });
    }

    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const headers = {
      Authorization: authorization,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    const appCheck = req.get("x-firebase-appcheck");
    if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
    // Contract §16: the gateway keys its aiIncidents doc on this id. Only a
    // lowercase UUID v4 is forwarded (the gateway mints one otherwise), and
    // the client tag is always web/... so a browser cannot label itself as
    // smoke/test traffic through the proxy.
    const requestId = req.get("x-posetek-request-id") || "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
      headers["X-PoseTek-Request-Id"] = requestId;
    }
    const clientTag = String(req.get("x-posetek-client") || "").slice(0, 64);
    headers["X-PoseTek-Client"] = clientTag.startsWith("web/") ? clientTag : "web/proxy";

    try {
      const upstream = await fetch(AI_COACH_GATEWAY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body || {}),
        signal: controller.signal,
      });

      res.status(upstream.status);
      res.set("Content-Type", upstream.headers.get("content-type") || "text/event-stream; charset=utf-8");
      res.set("Cache-Control", "no-cache, no-transform");
      res.set("X-Accel-Buffering", "no");
      if (!upstream.body) return res.end();

      for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        res.write(Buffer.from(chunk));
      }
      if (!res.destroyed) res.end();
    } catch (error) {
      if (error.name === "AbortError" || res.destroyed) return;
      console.error("aiCoachStreamProxy failed", error);
      if (!res.headersSent) {
        return res.status(502).json({ error: { code: "provider_error", message: "AI Coach is temporarily unavailable." } });
      }
      res.end();
    }
  });
