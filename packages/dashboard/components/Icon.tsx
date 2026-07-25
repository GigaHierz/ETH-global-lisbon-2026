// Material Symbols icon. Single source of truth — imported by every page.
export default function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}
