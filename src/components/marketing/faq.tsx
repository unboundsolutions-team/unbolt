import { Reveal } from "@/components/motion/reveal";
import { FAQS } from "@/content/site";

/**
 * Native <details> rather than a JS accordion: it is keyboard-operable, works
 * without hydration, and is findable by the browser's own in-page search —
 * which a div-based accordion is not.
 */
export function Faq({ items = FAQS }: { items?: readonly { q: string; a: string }[] }) {
  return (
    <div className="mt-12 border-t border-line">
      {items.map((item, i) => (
        <Reveal key={item.q} delay={i * 0.05}>
          <details className="group border-b border-line py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-extrabold tracking-[-0.03em] text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden="true"
                className="shrink-0 text-accent transition-transform duration-(--duration-base) ease-(--ease-out-expo) group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 max-w-[56ch] text-sm leading-[1.65] text-ink-2">{item.a}</p>
          </details>
        </Reveal>
      ))}
    </div>
  );
}
