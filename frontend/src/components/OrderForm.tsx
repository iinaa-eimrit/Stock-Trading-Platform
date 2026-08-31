import { useState } from 'react';
import { api } from '../api';
import type { BalanceMap } from '../types';

interface Props {
  market: string;
  baseAsset: string;
  quoteAsset: string;
  balance: BalanceMap;
  lastPrice: number | null;
  onOrderPlaced: () => void;
}

export default function OrderForm({
  market,
  baseAsset,
  quoteAsset,
  balance,
  lastPrice,
  onOrderPlaced,
}: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const priceNum = parseFloat(price) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const effectivePrice = type === 'market' ? (lastPrice ?? 0) : priceNum;
  const total = effectivePrice * qtyNum;

  const avail =
    side === 'buy'
      ? balance[quoteAsset]?.available ?? 0
      : balance[baseAsset]?.available ?? 0;

  const submit = async () => {
    setMsg(null);
    setLoading(true);
    try {
      const params: any = { type, side, quantity: qtyNum, market, clientOrderId: crypto.randomUUID() };
      if (type === 'limit') params.price = priceNum;

      const res = await api.placeOrder(params);
      const filledLots = res.trades?.reduce((acc: number, t: any) => acc + (t.quantityLots || 0), 0) || 0;
      setMsg({
        text: `${res.status} — ${res.trades?.length || 0} trade(s) executed`,
        ok: true,
      });
      setQuantity('');
      onOrderPlaced();
    } catch (e: any) {
      setMsg({ text: e.message, ok: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="order-form">
      <div className="panel-title" style={{ padding: '0 0 10px 0', border: 'none' }}>
        Place Order
      </div>

      {/* Side tabs */}
      <div className="side-tabs">
        <button
          className={`side-tab ${side === 'buy' ? 'active-buy' : ''}`}
          onClick={() => setSide('buy')}
        >
          Buy
        </button>
        <button
          className={`side-tab ${side === 'sell' ? 'active-sell' : ''}`}
          onClick={() => setSide('sell')}
        >
          Sell
        </button>
      </div>

      {/* Type tabs */}
      <div className="type-tabs">
        <button
          className={`type-tab ${type === 'limit' ? 'active' : ''}`}
          onClick={() => setType('limit')}
        >
          Limit
        </button>
        <button
          className={`type-tab ${type === 'market' ? 'active' : ''}`}
          onClick={() => setType('market')}
        >
          Market
        </button>
      </div>

      {/* Price */}
      {type === 'limit' && (
        <div className="form-field">
          <label>
            <span>Price ({quoteAsset})</span>
          </label>
          <input
            className="field-input"
            type="number"
            step="any"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      )}

      {/* Quantity */}
      <div className="form-field">
        <label>
          <span>Quantity ({baseAsset})</span>
          <span className="avail">
            Avail: {avail.toFixed(4)} {side === 'buy' ? quoteAsset : baseAsset}
          </span>
        </label>
        <input
          className="field-input"
          type="number"
          step="any"
          placeholder="0.0000"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>

      {/* Total */}
      <div className="order-total">
        <span>Total</span>
        <span className="value">
          {total > 0 ? total.toFixed(2) : '—'} {quoteAsset}
        </span>
      </div>

      <button
        className={`submit-btn ${side}`}
        disabled={loading || qtyNum <= 0 || (type === 'limit' && priceNum <= 0)}
        onClick={submit}
      >
        {loading ? '...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${baseAsset}`}
      </button>

      {msg && (
        <div className={`order-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>
      )}
    </div>
  );
}
