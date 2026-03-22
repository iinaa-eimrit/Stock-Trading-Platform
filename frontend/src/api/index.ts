const API = '/api/v1';

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

  getOrderbook: (market: string) => request<any>(`/markets/${market}/orderbook`),

  getTrades: (market: string) => request<any[]>(`/markets/${market}/trades`),

  getCandles: (market: string, interval = '1m') =>
    request<any[]>(`/markets/${market}/candles?interval=${interval}`),

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
