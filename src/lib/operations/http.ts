import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

export class OperationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const uuid = z.uuid();
export const text = z.string().trim().min(1).max(200);
import { privateHeaders } from "@/lib/auth/policy";
export { privateHeaders };
export function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: privateHeaders });
}
export async function body<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new OperationError(400, "JSON body required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new OperationError(413, "Body too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OperationError(400, "Invalid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new OperationError(
      400,
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  return parsed.data;
}
export function failure(error: unknown) {
  if (error instanceof OperationError)
    return reply({ error: error.message }, error.status);
  // PostgreSQL connector versions can surface a Restrict FK violation as an
  // unknown Prisma error. Classify it without logging its SQL or parameters.
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.toLowerCase().includes("foreign key constraint")
  )
    return reply(
      { error: "This record is referenced and cannot be deleted." },
      409,
    );
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003", "P2004", "P2014", "P2025"].includes(error.code)
  )
    return reply(
      {
        error:
          "This change conflicts with existing records. Keep referenced records and cancel or deactivate instead.",
      },
      error.code === "P2025" ? 404 : 409,
    );
  // Never log user input, tokens, password hashes or provider responses.
  console.error(
    "[operations] unexpected error",
    error instanceof Error ? error.name : "unknown",
  );
  return reply({ error: "The operation could not be completed." }, 500);
}
export function paging(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(q.get("page") ?? 1);
  return { page, take: 25, skip: (page - 1) * 25, q };
}
