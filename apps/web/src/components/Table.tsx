import type { ReactNode } from "react";

/**
 * The list primitive. A real table: columns are headers, rows are records,
 * and a screen reader gets both. Three collection states — loading, empty,
 * and error — replace the body with one announced row, so the header stays
 * put and the surface never collapses.
 */
export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface TableProps {
  caption: string;
  columns: readonly Column[];
  rows: readonly Readonly<Record<string, ReactNode>>[];
  loading?: boolean;
  /** Error state: the rows could not be produced; this message replaces them. */
  error?: string;
  /** Shown when there are no rows and nothing is wrong. */
  emptyMessage?: string;
}

export function Table({
  caption,
  columns,
  rows,
  loading = false,
  error,
  emptyMessage = "Nothing here yet.",
}: TableProps) {
  const cell = (numeric: boolean | undefined) => `px-4 py-3 ${numeric ? "text-right tabular-nums" : "text-left"}`;

  let body: ReactNode;
  if (loading) {
    body = (
      <tr>
        <td colSpan={columns.length} className="px-4 py-6 text-center text-on-surface-muted">
          Loading…
        </td>
      </tr>
    );
  } else if (error) {
    body = (
      <tr>
        <td colSpan={columns.length} role="alert" className="px-4 py-6 text-center font-semibold text-danger">
          {error}
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} className="px-4 py-6 text-center text-on-surface-muted">
          {emptyMessage}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row, index) => (
      <tr key={index} className="border-t border-border">
        {columns.map((column) => (
          <td key={column.key} className={cell(column.numeric)}>
            {row[column.key]}
          </td>
        ))}
      </tr>
    ));
  }

  return (
    // `tabIndex`/`role`/`aria-label` are unconditional, not conditional on whether the content actually
    // overflows: axe's `scrollable-region-focusable` rule (WCAG 2.1.1/4.1.2) checks the potentially-scrollable
    // container regardless of the current viewport, and there is no reliable, render-time way to know here
    // whether this table is wider than its column will be at every width the page is later resized or zoomed
    // to. Always keyboard-reachable and named is harmless when the content happens to fit -- nothing else about
    // size or tab order changes -- and correct whenever it does not. UI-P04 (CBD-358) surfaced the gap against
    // a real caption/columns combination at 320 px; fixed here once for every consumer of Table.
    <div tabIndex={0} role="region" aria-label={caption} className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table aria-busy={loading || undefined} className="w-full border-collapse text-on-surface">
        <caption className="px-4 py-3 text-left font-semibold">{caption}</caption>
        <thead>
          <tr className="border-t border-border bg-surface text-sm text-on-surface-muted">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`${cell(column.numeric)} font-semibold`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
