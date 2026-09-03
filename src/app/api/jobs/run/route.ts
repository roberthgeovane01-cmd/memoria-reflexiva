import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession, UnauthenticatedError } from "@/lib/supabase/server";
import { runPendingJobs } from "@/services/jobs/runner";

/** Ingestão de livros longos leva tempo; a função precisa de fôlego. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { supabase, workspaceId, userId } = await requireSession();

    const outcomes = await runPendingJobs(supabase, {
      workspaceId,
      userId,
      workerId: `web-${randomUUID().slice(0, 8)}`,
      maxJobs: 5,
      deadlineMs: 260_000,
    });

    const failed = outcomes.filter((o) => o.status === "failed");
    return NextResponse.json(
      { ok: failed.length === 0, processed: outcomes.length, outcomes },
      { status: failed.length === 0 ? 200 : 207 },
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "erro desconhecido" },
      { status: 500 },
    );
  }
}
