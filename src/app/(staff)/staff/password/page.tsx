import { requirePageRole } from "@/lib/auth/page-auth";
import { PasswordForm } from "@/components/operations/password-form";
export default async function Page() { await requirePageRole(["STAFF", "OWNER"], "/staff/login"); return <main className="operations-site"><section className="op-card"><h1>Set your own password</h1><PasswordForm /></section></main>; }
