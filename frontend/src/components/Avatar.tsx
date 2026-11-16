function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Circular initials badge. "md" (36px) for headers, "sm" (22px) for inline rows. */
export default function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-[22px] w-[22px] text-[9px]" : "h-9 w-9 text-[13px]";
  return (
    <div
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700`}
    >
      {initials(name)}
    </div>
  );
}
