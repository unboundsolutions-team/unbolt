import { Reveal } from "@/components/motion/reveal";
import { COMMITMENTS } from "@/content/site";

/**
 * Contractual commitments, NOT measured outcomes.
 *
 * §10 of the brief blocks asserting medians or success rates until Unbound can
 * defend the figures — inventing proof numbers is one of the things we
 * criticised the competitor for. Everything here is something we control.
 */
export function Commitments() {
  return (
    <div className="grid gap-px border-y border-line bg-line [&>*]:min-w-0 sm:grid-cols-3">
      {COMMITMENTS.map((c, i) => (
        <Reveal key={c.label} delay={i * 0.08}>
          <div className="flex h-full flex-col gap-2 bg-base px-7 py-9">
            <span className="font-display text-3xl font-extrabold tracking-[-0.045em] text-ink">
              {c.value}
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
              {c.label}
            </span>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
