"use strict";

const { createPerformanceTestBooking } = require("./performance-test-booking");
const { createBookingEmailProvider } = require("./performance-test-booking-provider");

// Export only through the dedicated booking release source. Do not deploy the
// root functions index to add this public endpoint or alter unrelated functions.
function createPerformanceTestBookingEntrypoints(functions, admin) {
  const service = createPerformanceTestBooking({ db: admin.firestore(),
    provider: createBookingEmailProvider({ apiKey: () => process.env.RESEND_API_KEY }) });
  return {
    requestPerformanceTestBooking: functions.runWith({ secrets: ["RESEND_API_KEY"], timeoutSeconds: 60, maxInstances: 5 })
      .https.onRequest(service.handler),
  };
}

module.exports = { createPerformanceTestBookingEntrypoints };
