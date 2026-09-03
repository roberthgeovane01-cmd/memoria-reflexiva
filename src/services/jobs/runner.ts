import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestSourceVersion } from "@/services/library/ingest";

export type JobRow = {
  id: string;
  workspace_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  correlation_id: string;
  created_by: string | null;
};

export type JobOutcome = {
  jobId: string;
  kind: string;
  status: "completed" | "failed";
  result?: unknown;
  error?: string;
};

/**
 * Processamento assíncrono.
 *
 * A fila vive no PostgreSQL: `mr_claim_job` reivindica uma tarefa com
 * `FOR UPDATE SKIP LOCKED`, então dois workers nunca pegam a mesma. Retentativa
 * com backoff exponencial, idempotência por chave e correlation id para
 * rastrear a operação inteira. Sem serviço externo de fila no MVP.
 */
export async function runPendingJobs(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string | null;
    workerId: string;
    kinds?: string[];
    maxJobs?: number;
    deadlineMs?: number;
  },
): Promise<JobOutcome[]> {
  const maxJobs = input.maxJobs ?? 5;
  const deadline = Date.now() + (input.deadlineMs ?? 240_000);
  const outcomes: JobOutcome[] = [];

  for (let i = 0; i < maxJobs && Date.now() < deadline; i += 1) {
    const { data, error } = await supabase.rpc("mr_claim_job", {
      p_worker: input.workerId,
      p_kinds: input.kinds ?? null,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw error;

    const job = (data as JobRow[] | null)?.[0];
    if (!job) break;

    try {
      const result = await executeJob(supabase, job, input.userId);
      await supabase.rpc("mr_complete_job", {
        p_job_id: job.id,
        p_result: (result ?? {}) as Record<string, unknown>,
      });
      outcomes.push({ jobId: job.id, kind: job.kind, status: "completed", result });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      await supabase.rpc("mr_fail_job", { p_job_id: job.id, p_error: message.slice(0, 2000) });
      outcomes.push({ jobId: job.id, kind: job.kind, status: "failed", error: message });
    }
  }

  return outcomes;
}

async function executeJob(
  supabase: SupabaseClient,
  job: JobRow,
  userId: string | null,
): Promise<unknown> {
  switch (job.kind) {
    case "ingest_source": {
      const sourceVersionId = String(job.payload.source_version_id ?? "");
      if (!sourceVersionId) throw new Error("Job de ingestão sem source_version_id.");

      return ingestSourceVersion(supabase, {
        workspaceId: job.workspace_id,
        userId: userId ?? job.created_by,
        sourceVersionId,
        onProgress: async (progress, label) => {
          await supabase
            .from("processing_jobs")
            .update({ progress, progress_label: label })
            .eq("id", job.id);
        },
      });
    }

    default:
      throw new Error(
        `Tipo de job ainda não implementado no worker: ${job.kind}. ` +
          `Transcrição, investigação, escrita e voz rodam de forma síncrona nas suas ações.`,
      );
  }
}
