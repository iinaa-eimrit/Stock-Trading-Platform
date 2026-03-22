import type { OrderbookData } from '../types';

interface Props {
  book: OrderbookData;
  baseAsset: string;
  quoteAsset: string;
}

export default function Orderbook({ book, baseAsset, quoteAsset }: Props) {
  const maxAskQty = Math.max(...book.asks.map((l) => l.quantity), 1);
  const maxBidQty = Math.max(...book.bids.map((l) => l.quantity), 1);

  // Display asks in reverse so lowest ask is closest to spread
  const visibleAsks = [...book.asks].slice(0, 12).reverse();
  const visibleBids = book.bids.slice(0, 12);

  const spread =
    book.asks.length > 0 && book.bids.length > 0
      ? (book.asks[0].price - book.bids[0].price).toFixed(2)
      : '—';

  return (
    <div className="orderbook">
      <div className="panel-title">Orderbook</div>

      <div className="ob-header">
        <span>Price ({quoteAsset})</span>
        <span style={{ textAlign: 'right' }}>Qty ({baseAsset})</span>
        <span style={{ textAlign: 'right' }}>Total</span>
      </div>

      {/* Asks */}
      <div className="ob-asks">
        {visibleAsks.map((level, i) => {
          const total = (level.price * level.quantity).toFixed(2);
          const pct = (level.quantity / maxAskQty) * 100;
          return (
            <div key={`a-${i}`} className="ob-row ob-ask">
              <span className="price">{level.price.toFixed(2)}</span>
              <span className="qty">{level.quantity.toFixed(4)}</span>
              <span className="total">{total}</span>
              <div className="ob-depth" style={{ width: `${pct}%` }} />
            </div>
          );
        })}
      </div>

      {/* Spread */}
      <div className="ob-spread">
        <span className="spread-price">
          {book.lastTradePrice?.toFixed(2) ?? '—'}
        </span>
        Spread: {spread}
      </div>

      {/* Bids */}
      <div className="ob-bids">
        {visibleBids.map((level, i) => {
          const total = (level.price * level.quantity).toFixed(2);
          const pct = (level.quantity / maxBidQty) * 100;
          return (
            <div key={`b-${i}`} className="ob-row ob-bid">
              <span className="price">{level.price.toFixed(2)}</span>
              <span className="qty">{level.quantity.toFixed(4)}</span>
              <span className="total">{total}</span>
              <div className="ob-depth" style={{ width: `${pct}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
