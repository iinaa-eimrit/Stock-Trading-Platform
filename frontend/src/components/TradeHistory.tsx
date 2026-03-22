import type { TradeData } from '../types';

interface Props {
  trades: TradeData[];
  baseAsset: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TradeHistory({ trades, baseAsset }: Props) {
  const recent = [...trades].reverse().slice(0, 40);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div className="panel-title">Recent Trades</div>

      <div className="trade-header">
        <span>Price</span>
        <span style={{ textAlign: 'right' }}>Qty ({baseAsset})</span>
        <span style={{ textAlign: 'right' }}>Time</span>
      </div>

      <div className="trade-list">
        {recent.map((t) => (
          <div key={t.id} className="trade-row">
            <span className="price" style={{ color: t.takerSide === 'buy' ? 'var(--green)' : 'var(--red)' }}>
              {t.price.toFixed(2)}
            </span>
            <span className="qty">{t.quantity.toFixed(4)}</span>
            <span className="time">{formatTime(t.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
