import { getSessionUser } from "@/lib/auth/page-auth";
import { LogoutButton } from "@/components/auth/logout-button";

// Routing/auth smoke-test stub — NOT a UI (plain, unstyled). Now sits behind
// the (protected) layout, so reaching this text proves the whole chain:
// subdomain rewrite (or direct path) → session validation → STAFF/OWNER role
// check.
export default async function Page() {
  const user = await getSessionUser();
  return (
    <main>
      <p>Staff route group</p>
      {user ? (
        <p>
          Signed in as {user.email} ({user.role})
        </p>
      ) : null}
      <LogoutButton loginPath="/staff/login" />
    </main>
  );
}
