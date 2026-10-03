import { requirePageRole } from "@/lib/auth/page-auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

// Routing/auth smoke-test stub — NOT a UI (plain, unstyled). Now sits behind
// the (protected) layout, so reaching this text proves the whole chain:
// subdomain rewrite (or direct path) → session validation → STAFF/OWNER role
// check.
export default async function Page() {
  const user = await requirePageRole(["STAFF", "OWNER"], "/staff/login");
  const account = await db.staffUser.findUnique({ where: { id: user.id }, select: { mustChangePassword: true } });
  if (account?.mustChangePassword) redirect("/staff/password");
  return <main className="operations-site"><header className="op-header"><span className="brand">SILENT RAVE</span><span>Staff</span></header><section className="op-card"><h1>Ready for the door</h1><p>Signed in as {user.name}. Prepare this device while connected before the event.</p><a className="op-button" href="/scanner.html">Open door scanner</a><p>With internet, multiple scanners can check in guests against the server. During an outage, use one offline scanner for the whole event.</p><p>Prepared ticket lists contain holder names and admission status only.</p><a href="/staff/password">Change password</a></section></main>;
}
