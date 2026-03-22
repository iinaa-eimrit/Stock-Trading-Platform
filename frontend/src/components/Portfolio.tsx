import type { BalanceMap } from '../types';

interface Props {
  balance: BalanceMap;
  market: string;
  onRefresh: () => void;
}

export default function Portfolio({ balance, market, onRefresh }: Props) {
  const assets = Object.entries(balance).filter(
    ([, v]) => v.available > 0 || v.locked > 0
  );

  return (
    <div className="portfolio">
      <div className="portfolio-section">
        <h4>Balances</h4>
        <div className="balance-grid">
          {assets.map(([asset, val]) => (
            <div key={asset} className="balance-item">
              <div className="asset">{asset}</div>
              <div className="amount">{val.available.toFixed(4)}</div>
              {val.locked > 0 && (
                <div className="locked">Locked: {val.locked.toFixed(4)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
