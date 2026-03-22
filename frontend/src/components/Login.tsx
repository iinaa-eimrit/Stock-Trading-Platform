import { useState } from 'react';
import { api } from '../api';

interface Props {
  onAuth: (token: string) => void;
}

export default function Login({ onAuth }: Props) {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = isSignup
        ? await api.signup(email, password)
        : await api.signin(email, password);
      onAuth(res.token);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>{isSignup ? 'Create Account' : 'Sign In'}</h2>

        {error && <div className="login-error">{error}</div>}

        <div className="form-group">
          <label>Email</label>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <button className="btn btn-accent login-btn" onClick={submit} disabled={loading}>
          {loading ? '...' : isSignup ? 'Create Account' : 'Sign In'}
        </button>

        <div className="login-toggle">
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
          <span onClick={() => { setIsSignup(!isSignup); setError(''); }}>
            {isSignup ? 'Sign In' : 'Sign Up'}
          </span>
        </div>
      </div>
    </div>
  );
}
