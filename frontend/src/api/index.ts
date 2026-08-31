const PROD_BACKEND = 'https://stock-trading-platform-backend-s5wr.onrender.com';
const BACKEND = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_BACKEND : '');
const API = `${BACKEND}/api/v1`;

function token(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;

  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data;
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ token: string; userId: string }>('/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signin: (email: string, password: string) =>
    request<{ token: string; userId: string }>('/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMarkets: () => request<any[]>('/markets'),

  getOrderbook: async (market: string) => {
    const data = await request<any>(`/markets/${market}/orderbook`);
    const mapLevel = (l: any) => ({
      price: l.price ?? (l.priceTicks ? l.priceTicks / 1000 : 0),
      quantity: l.quantity ?? (l.quantityLots ? l.quantityLots / 10000 : 0)
    });
    return {
      bids: (data.bids || []).map(mapLevel),
      asks: (data.asks || []).map(mapLevel),
      lastTradePrice: data.lastTradePrice ?? (data.lastTradePriceTicks ? data.lastTradePriceTicks / 1000 : null)
    };
  },

  getTrades: (market: string) => request<any[]>(`/markets/${market}/trades`),

  getCandles: async (market: string, interval = '1m') => {
    const raw = await request<any[]>(`/markets/${market}/candles?interval=${interval}`);
    return raw.map(c => ({
      ...c,
      open: c.open ?? (c.openTicks ? c.openTicks / 1000 : 0),
      high: c.high ?? (c.highTicks ? c.highTicks / 1000 : 0),
      low: c.low ?? (c.lowTicks ? c.lowTicks / 1000 : 0),
      close: c.close ?? (c.closeTicks ? c.closeTicks / 1000 : 0),
      volume: c.volume ?? (c.volumeLots ? c.volumeLots / 10000 : 0)
    }));
  },

  placeOrder: (params: any) =>
    request<any>('/order', { method: 'POST', body: JSON.stringify(params) }),

  cancelOrder: (id: string) => request<any>(`/order/${id}`, { method: 'DELETE' }),

  getQuote: (market: string, side: string, quantity: number) =>
    request<any>('/order/quote', {
      method: 'POST',
      body: JSON.stringify({ market, side, quantity }),
    }),

  getBalance: () => request<any>('/balance'),

  getOrders: () => request<any[]>('/order'),
};
