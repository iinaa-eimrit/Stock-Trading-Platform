import type { MarketInfo } from '../types';

interface Props {
  markets: MarketInfo[];
  currentMarket: string;
  onMarketChange: (m: string) => void;
  ticker: { price: number; timestamp: number } | null;
  onLogout: () => void;
}

export default function Header({ markets, currentMarket, onMarketChange, ticker, onLogout }: Props) {
  const mkt = markets.find((m) => m.symbol === currentMarket);
  const display = currentMarket.replace('_', '/');

  return (
    <div className="header">
      <span className="header-logo">EXCHANGE</span>

      <div className="market-selector">
        {markets.map((m) => (
          <button
            key={m.symbol}
            className={`market-btn ${m.symbol === currentMarket ? 'active' : ''}`}
            onClick={() => onMarketChange(m.symbol)}
          >
            {m.symbol.replace('_', '/')}
          </button>
        ))}
      </div>

      <span className="ticker-price price-up">
        {ticker?.price?.toFixed(2) ?? mkt?.lastTradePrice?.toFixed(2) ?? '—'}
      </span>

      <div className="header-actions">
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{display}</span>
        <button className="btn btn-flat" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}
