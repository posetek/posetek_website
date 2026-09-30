"use strict";

// Canonical qualified result projection shared by athlete readers and Insights.
const { millis, drillOf, qualifyRep } = require("./insights-v2-qualification");
const { playerSegment } = require("./athlete-storage-paths");
const NUMBERS = ["jumpHeight", "jump_height_m", "jump_height_in", "jump_height_inches", "broadJumpDistance", "velocity", "max_velocity", "maxVelocity", "average_velocity", "averageVelocity", "max_acceleration", "maxAcceleration", "time_to_max_velocity", "timeToMaxVelocity", "totalTime", "distance", "totalDistance", "outboundDistance", "returnDistance", "phase1Time", "phase2Time", "phase3Time", "phase1Percent", "phase2Percent", "phase3Percent", "avgBallDistance", "markerDistance", "launch_angle", "launchAngle", "startFrame", "endFrame", "apexFrame", "peakFrame", "takeoffFrame", "landingFrame", "phase1EndFrame", "phase2EndFrame", "contact_frame", "transition_frame"];
const LABELS = ["strike_foot", "dribble_foot", "footSide", "direction", "gateStartSide"];
function resultStatus(rep, qualified) {
  return { qualified: Boolean(qualified.qualified), reason: qualified.reason, duplicate: Boolean(qualified.duplicate),
    revisionId: qualified.reason === "acceptedRevision" ? rep.adminRevision.revisionId : null };
}
function effectiveRep(rep, evidence, duplicate) {
  const qualification = qualifyRep(rep, evidence, duplicate);
  const output = { id: rep.id, repType: drillOf(rep), drillType: drillOf(rep), createdAtMillis: millis(rep.createdAt),
    resultStatus: resultStatus(rep, qualification) };
  // A station attempt that failed processing, as older app builds committed it. Readers hide
  // it from athletes and coaches; the app now repeats the slot instead of writing one.
  if (rep.processingStatus === "failed" && rep.resultsValid === false) output.failedAttempt = true;
  for (const key of ["sessionNumber", "repNumber", "absoluteRepNumber"]) output[key] = Number.isSafeInteger(rep[key]) && rep[key] > 0 ? rep[key] : null;
  for (const key of ["sessionId", "trainingSessionId"]) if (playerSegment(rep[key])) output[key] = rep[key];
  if (typeof rep.captureId === "string" && /^[a-f0-9]{32}$/.test(rep.captureId)) output.captureId = rep.captureId;
  for (const key of NUMBERS) {
    // Explicit nulls from reviewed revisions must never be revived by metadata.
    const value = Object.hasOwn(rep, key) ? rep[key] : evidence.metadata?.[key];
    output[key] = qualification.qualified && typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (qualification.qualified && qualification.metric?.field === "jumpHeight") output.jumpHeight = qualification.metric.value;
  if (drillOf(rep) === "broadJump" && (!(output.jumpHeight > 0)
    || rep.metricValidity?.jumpHeight === false || evidence.metadata?.metricValidity?.jumpHeight === false)) output.jumpHeight = null;
  if (["jump", "broadJump"].includes(drillOf(rep))) {
    output.jump_height_m = output.jumpHeight;
    output.jump_height_in = output.jumpHeight === null ? null : output.jumpHeight * 39.37007874015748;
    output.jump_height_inches = output.jump_height_in;
  }
  if (drillOf(rep) === "jump" && qualification.qualified && !Object.hasOwn(rep, "peakFrame") && output.peakFrame === null) {
    const frames = evidence.keyFrames;
    if (Array.isArray(frames) && frames.length === 4 && Number.isSafeInteger(evidence.frameCount) && evidence.frameCount > 0
      && frames.every((frame, index) => Number.isSafeInteger(frame) && frame >= 0 && frame < evidence.frameCount && (!index || frame >= frames[index - 1]))) output.peakFrame = frames[3];
  }
  for (const [a, b] of [["max_velocity", "maxVelocity"], ["average_velocity", "averageVelocity"], ["max_acceleration", "maxAcceleration"], ["time_to_max_velocity", "timeToMaxVelocity"], ["launch_angle", "launchAngle"]]) {
    const sources = qualification.reason === "acceptedRevision" ? [evidence.revision?.fields, rep, evidence.metadata] : [rep, evidence.metadata];
    const source = sources.find(value => value && (Object.hasOwn(value, a) || Object.hasOwn(value, b)));
    const raw = source && (Object.hasOwn(source, a) ? source[a] : source[b]);
    const value = qualification.qualified && typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    output[a] = value; output[b] = value;
  }
  for (const key of LABELS) {
    const value = Object.hasOwn(rep, key) ? rep[key] : evidence.metadata?.[key];
    output[key] = qualification.qualified && typeof value === "string" && /^[A-Za-z_-]{1,40}$/.test(value) ? value : null;
  }
  return output;
}
module.exports = { effectiveRep, resultStatus };
