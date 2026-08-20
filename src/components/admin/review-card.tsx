"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  adminCommentAction,
  assignTaskAction,
  clearBlockAction,
  estimateTaskAction,
} from "@/server/actions/admin";
import type { ActionResult } from "@/server/actions/tasks";

export interface ReviewTask {
  id: string;
  reference: string;
  title: string;
  body: string | null;
  state: string;
  organizationId: string;
  organizationName: string;
  estimatedHours: number | null;
  blockedAt: string | null;
  blockedReason: string | null;
  maxTaskHours: number | null;
  commentCount: number;
  assignedTo: string | null;
  assigneeName: string | null;
}

export interface StaffOption {
  id: string;
  name: string | null;
  email: string;
}

/**
 * One task in the review queue.
 *
 * The estimate box is the primary control because estimating is the step that
 * gates everything else: an unsized task cannot start, and the customer is
 * watching an SLA clock while it waits.
 *
 * The customer's ceiling is shown next to the input rather than left implicit,
 * so whoever is estimating can see the moment they are about to hold somebody's
 * work — before they type the number, not after.
 */
export function ReviewCard({
  task,
  staff,
}: {
  task: ReviewTask;
  staff: readonly StaffOption[];
}) {
  const [estimate, estimateAction, estimating] = useActionState<
    ActionResult<{ blocked: boolean; message: string }> | null,
    FormData
  >(estimateTaskAction, null);

  const [comment, commentAction, commenting] = useActionState<ActionResult | null, FormData>(
    adminCommentAction,
    null,
  );

  const [unblock, unblockAction, unblocking] = useActionState<ActionResult | null, FormData>(
    clearBlockAction,
    null,
  );

  const [assign, assignAction, assigning] = useActionState<ActionResult | null, FormData>(
    assignTaskAction,
    null,
  );

  const [showComment, setShowComment] = useState(false);
  const blocked = task.blockedAt !== null;

  return (
    <article
      className={cn(
        "min-w-0 rounded-(--radius-lg) border bg-raised p-5",
        blocked ? "border-urgent/50" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <span data-numeric className="font-mono text-xs font-medium text-ink-3">
            {task.reference}
          </span>
          <h3 className="mt-1 text-pretty font-sans text-sm font-medium text-ink">{task.title}</h3>
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-3">{task.organizationName}</span>
      </header>

      {/* ── Owner ────────────────────────────────────────────── */}
      <form action={assignAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="taskId" value={task.id} />
        <label className="sr-only" htmlFor={`assignee-${task.id}`}>
          Assigned to
        </label>
        <select
          id={`assignee-${task.id}`}
          name="assigneeId"
          defaultValue={task.assignedTo ?? ""}
          className="h-8 rounded-(--radius-sm) border border-line-strong bg-card px-2 font-mono text-xs text-ink"
        >
          {/* An explicit "nobody" rather than a blank first option — releasing
              a task is a real action, not an oversight. */}
          <option value="">Unassigned</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ?? person.email}
            </option>
          ))}
        </select>
        <Button type="submit" variant="ghost" size="sm" loading={assigning}>
          {task.assignedTo === null ? "Assign" : "Reassign"}
        </Button>
        {assign?.ok === false ? (
          <span role="alert" className="font-mono text-xs text-urgent">
            {assign.error}
          </span>
        ) : null}
      </form>

      {task.body ? (
        <p className="mt-3 whitespace-pre-wrap text-pretty font-sans text-sm leading-[1.6] text-ink-2">
          {task.body}
        </p>
      ) : null}

      {blocked ? (
        <p className="mt-4 rounded-(--radius-md) border border-urgent/40 bg-urgent/5 px-3 py-2.5 font-sans text-xs leading-[1.6] text-ink-2">
          <span className="font-medium text-urgent">Held. </span>
          {task.blockedReason}
        </p>
      ) : null}

      {/* ── Estimate ─────────────────────────────────────────── */}
      <form action={estimateAction} className="mt-5 flex flex-wrap items-end gap-3">
        <input type="hidden" name="taskId" value={task.id} />
        <Input
          label="Estimate (hours)"
          name="hours"
          type="number"
          step="0.25"
          min="0"
          required
          defaultValue={task.estimatedHours ?? ""}
          containerClassName="w-40"
          hint={
            task.maxTaskHours === null
              ? "No ceiling on this account"
              : `Plan covers up to ${task.maxTaskHours}h`
          }
        />
        <Button type="submit" variant="secondary" size="md" loading={estimating}>
          {task.estimatedHours === null ? "Save estimate" : "Re-estimate"}
        </Button>

        {blocked ? (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => setShowComment((v) => !v)}
          >
            Absorb it anyway
          </Button>
        ) : null}
      </form>

      {estimate?.ok ? (
        <p
          role="status"
          className={cn(
            "mt-2 font-mono text-xs",
            estimate.data.blocked ? "text-urgent" : "text-shipped",
          )}
        >
          {estimate.data.message}
        </p>
      ) : null}
      {estimate?.ok === false ? (
        <p role="alert" className="mt-2 font-mono text-xs text-urgent">
          {estimate.error}
        </p>
      ) : null}

      {/* ── Lift a block deliberately ────────────────────────── */}
      {blocked && showComment ? (
        <form action={unblockAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="taskId" value={task.id} />
          <Input
            label="Why are we absorbing this?"
            name="reason"
            required
            placeholder="Long-standing customer, goodwill"
            containerClassName="flex-1 min-w-[16rem]"
          />
          <Button type="submit" variant="secondary" size="md" loading={unblocking}>
            Lift the hold
          </Button>
          {unblock?.ok === false ? (
            <p role="alert" className="w-full font-mono text-xs text-urgent">
              {unblock.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {/* ── Ask the customer something ───────────────────────── */}
      <details className="mt-5 border-t border-line pt-4">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-ink-3">
          Comment {task.commentCount > 0 ? `(${task.commentCount})` : ""}
        </summary>
        <form action={commentAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="organizationId" value={task.organizationId} />
          <Textarea
            label="Message"
            hideLabel
            name="body"
            rows={3}
            required
            placeholder="Which product page is this happening on?"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 font-mono text-xs text-ink-3">
              <input type="checkbox" name="isInternal" className="accent-[var(--color-accent)]" />
              Internal note — the customer never sees this
            </label>
            <Button type="submit" variant="secondary" size="sm" loading={commenting}>
              Post
            </Button>
          </div>
          {comment?.ok === false ? (
            <p role="alert" className="font-mono text-xs text-urgent">
              {comment.error}
            </p>
          ) : null}
        </form>
      </details>
    </article>
  );
}
