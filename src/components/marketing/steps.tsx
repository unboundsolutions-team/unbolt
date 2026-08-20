import { Reveal } from "@/components/motion/reveal";
import { STEPS } from "@/content/site";

/**
 * The three-step explainer. Numbered because the content genuinely is
 * sequential — the brief restricts numbering to exactly that case.
 */
export function Steps({ headingLevel = 3 }: { headingLevel?: 2 | 3 } = {}) {
  // Same reason as PlanCards: the right level depends on whether a section h2
  // sits above this, which only the page knows. Under the hero h1 on
  // /how-it-works, a hardcoded h3 skipped a level.
  const Heading = `h${headingLevel}` as "h2" | "h3";
  return (
    <div className="mt-14 grid gap-px border border-line bg-line [&>*]:min-w-0 lg:grid-cols-3">
      {STEPS.map((step, i) => (
        <Reveal key={step.title} delay={i * 0.08}>
          <div className="h-full bg-base p-8 transition-colors duration-(--duration-base) hover:bg-raised">
            <span className="font-mono text-xs tracking-[0.16em] text-accent">
              {String(i + 1).padStart(2, "0")}
            </span>
            <Heading className="mt-5 font-display text-xl font-extrabold leading-[1.1] tracking-[-0.03em] text-ink">
              {step.title}
            </Heading>
            <p className="mt-3 text-sm leading-[1.6] text-ink-2">{step.body}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
