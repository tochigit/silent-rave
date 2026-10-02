import { requirePageRole } from "@/lib/auth/page-auth";

// Server-side page gate for every /admin/* page (06-auth-and-roles.md):
// no valid OWNER session → redirect to the login page BEFORE any page chrome
// renders. Login pages live outside this (protected) group so they stay
// reachable. proxy.ts enforces the same check one layer earlier (defense in
// depth); this layout remains the non-negotiable enforcement point.

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(["OWNER"], "/admin/login");
  return children;
}
