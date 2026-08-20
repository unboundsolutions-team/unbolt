"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { replyToTaskAction } from "@/server/actions/comments";
import type { ActionResult } from "@/server/actions/tasks";

export interface ThreadComment {
  id: string;
  body: string;
  isInternal: boolean;
  authorName: string | null;
  authorIsInternal: boolean;
  createdAt: string;
}

/**
 * The conversation on a task.
 *
 * This is the piece that was missing: a customer could be asked a question from
 * /admin and had nowhere to answer it, so the clarification loop ran through
 * email and the timeline quietly lied about why a task sat in review for days.
 *
 * Staff messages are visually distinct from the customer's own, because the
 * single most common misreading of a thread is not knowing who said what.
 */
export function CommentThread({
  taskId,
  comments,
  canReply,
}: {
  taskId: string;
  comments: readonly ThreadComment[];
  canReply: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    replyToTaskAction,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <section className="mt-10">
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
        Conversation {comments.length > 0 ? <span data-numeric>({comments.length})</span> : null}
      </h2>

      {comments.length === 0 ? (
        <p className="mt-4 font-sans text-sm text-ink-3">
          Nothing yet. If we need anything to get started, we&rsquo;ll ask here.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={cn(
                "min-w-0 rounded-(--radius-md) border px-4 py-3",
                comment.authorIsInternal
                  ? "border-accent/30 bg-accent/5"
                  : "border-line bg-raised",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-mono text-xs font-medium text-ink-2">
                  {comment.authorName ?? "Someone"}
                  {comment.authorIsInternal ? (
                    <span className="ml-2 font-normal text-accent">Unbolt</span>
                  ) : null}
                </span>
                <time
                  dateTime={comment.createdAt}
                  data-numeric
                  className="font-mono text-xs text-ink-3"
                >
                  {comment.createdAt.slice(0, 16).replace("T", " ")}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-pretty font-sans text-sm leading-[1.6] text-ink">
                {comment.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canReply ? (
        <form ref={formRef} action={formAction} className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="taskId" value={taskId} />
          <Textarea
            label="Reply"
            name="body"
            rows={3}
            required
            placeholder="Answer a question, or add anything that would help."
          />
          <div className="flex items-center justify-between gap-3">
            {state?.ok === false ? (
              <p role="alert" className="font-sans text-sm text-urgent">
                {state.error}
              </p>
            ) : (
              <span />
            )}
            <Button type="submit" variant="secondary" loading={pending}>
              Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-5 font-mono text-xs text-ink-3">
          Your role is read-only, so you can follow this but not reply.
        </p>
      )}
    </section>
  );
}
