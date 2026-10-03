import { NextResponse } from "next/server";
import { publicPage } from "@/lib/content/pages";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const page = await publicPage((await params).slug);
    return NextResponse.json(page ?? { error: "Page not found." }, {
      status: page ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Page temporarily unavailable." },
      { status: 503 },
    );
  }
}
