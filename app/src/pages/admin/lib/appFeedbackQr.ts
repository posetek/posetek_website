import { feedbackShareUrl } from "./appFeedback";

/** Loaded only from the lazy admin feedback view; no remote QR/image service. */
export async function generateFeedbackQrImage(): Promise<string> {
  const encoder = await import("qrcode");
  const svg = await encoder.default.toString(feedbackShareUrl("qr"), {
    type: "svg", errorCorrectionLevel: "M", margin: 4, width: 320,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
