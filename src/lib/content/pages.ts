import { db } from "@/lib/db";
export async function publicPage(slug: string) {
  if (!["about", "contact"].includes(slug)) return null;
  const page = await db.sitePage.findFirst({
    where: { slug, isPublished: true },
    select: { slug: true, title: true, body: true, updatedAt: true },
  });
  return page
    ? {
        slug: page.slug,
        title: page.title,
        body: page.body,
        updated_at: page.updatedAt.toISOString(),
      }
    : null;
}
