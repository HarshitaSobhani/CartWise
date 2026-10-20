import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Point } from '../lib/types';
import { formatDate, formatMoney } from '../lib/format';

/** Plots only stored observations for one currency; never interpolates or fills gaps. */
export function PriceChart({ points, currency }: { points: Point[]; currency: string }) {
  const data = points.filter((p) => p.currency === currency).map((p) => ({ t: new Date(p.observedAt).getTime(), price: Number(p.price), source: p.sourceName, demo: p.isDemo }));
  if (data.length === 0) return <p className="p-6 text-center text-slate-600">No price observations to chart for {currency}.</p>;
  const label = `Price history chart in ${currency}: ${data.length} observations from ${formatDate(new Date(data[0].t).toISOString())} to ${formatDate(new Date(data.at(-1)!.t).toISOString())}`;
  return (
    <figure aria-label={label}>
      <div className="h-72 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => formatDate(new Date(t).toISOString())} fontSize={12} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => formatMoney(String(v), currency)} width={72} fontSize={12} />
            <Tooltip
              labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString())}
              formatter={(v, _n, item) => [formatMoney(String(v), currency), `${(item.payload as { source: string; demo: boolean }).source}${(item.payload as { demo: boolean }).demo ? ' (demo)' : ''}`]}
            />
            <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={data.length < 40} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">Each point is a stored observation. Gaps mean no observation was recorded.</figcaption>
    </figure>
  );
}
