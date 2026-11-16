interface PageHeadingProps {
  title: string;
  /** Data source label(s) this page reads/writes, e.g. ["Postgres"], shown small + muted. */
  sources?: string[];
  /** Extra classes for the heading (e.g. "mb-6" when it's not inside a flex header row). */
  className?: string;
}

/** Page title with its data source(s) appended in a smaller, muted font. */
export default function PageHeading({ title, sources, className = "" }: PageHeadingProps) {
  return (
    <h1 className={`text-2xl font-semibold text-slate-900 ${className}`}>
      {title}
      {sources && sources.length > 0 && (
        <span className="ml-2 text-sm font-normal text-slate-400">· {sources.join(" · ")}</span>
      )}
    </h1>
  );
}
