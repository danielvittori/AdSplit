import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Upload a creative image to Vercel Blob; returns its public URL.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "upload not configured — paste an image URL instead" }, { status: 503 });
    }
    if (!req.body) return NextResponse.json({ error: "no file" }, { status: 400 });
    const name = req.nextUrl.searchParams.get("name") || "creative.png";
    const ext = (name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
    const key = `creatives/${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}.${ext}`;
    const blob = await put(key, req.body, { access: "public", contentType: req.headers.get("content-type") || undefined });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "upload failed" }, { status: 500 });
  }
}
