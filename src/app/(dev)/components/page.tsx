import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { QueueBoard } from "@/components/product/queue-board";
import { SlaClock } from "@/components/product/sla-clock";
import { StatusPill, TASK_STATES } from "@/components/product/status";
import type { Task } from "@/components/product/task-card";
import { TaskCard } from "@/components/product/task-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { Rule } from "@/components/ui/rule";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text } from "@/components/ui/text";

/**
 * The component gallery. Not a marketing page — a review surface, so every
 * primitive can be seen against the real canvas at real sizes before M2 starts
 * composing pages out of them.
 *
 * It is `noindex` and lives in a route group so it never joins the sitemap.
 */
export const metadata: Metadata = {
  title: "Component gallery",
  robots: { index: false, follow: false },
};

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-10">
      <div className="mb-6 flex flex-col gap-1">
        <Text variant="eyebrow" as="h2">
          {title}
        </Text>
        {note ? (
          <Text variant="small" tone="faint" measure="prose">
            {note}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const demoTasks: Task[] = [
  {
    id: "1",
    ref: "UNB-312",
    title: "Variant swatches drop selection on mobile Safari",
    state: "in_progress",
    store: "northline.co",
    slaDeadline: new Date(Date.now() + 3.4 * 3600_000).toISOString(),
  },
  {
    id: "2",
    ref: "UNB-314",
    title: "Checkout abandons when a discount code is applied twice",
    state: "in_review",
    store: "northline.co",
    slaDeadline: new Date(Date.now() + 0.6 * 3600_000).toISOString(),
  },
  {
    id: "3",
    ref: "UNB-315",
    title: "Bundle builder should carry the parent product's metafields",
    state: "queued",
    store: "havenwear.com",
  },
  {
    id: "4",
    ref: "UNB-309",
    title: "Collection filters now persist through pagination",
    state: "shipped",
    store: "havenwear.com",
    shippedAt: "2d ago",
  },
];

export default function ComponentGallery() {
  return (
    <main id="main" className="pb-32">
      <Container className="pt-16">
        <div className="flex flex-col gap-3 pb-4">
          <Text variant="eyebrow">Unbolt · design system</Text>
          <Text variant="heading" as="h1">
            Nightshift
          </Text>
          <Text variant="body" measure="prose">
            Near-black canvas, lime-drift accent, Syne for display. Two further themes
            (Meridian, Flux) ship in globals.css and are selected by ACTIVE_THEME in
            src/lib/theme.ts. All three clear WCAG 2.2 AA;{" "}
            <code className="font-mono text-sm">npm run tokens:contrast</code> checks
            every theme and blocks CI.
          </Text>
        </div>

        <Row
          title="Palette"
          note="One accent, spent only on actionable things. Queued is deliberately colourless because nothing is happening to the task yet."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ["base", "bg-base"],
              ["raised", "bg-raised"],
              ["card", "bg-card"],
              ["inset", "bg-inset"],
              ["accent", "bg-accent"],
              ["accent-soft", "bg-accent-soft"],
              ["shipped", "bg-shipped"],
              ["shipped-soft", "bg-shipped-soft"],
              ["urgent", "bg-urgent"],
              ["urgent-soft", "bg-urgent-soft"],
              ["ink", "bg-ink"],
              ["ink-3", "bg-ink-3"],
            ].map(([name, cls]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <div className={`h-16 rounded-(--radius-md) border border-line ${cls}`} />
                <Text variant="monoSmall">{name}</Text>
              </div>
            ))}
          </div>
        </Row>

        <Row title="Type scale" note="Syne for display, Space Grotesk for reading, IBM Plex Mono for anything a machine produced — refs, timestamps, SLA clocks.">
          <div className="flex flex-col gap-5">
            <Text variant="display">Ship it this week</Text>
            <Text variant="heading">Task packs, limited concurrency</Text>
            <Text variant="subheading">What a plan actually buys you</Text>
            <Text variant="title">Response time, not resolution time</Text>
            <Text variant="body" measure="prose">
              Merchants pay a flat monthly fee, queue as many engineering tasks as they
              like, and watch senior engineers ship them — typically inside a week.
            </Text>
            <Text variant="mono">UNB-312 · 2026-08-16T09:41:00Z</Text>
            <Text variant="eyebrow">Section marker</Text>
          </div>
        </Row>

        <Row title="Buttons">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Start a plan</Button>
              <Button variant="secondary">View the queue</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Delete store</Button>
              <Button variant="link">Read the docs</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="primary" size="md">
                Medium
              </Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
              <Button variant="primary" loading>
                Provisioning
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-lg) border border-line bg-raised p-4">
              <Button variant="subtle">On the dark panel</Button>
              <Button variant="primary">Primary still works</Button>
            </div>
          </div>
        </Row>

        <Row title="Status vocabulary" note="Queued is deliberately colourless — nothing is happening yet, so nothing signals. Each pill carries a dot and a label, so colour is never the only channel.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {TASK_STATES.map((s) => (
                <StatusPill key={s} state={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2 rounded-(--radius-lg) border border-line bg-raised p-4">
              {TASK_STATES.map((s) => (
                <StatusPill key={s} state={s} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <SlaClock deadline={new Date(Date.now() + 5 * 3600_000).toISOString()} />
              <SlaClock deadline={new Date(Date.now() + 0.4 * 3600_000).toISOString()} />
              <SlaClock deadline={new Date(Date.now() - 3600_000).toISOString()} />
            </div>
          </div>
        </Row>

        <Row title="Badges, avatars, rules">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="neutral">Standard</Badge>
            <Badge tone="accent">Professional</Badge>
            <Badge tone="shipped">Active</Badge>
            <Badge tone="urgent">Past due</Badge>
            <Badge tone="outline">Trial</Badge>
            <Rule orientation="vertical" className="h-6" />
            <Avatar name="Riya Shah" size="sm" />
            <Avatar name="Marcus Webb" />
            <Avatar name="Anita Desai" size="lg" />
          </div>
        </Row>

        <Row title="Forms" note="Label, hint and error are wired to the control by id. No placeholder is ever used as a label.">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-5">
              <Input label="Store domain" placeholder="northline.co" hint="Your myshopify or custom domain." required />
              <Input label="Work email" type="email" error="That address is already on another organisation." defaultValue="ops@northline.co" />
              <Select
                label="Plan"
                placeholder="Choose a plan"
                hint="Concurrency is what the plan actually buys."
                options={[
                  { value: "standard", label: "Standard — 1 task at a time" },
                  { value: "professional", label: "Professional — 2 at a time" },
                  { value: "enterprise", label: "Enterprise — 4 at a time" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-5">
              <Textarea
                label="What needs doing?"
                placeholder="Describe it the way you'd describe it to a colleague."
                hint="Symptoms beat specifications. We'll ask if we need more."
              />
              <Checkbox label="Email me when a task ships" hint="One message per task, never a digest." defaultChecked />
              <Switch label="Pause the queue after this task" />
              <RadioGroup
                legend="Billing cadence"
                defaultValue="monthly"
                options={[
                  { value: "monthly", label: "Monthly", hint: "Cancel or pause any month." },
                  { value: "annual", label: "Annual", hint: "Two months free." },
                ]}
              />
            </div>
          </div>
        </Row>

        <Row title="Cards">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <Text variant="title">Standard</Text>
                <Text variant="small">1 task at a time · 48h response</Text>
              </CardHeader>
              <CardBody>
                <Text variant="display" as="p" className="text-3xl sm:text-4xl lg:text-4xl">
                  $499
                </Text>
              </CardBody>
              <CardFooter>
                <Button variant="secondary" size="sm" block>
                  Choose
                </Button>
              </CardFooter>
            </Card>
            <Card interactive>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Text variant="title">Professional</Text>
                  <Badge tone="accent">Most picked</Badge>
                </div>
                <Text variant="small">2 tasks at a time · 24h response</Text>
              </CardHeader>
              <CardBody>
                <Text variant="display" as="p" className="text-3xl sm:text-4xl lg:text-4xl">
                  $799
                </Text>
              </CardBody>
              <CardFooter>
                <Button variant="primary" size="sm" block>
                  Choose
                </Button>
              </CardFooter>
            </Card>
            <Card variant="outline">
              <CardHeader>
                <Text variant="title">Enterprise</Text>
                <Text variant="small">4 tasks at a time · same-day</Text>
              </CardHeader>
              <CardBody>
                <Text variant="display" as="p" className="text-3xl sm:text-4xl lg:text-4xl">
                  $1,499
                </Text>
              </CardBody>
              <CardFooter>
                <Button variant="secondary" size="sm" block>
                  Talk to us
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Row>

        <Row title="Tabs and table">
          <Tabs defaultValue="tasks">
            <TabsList>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
            </TabsList>
            <TabsContent value="tasks">
              <Table caption="Recent tasks across all stores">
                <thead>
                  <tr>
                    <Th>Ref</Th>
                    <Th>Task</Th>
                    <Th>Store</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {demoTasks.map((t) => (
                    <Tr key={t.id}>
                      <Td className="font-mono text-xs">{t.ref}</Td>
                      <Td className="text-ink">{t.title}</Td>
                      <Td className="font-mono text-xs">{t.store}</Td>
                      <Td>
                        <StatusPill state={t.state} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TabsContent>
            <TabsContent value="invoices">
              <Text variant="small">Invoice history lands in M6.</Text>
            </TabsContent>
            <TabsContent value="team">
              <Text variant="small">Team management lands in M3.</Text>
            </TabsContent>
          </Tabs>
        </Row>

        <Row title="Task card" note="Titles are written from the buyer's side — a symptom the merchant would recognise, never 'Bug fix #1'.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {demoTasks.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </Row>

        <Row
          title="Queue board"
          note="The signature element. It survived every design direction because the idea was never the palette — it is showing the product working on a public page, which is exactly what the competitor hides behind a login wall."
        >
          <QueueBoard tasks={demoTasks} concurrencyLimit={2} />
        </Row>

        <Row title="Loading states">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-full" />
              </CardHeader>
              <CardBody>
                <Skeleton className="h-3 w-2/3" />
              </CardBody>
            </Card>
          </div>
        </Row>
      </Container>
    </main>
  );
}
