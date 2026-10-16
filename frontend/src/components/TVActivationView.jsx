import { useEffect, useState } from 'react';
import AuthPage from './AuthPage';
import useApiClient from './app/hooks/useApiClient';
import { Icons, Spinner, cx } from './app/AppPrimitives';

export default function TVActivationView() {
  const { apiCall, apiUrl } = useApiClient();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    apiCall('get', '/auth/me').then(value => { if (active) setUser(value); })
      .catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [apiCall]);
  async function decide(decision) {
    setBusy(true); setError('');
    try {
      await apiCall('post', '/mobile/auth/device/decision', { user_code: code, decision });
      setResult(decision); setCode('');
    } catch (failure) {
      const status = failure?.response?.status;
      setError(status === 401 ? 'Your session expired. Sign in again and retry.' : status === 429
        ? 'Too many attempts. Wait a minute before trying again.' : 'Unable to authorize. Check the code and make sure it has not expired.');
      if (status === 401) setUser(null);
    } finally { setBusy(false); }
  }
  if (!ready) return <main className="min-h-screen flex items-center justify-center"><Spinner /></main>;
  if (!user) return <AuthPage route="login" onNavigate={() => { window.location.href = '/login'; }} onAuth={setUser} apiUrl={apiUrl} Icons={Icons} Spinner={Spinner} cx={cx} />;
  return <main className="min-h-screen bg-void text-ink flex items-center justify-center p-6">
    <section className="card w-full max-w-lg p-8 space-y-6">
      <div className="flex items-center gap-3"><img src="/icons/collectz-mark.svg" alt="" width="48" height="48" /><span className="text-2xl font-semibold">collectZ</span></div>
      <h1 className="text-3xl font-display">Connect Apple TV</h1>
      {result ? <p role="status">{result === 'approve' ? 'Apple TV approved. Return to your TV to browse your collection.' : 'Connection denied. No access was granted.'}</p> : <>
        <p className="text-dim">Signed in as {user.name || user.email}. Only approve a code displayed on your own Apple TV. This grants read-only access to your authorized libraries.</p>
        <label className="block">Code shown on Apple TV<input className="input w-full mt-2 font-mono uppercase" autoComplete="off" maxLength={9} value={code} onChange={event => setCode(event.target.value.toUpperCase())} /></label>
        {error && <p role="alert" className="text-err">{error}</p>}
        <div className="flex gap-3"><button className="btn-primary" disabled={busy || code.replace(/[- ]/g, '').length !== 8} onClick={() => decide('approve')}>Approve Apple TV</button>
          <button className="btn-secondary" disabled={busy || code.replace(/[- ]/g, '').length !== 8} onClick={() => decide('deny')}>Deny</button></div>
      </>}
    </section>
  </main>;
}
