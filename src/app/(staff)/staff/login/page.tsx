import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

// Bare-minimum unstyled staff login page. Reached at /staff/login (direct
// path) or /login on staff.ROOT_DOMAIN (subdomain rewrite). OWNER accounts
// may also log in here (staff routes accept STAFF or OWNER).

export const metadata: Metadata = {
  title: "Staff login — Silent Rave",
};

export default function StaffLoginPage() {
  return (
    <main className="operations-site"><section className="op-card">
      <h1>Staff login</h1>
      <LoginForm intent="staff" />
    </section></main>
  );
}
