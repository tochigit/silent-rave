import { EventDetailPage } from "@/components/customer/event-detail";
export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <EventDetailPage slug={(await params).slug} />;
}
