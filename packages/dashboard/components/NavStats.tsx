// Nav stats strip (label / value / color triples). The stats array is passed in
// by each page; the markup + classes are identical everywhere.
export default function NavStats({ stats }: { stats: Array<readonly [string, string, string]> }) {
  return (
    <div className="hidden xl:flex items-center gap-4 px-4 py-1.5 border border-outline-variant bg-surface-container-low rounded">
      {stats.map(([label, value, color], i) => (
        <div key={label} className={`flex flex-col ${i > 0 ? "border-l border-outline-variant pl-4" : ""}`}>
          <span className="font-data text-[10px] tracking-[0.1em] text-on-surface-variant">{label}</span>
          <span className={`font-data text-base font-medium ${color}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}
