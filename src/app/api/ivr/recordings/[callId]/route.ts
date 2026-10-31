import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { calls } from "@/db/ivr-schema";
import { HttpError, assertUser, isAdminRole } from "@/lib/ivr/dal";

// Recordings are a few MB. When a file has to be read into memory to serve it properly, refuse anything bigger than this.
const MAX_BUFFER = 60 * 1024 * 1024;

// A buffered response is capped near 4.5 MB on Vercel; a stream is not, so a long recording is handed over as one.
const asStream = (b: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(b);
      c.close();
    },
  });

// Only fetch public https recordings. Blocks localhost and private ranges so a bad URL in call data cannot reach internal services.
function isSafeRemoteUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (h.includes(":")) return false; // IPv6 literal
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Streams a recording through the app so Smartflo URLs never reach the browser and access is checked per user.
function tone(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * Math.max(2, Math.min(seconds, 8));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    const f = 300 + 80 * Math.sin(i / 4000);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 3500 * env), 44 + i * 2);
  }
  return buf;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/ivr/recordings/[callId]">) {
  try {
    const user = await assertUser();
    const { callId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(callId)) return new NextResponse("Not found", { status: 404 });
    const [row] = await db
      .select({
        url: calls.recordingUrl,
        answeredSec: calls.answeredSec,
        callAgent: calls.agentUserId,
      })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    if (!row?.url) return new NextResponse("No recording", { status: 404 });
    // An agent hears only the calls they handled themselves.
    if (!isAdminRole(user.role) && row.callAgent !== user.id) {
      return new NextResponse("Not found", { status: 404 });
    }

    if (row.url.startsWith("mock://")) {
      return new NextResponse(new Uint8Array(tone(row.answeredSec)), {
        headers: { "content-type": "audio/wav", "cache-control": "private, max-age=300" },
      });
    }

    if (!isSafeRemoteUrl(row.url)) return new NextResponse("Recording unavailable", { status: 502 });
    const range = req.headers.get("range");
    const upstream = await fetch(row.url, { headers: range ? { range } : {}, cache: "no-store", redirect: "follow" });
    if (!upstream.ok && upstream.status !== 206) return new NextResponse("Recording unavailable", { status: 502 });
    const type = upstream.headers.get("content-type") || "audio/mpeg";
    const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };

    // The browser can only show the real length and let people skip around when it is told the total size and can ask for byte ranges.
    // Smartflo's storage does not always answer both, so in that case the file is read once here and served with correct headers.
    const total = Number(upstream.headers.get("content-length"));
    if (upstream.status === 206 || (upstream.status === 200 && !range && total > 0)) {
      const headers = new Headers(base);
      for (const h of ["content-length", "content-range"]) {
        const v = upstream.headers.get(h);
        if (v) headers.set(h, v);
      }
      return new NextResponse(upstream.body, { status: upstream.status, headers });
    }
    const declared = total > 0 ? total : 0;
    if (declared > MAX_BUFFER) return new NextResponse("Recording too large", { status: 413 });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > MAX_BUFFER) return new NextResponse("Recording too large", { status: 413 });
    const m = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, bytes.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
      if (start >= bytes.length || start > end) {
        return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${bytes.length}` } });
      }
      const part = bytes.subarray(start, end + 1);
      return new NextResponse(asStream(part), {
        status: 206,
        headers: { ...base, "content-length": String(part.length), "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new NextResponse(asStream(bytes), { status: 200, headers: { ...base, "content-length": String(bytes.length) } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
