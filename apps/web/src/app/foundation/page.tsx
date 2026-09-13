import type { Metadata } from "next";
import type { ReactNode } from "react";

import { periodIncome } from "@cobudget/budget-domain/income";
import {
  setupPreview,
  validateCadenceDefinition,
  weeklyMonthlyBoundaries,
  type WeeklyOrMonthlyDefinition,
} from "@cobudget/budget-domain/schedule";
import { toISODate } from "@cobudget/budget-domain/shared";
import { fullPeriodTargets, type BaseTargetSet } from "@cobudget/budget-domain/targets";

import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Checkbox, Radio } from "../../components/Choice";
import { Dialog } from "../../components/Dialog";
import { Input } from "../../components/Input";
import { Link } from "../../components/Link";
import { Select } from "../../components/Select";
import { Table } from "../../components/Table";

/**
 * The review surface CBD-125 requires: every component, every state, both
 * themes, one page. A Server Component; the only client code on it is the
 * Dialog's trigger.
 *
 * Both themes at once: each column sets its own `color-scheme` through the
 * `scheme-light` / `scheme-dark` rules in globals.css (a stylesheet rule, not
 * an inline style — see the comment there), and because the tokens are
 * `@theme inline`, every utility inside resolves against it. No component
 * knows. Hover, active, and focus-visible are forced with
 * `data-state` (see styles/states.css); the other states are real attributes
 * or real data.
 *
 * The children are rendered once per column, so anything carrying an `id` or
 * a radio `name` derives it from the column's scheme — two copies of one id
 * would break label and error association in the second column.
 *
 * Not linked from anywhere and marked noindex: this is a working surface for
 * review, not a customer page.
 */
export const metadata: Metadata = {
  title: "Foundation",
  robots: { index: false, follow: false },
};

type Scheme = "light" | "dark";

const FORCED = ["hover", "active", "focus-visible"] as const;

const slug = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: (scheme: Scheme) => ReactNode;
}) {
  const id = `${slug(title)}-heading`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      {note && <p className="max-w-prose text-on-surface-muted">{note}</p>}
      <div className="grid gap-6 md:grid-cols-2">
        {(["light", "dark"] as const).map((scheme) => (
          <div
            key={scheme}
            className={`scheme-${scheme} flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 text-on-surface`}
          >
            <p className="text-sm font-semibold uppercase tracking-widest text-on-surface-muted">{scheme}</p>
            {children(scheme)}
          </div>
        ))}
      </div>
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-on-surface-muted">{label}</p>
      {children}
    </div>
  );
}

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "count", label: "Items", numeric: true },
] as const;

const ROWS = [
  { name: "Groceries", role: "Category", count: 12 },
  { name: "Utilities", role: "Category", count: 4 },
];

function monthlyPreviewDefinition(): WeeklyOrMonthlyDefinition {
  const result = validateCadenceDefinition({
    cadence: "monthly",
    anchor: { kind: "day-of-month", day: 1 },
  });
  if (!result.ok || result.value.cadence !== "monthly") {
    throw new Error("The foundation monthly schedule fixture must be valid.");
  }
  return result.value;
}

const PREVIEW_DATE = toISODate("2026-09-12");
const PREVIEW_DEFINITION = monthlyPreviewDefinition();
const PREVIEW_PERIODS = setupPreview(
  weeklyMonthlyBoundaries(PREVIEW_DEFINITION),
  PREVIEW_DATE,
);
const PREVIEW_TARGETS: BaseTargetSet = {
  cadence: "monthly",
  currency: "USD",
  targets: [
    { categoryId: "groceries", amountMinorUnits: 60_000 },
    { categoryId: "utilities", amountMinorUnits: 24_000 },
  ],
};
const PREVIEW_ROWS = PREVIEW_PERIODS.map((period) => {
  const targets = fullPeriodTargets(PREVIEW_TARGETS, PREVIEW_DEFINITION.cadence, period);
  const [income] = periodIncome([period], [], [], { asOf: PREVIEW_DATE, links: [] });
  return {
    period: `${period.start} to ${period.end}`,
    target: targets.reduce((total, target) => total + target.amountMinorUnits, 0) / 100,
    income: (income?.expectedMinorUnits ?? 0) / 100,
  };
});

const PREVIEW_COLUMNS = [
  { key: "period", label: "Period" },
  { key: "target", label: "Targets", numeric: true },
  { key: "income", label: "Expected income", numeric: true },
] as const;

