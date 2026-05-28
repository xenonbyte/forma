interface TokenCardProps {
  name: string;
  value: string;
}

export function TokenCard({ name, value }: TokenCardProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <span className="truncate font-mono text-xs text-zinc-500">{name}</span>
      <span className="truncate font-medium text-zinc-800">{value}</span>
    </div>
  );
}
