import { requirePageRole } from "@/lib/auth/page-auth";

// Server-side page gate for every /staff/* page (06-auth-and-roles.md):
// no valid STAFF-or-OWNER session → redirect to the login page BEFORE any
// page chrome renders. (OWNER is allowed: spec 03 lists staff routes as
// "role: STAFF or OWNER".)

export default async function StaffProtectedLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(["STAFF", "OWNER"], "/staff/login");
  return children;
}
