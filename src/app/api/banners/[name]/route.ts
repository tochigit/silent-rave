import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[0-9a-f-]{36}\.webp$/.test(name))
    return new Response("Not found", { status: 404 });
  // Only expressly uploaded event banners are public; private proofs/PDFs can never match.
  if (
    !(await db.event.findFirst({
      where: { bannerImageUrl: `/api/banners/${name}` },
      select: { id: true },
    }))
  )
    return new Response("Not found", { status: 404 });
  let file;
  try { file = await getStorage().getObject(`banners/${name}`); }
  catch { return new Response("Banner temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
