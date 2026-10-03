import { OwnerPanel } from "@/components/operations/owner";

// Routing/auth smoke-test stub — NOT a UI (plain, unstyled). Now sits behind
// the (protected) layout, so reaching this text proves the whole chain:
// subdomain rewrite (or direct path) → session validation → OWNER role check.
export default async function Page() {
  return <OwnerPanel />;
}
