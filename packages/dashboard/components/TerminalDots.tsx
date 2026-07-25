// Terminal traffic-light dots (red/orange/cyan). Gap + dot size vary per call site.
export default function TerminalDots({
  gapClassName,
  dotClassName,
}: {
  gapClassName: string;
  dotClassName: string;
}) {
  return (
    <div className={`flex ${gapClassName}`}>
      <div className={`${dotClassName} rounded-full bg-hud-error/40`} />
      <div className={`${dotClassName} rounded-full bg-accent-orange/40`} />
      <div className={`${dotClassName} rounded-full bg-accent-cyan/40`} />
    </div>
  );
}