export default function Foundation() {
  return (
    <main className="mx-auto flex w-[min(100%,72rem)] flex-col gap-16 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="eyebrow">MoneyPact foundation</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Components and states</h1>
        <p className="max-w-prose text-on-surface-muted">
          Every component the product is assembled from, in every state it has, in both themes. States
          named in grey are forced for review; nothing here is styled differently from production.
        </p>
      </header>

      <Section title="Button">
        {() =>
          (["primary", "secondary", "danger"] as const).map((variant) => (
            <State key={variant} label={variant}>
              <div className="flex flex-wrap gap-3">
                <Button variant={variant}>Default</Button>
                {FORCED.map((state) => (
                  <Button key={state} variant={variant} data-state={state}>
                    {state}
                  </Button>
                ))}
                <Button variant={variant} disabled>
                  Disabled
                </Button>
                <Button variant={variant} loading>
                  Loading
                </Button>
              </div>
            </State>
          ))
        }
      </Section>

      <Section title="Input" note="For a text field, active is the focused, editing state; focus-visible is the same ring.">
        {(s) => (
          <>
            <Input id={`in-default-${s}`} label="Default" placeholder="Placeholder" hint="A hint under the field." />
            {FORCED.map((state) => (
              <Input key={state} id={`in-${state}-${s}`} label={state} defaultValue="Typed value" data-state={state} />
            ))}
            <Input id={`in-disabled-${s}`} label="Disabled" defaultValue="Cannot edit" disabled />
            <Input id={`in-loading-${s}`} label="Loading" defaultValue="Saving" loading />
            <Input id={`in-error-${s}`} label="Error" defaultValue="-5" error="Enter a positive amount." />
          </>
        )}
      </Section>

      <Section title="Select">
        {(s) => (
          <>
            <Select id={`sel-default-${s}`} label="Default" hint="Choose one.">
              <option>Monthly</option>
              <option>Weekly</option>
            </Select>
            {FORCED.map((state) => (
              <Select key={state} id={`sel-${state}-${s}`} label={state} data-state={state}>
                <option>Monthly</option>
              </Select>
            ))}
            <Select id={`sel-disabled-${s}`} label="Disabled" disabled>
              <option>Monthly</option>
            </Select>
            <Select id={`sel-loading-${s}`} label="Loading" loading>
              <option>Loading options</option>
            </Select>
            <Select id={`sel-error-${s}`} label="Error" error="Choose a cadence.">
              <option value="">—</option>
            </Select>
          </>
        )}
      </Section>

      <Section title="Checkbox and radio">
        {(s) => (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Checkbox id={`cb-default-${s}`} label="Default" />
              <Checkbox id={`cb-checked-${s}`} label="Checked" defaultChecked />
              {FORCED.map((state) => (
                <Checkbox key={state} id={`cb-${state}-${s}`} label={state} data-state={state} />
              ))}
              <Checkbox id={`cb-disabled-${s}`} label="Disabled" disabled defaultChecked />
              <Checkbox id={`cb-loading-${s}`} label="Loading" loading />
              <Checkbox id={`cb-error-${s}`} label="Error" error="Accept to continue." />
            </div>
            <div className="flex flex-col gap-2">
              <Radio id={`rd-default-${s}`} name={`rd-${s}`} label="Default" />
              <Radio id={`rd-checked-${s}`} name={`rd-${s}`} label="Checked" defaultChecked />
              {FORCED.map((state) => (
                <Radio key={state} id={`rd-${state}-${s}`} name={`rd-${state}-${s}`} label={state} data-state={state} />
              ))}
              <Radio id={`rd-disabled-${s}`} name={`rd-off-${s}`} label="Disabled" disabled />
              <Radio id={`rd-loading-${s}`} name={`rd-busy-${s}`} label="Loading" loading />
              <Radio id={`rd-error-${s}`} name={`rd-err-${s}`} label="Error" error="Pick one." />
            </div>
          </div>
        )}
      </Section>

      <Section title="Link" note="A link has no loading or error state: navigation happens or it does not.">
        {() => (
          <div className="flex flex-wrap gap-6">
            <Link href="/">Default</Link>
            {FORCED.map((state) => (
              <Link key={state} href="/" data-state={state}>
                {state}
              </Link>
            ))}
            <Link href="/" disabled>
              Disabled
            </Link>
          </div>
        )}
      </Section>

      <Section title="Card" note="Hover, focus-visible, and active exist only for a card that is a link. Error is the Alert's job.">
        {() => (
          <>
            <Card title="Default">Content that belongs together.</Card>
            {FORCED.map((state) => (
              <Card key={state} title={state} href="/" data-state={state}>
                A whole-card link.
              </Card>
            ))}
            <Card title="Disabled" href="/" disabled>
              A link that cannot be followed right now.
            </Card>
            <Card title="Loading" loading />
            <Card title="Empty">
              <p className="text-on-surface-muted">Nothing here yet.</p>
            </Card>
          </>
        )}
      </Section>

      <Section title="Dialog" note="Rendered open and inline for review; the trigger opens the modal version.">
        {() => (
          <>
            <Dialog title="Remove this category?" trigger="Open dialog">
              Its transactions stay in your history. This cannot be undone.
            </Dialog>
            <Dialog title="Remove this category?" trigger="Inline preview" open>
              Its transactions stay in your history. This cannot be undone.
            </Dialog>
          </>
        )}
      </Section>

      <Section title="Alert" note="Neutral informs; danger is the error state and interrupts.">
        {() => (
          <>
            <Alert title="Bank feed updated">Balances refresh automatically; the last update was this morning.</Alert>
            <Alert loading>Connecting to your bank.</Alert>
            <Alert tone="danger" title="Connection failed">
              We could not reach your bank. Nothing was changed.
            </Alert>
          </>
        )}
      </Section>

      <Section title="Table">
        {() => (
          <>
            <Table caption="Categories" columns={COLUMNS} rows={ROWS} />
            <Table caption="Loading" columns={COLUMNS} rows={[]} loading />
            <Table caption="Empty" columns={COLUMNS} rows={[]} emptyMessage="No categories yet." />
            <Table caption="Error" columns={COLUMNS} rows={[]} error="Categories could not be loaded." />
          </>
        )}
      </Section>

      <Section
        title="Budget-domain schedule preview"
        note="A deterministic review fixture consumed through the package's four public subpaths."
      >
        {() => <Table caption="Monthly budget preview" columns={PREVIEW_COLUMNS} rows={PREVIEW_ROWS} />}
      </Section>
    </main>
  );
}
