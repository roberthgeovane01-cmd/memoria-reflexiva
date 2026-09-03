import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { aiCapabilities } from "@/lib/env";
import { getSession } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const { data: workspace } = await session.supabase
    .from("workspaces")
    .select("name")
    .eq("id", session.workspaceId)
    .maybeSingle();

  return (
    <AppShell
      user={{
        displayName: session.displayName,
        workspaceName: (workspace?.name as string) ?? "Sua biblioteca",
      }}
      demoMode={aiCapabilities().demoMode}
    >
      {children}
    </AppShell>
  );
}
