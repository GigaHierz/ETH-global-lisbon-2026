import type { ReactNode } from "react";

// Panel shell used across the dashboard: bg-surface-container + hairline border.
// Per-instance classes (padding, layout, hover, etc.) come through `className`.
export default function Card({
  className = "",
  children,
  id,
}: {
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className={`bg-surface-container border border-outline-variant${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
