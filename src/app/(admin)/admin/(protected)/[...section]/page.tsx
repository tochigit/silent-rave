import { notFound } from "next/navigation";
import { OwnerPanel } from "@/components/operations/owner";
export default async function Page({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  if (!["payments", "orders", "events", "venues", "organizers", "pages", "payment-accounts", "staff", "reconciliation", "email-jobs", "audit-log"].includes(section[0]) || section.length > 2) notFound();
  return <OwnerPanel section={section} />;
}
