import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

// Bare-minimum unstyled admin login page. Reached at /admin/login (direct
// path) or /login on admin.ROOT_DOMAIN (subdomain rewrite). No public signup
// route exists anywhere (06-auth-and-roles.md) — this page is the only entry
// point, and only OWNER accounts can use it.

export const metadata: Metadata = {
  title: "Admin login — Silent Rave",
};

export default function AdminLoginPage() {
  return (
    <main className="operations-site"><section className="op-card">
      <h1>Admin login</h1>
      <LoginForm intent="admin" />
    </section></main>
  );
}
