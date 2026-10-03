import { OrderStatusPage } from "@/components/customer/order-status";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your private order · Silent Rave",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  return (
    <OrderStatusPage
      code={(await params).code}
      token={(await searchParams).t ?? ""}
    />
  );
}
