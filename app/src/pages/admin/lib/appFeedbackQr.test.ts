import { afterEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { generateFeedbackQrImage } from "./appFeedbackQr";

describe("local app feedback QR generation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("encodes the exact broad QR-source form URL into a local, high-contrast SVG with a quiet zone", async () => {
    const encode = vi.spyOn(QRCode, "toString");
    const image = await generateFeedbackQrImage();
    expect(encode).toHaveBeenCalledWith("https://posetek.net/feedback?source=qr", expect.objectContaining({ type: "svg", margin: 4, errorCorrectionLevel: "M" }));
    expect(image).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(image.slice(image.indexOf(",") + 1));
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="320"'); expect(svg).toContain('height="320"');
    expect(svg).toContain('stroke="#000000"'); expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("http://posetek"); expect(svg).not.toContain("<script"); expect(svg).not.toContain("<image");
  });

  it("lets a local encoder failure reach the UI's retry/manual-link state", async () => {
    vi.spyOn(QRCode, "toString").mockRejectedValue(new Error("encoder unavailable"));
    await expect(generateFeedbackQrImage()).rejects.toThrow("encoder unavailable");
  });
});
