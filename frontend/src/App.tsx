import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './api';
import Header from './components/Header';
import Login from './components/Login';
import Chart from './components/Chart';
import Orderbook from './components/Orderbook';
import TradeHistory from './components/TradeHistory';
import OrderForm from './components/OrderForm';
import Portfolio from './components/Portfolio';
import type { OrderbookData, TradeData, CandleData, BalanceMap, MarketInfo } from './types';

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [market, setMarket] = useState('ETH_USDC');
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [book, setBook] = useState<OrderbookData>({ bids: [], asks: [], lastTradePrice: null });
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [ticker, setTicker] = useState<{ price: number; timestamp: number } | null>(null);
  const [balance, setBalance] = useState<BalanceMap>({});
  const prevMarket = useRef(market);

  /* ─── Auth ─── */
  const onAuth = useCallback((t: string) => {
    localStorage.setItem('token', t);
    setToken(t);
  }, []);

  const onLogout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setBalance({});
  }, []);

  /* ─── WebSocket handler ─── */
  const onWsMessage = useCallback(
    (stream: string, data: any) => {
      if (stream === `orderbook@${market}`) setBook(data);
      else if (stream === `trades@${market}`) {
        if (Array.isArray(data)) setTrades(data);
        else setTrades((prev) => [...prev, data].slice(-100));
      }
      else if (stream === `ticker@${market}`) setTicker(data);
      else if (stream === `candles@${market}@1m`) {
        setCandles((prev) => {
          const idx = prev.findIndex((c) => c.timestamp === data.timestamp);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = data;
            return copy;
          }
          return [...prev, data];
        });
      }
      else if (stream === `candles@${market}@1m:snapshot`) {
        if (Array.isArray(data)) setCandles(data);
      }
    },
    [market]
  );

  const { subscribe, unsubscribe } = useWebSocket(onWsMessage);

  /* ─── Load initial data when market changes ─── */
  useEffect(() => {
    const prev = prevMarket.current;
    if (prev !== market) {
      unsubscribe([
        `orderbook@${prev}`,
        `trades@${prev}`,
        `ticker@${prev}`,
        `candles@${prev}@1m`,
      ]);
    }
    prevMarket.current = market;

    subscribe([
      `orderbook@${market}`,
      `trades@${market}`,
      `ticker@${market}`,
      `candles@${market}@1m`,
    ]);

    api.getCandles(market, '1m').then(setCandles).catch(() => {});
    api.getTrades(market).then(setTrades).catch(() => {});
    api.getOrderbook(market).then(setBook).catch(() => {});
  }, [market, subscribe, unsubscribe]);

  /* ─── Load markets on mount ─── */
  useEffect(() => {
    api.getMarkets().then(setMarkets).catch(() => {});
  }, []);

  /* ─── Load balance when token changes ─── */
  useEffect(() => {
    if (token) api.getBalance().then(setBalance).catch(() => {});
  }, [token]);

  const refreshBalance = useCallback(() => {
    if (token) api.getBalance().then(setBalance).catch(() => {});
  }, [token]);

  const currentMarket = markets.find((m) => m.symbol === market);

  if (!token) return <Login onAuth={onAuth} />;

  return (
    <div className="app">
      <Header
        markets={markets}
        currentMarket={market}
        onMarketChange={setMarket}
        ticker={ticker}
        onLogout={onLogout}
      />
      <div className="layout">
        <div className="panel order-form-panel">
          <OrderForm
            market={market}
            baseAsset={currentMarket?.baseAsset ?? ''}
            quoteAsset={currentMarket?.quoteAsset ?? ''}
            balance={balance}
            lastPrice={ticker?.price ?? book.lastTradePrice}
            onOrderPlaced={refreshBalance}
          />
        </div>
        <div className="panel chart-panel">
          <Chart candles={candles} />
        </div>
        <div className="sidebar">
          <div className="panel orderbook-panel">
            <Orderbook
              book={book}
              baseAsset={currentMarket?.baseAsset ?? ''}
              quoteAsset={currentMarket?.quoteAsset ?? ''}
            />
          </div>
          <div className="panel trades-panel">
            <TradeHistory trades={trades} baseAsset={currentMarket?.baseAsset ?? ''} />
          </div>
        </div>
      </div>
      <div className="panel portfolio-panel">
        <Portfolio balance={balance} market={market} onRefresh={refreshBalance} />
      </div>
    </div>
  );
}
