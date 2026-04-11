import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import CollectzMark from './CollectzMark';
import { SectionTabs } from './app/AppPrimitives';

function readCookieValue(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

export default function AuthPage({ route, onNavigate, onAuth, apiUrl, appVersion, Icons, Spinner, cx }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submitInFlightRef = useRef(false);
  const inviteAvailable = Boolean(invite);
  const registerAvailable = inviteAvailable;
  const isRegister = route === 'register' && registerAvailable;
  const isReset = route === 'reset';
  const authTabs = registerAvailable
    ? [
        { id: 'login', label: 'Sign In' },
        { id: 'register', label: 'Register' }
      ]
    : [{ id: 'login', label: 'Sign In' }];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('invite')) setInvite(params.get('invite'));
    if (params.get('email')) setEmail(params.get('email'));
    if (params.get('token')) setResetToken(params.get('token'));
  }, [route]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setLoading(true);
    setError('');
    try {
      let endpoint = '/auth/login';
      let payload = { email, password };
      if (isReset) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        endpoint = '/auth/password-reset/consume';
        payload = { token: resetToken, email, password };
      } else if (isRegister) {
        endpoint = '/auth/register';
        payload = { name, email, password, inviteToken: invite || undefined };
      }
      const headers = {};
      const playwrightBypassToken = readCookieValue('playwright_e2e_bypass');
      if (playwrightBypassToken) {
        headers['x-playwright-e2e-bypass'] = playwrightBypassToken;
      }
      const data = await axios.post(`${apiUrl}${endpoint}`, payload, { withCredentials: true, headers });
      onAuth(data.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed');
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-void flex">
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between border-r border-edge bg-abyss px-12 py-14">
        <div className="flex items-center gap-3">
          <CollectzMark className="h-9 w-9 text-gold" title="" />
          <span className="text-2xl font-semibold tracking-tight text-ink">collectZ</span>
        </div>
        <div className="space-y-5">
          <h1 className="page-title max-w-lg text-balance">
            Keep your collection organized without losing the human details.
          </h1>
          <p className="max-w-xl text-base leading-7 text-dim xl:text-lg">
            Track personal and shared libraries in one place, then keep editing simple once the item is in.
          </p>
          <div className="space-y-2 text-sm text-ghost">
            <p>Import what you already own.</p>
            <p>Search when it helps, then edit everything directly.</p>
            <p>Keep personal and shared spaces tidy.</p>
          </div>
        </div>
        <p className="text-sm text-ghost">Open-source tools for collectors who want a quieter workflow.</p>
      </div>

      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden text-center">
            <div className="inline-flex items-center gap-3">
              <CollectzMark className="h-8 w-8 text-gold" title="" />
              <span className="text-3xl font-semibold tracking-tight text-ink">collectZ</span>
            </div>
          </div>

          {!isReset && (
            <SectionTabs
              tabs={authTabs}
              activeId={isRegister ? 'register' : 'login'}
              onChange={onNavigate}
              semantics="buttons"
              stretch
              ariaLabel="Authentication modes"
            />
          )}
          {isReset && (
            <div className="space-y-2">
              <p className="panel-title !text-xl">Reset password</p>
              <p className="text-xs text-ghost">Use your one-time reset link to set a new password.</p>
            </div>
          )}
          {!isReset && route === 'register' && !registerAvailable ? (
            <div className="rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-dim">
              Use an invite link to create an account. You can still sign in below.
            </div>
          ) : null}

          <form onSubmit={submit} className="space-y-4">
            {isRegister && !isReset && (
              <div className="field">
                <label className="label">Name</label>
                <input className="input input-lg" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label className="label">Email</label>
              <input className="input input-lg" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label">{isReset ? 'New Password' : 'Password'}</label>
              <div className="relative">
                <input className="input input-lg pr-10" type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" tabIndex={-1} onClick={() => setShowPw((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost hover:text-dim transition-colors">
                  {showPw ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>
            </div>
            {isReset && (
              <div className="field">
                <label className="label">Confirm Password</label>
                <input
                  className="input input-lg"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required />
              </div>
            )}
            {isRegister && !isReset && invite && (
              <div className="rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-gold">
                Invite link detected for {email || 'this account'}.
              </div>
            )}
            {isReset && (
              <button type="button" onClick={() => onNavigate('login')} className="btn-ghost btn-sm w-full">
                Back to Sign In
              </button>
            )}

            {error && <p className="text-sm text-err bg-err/10 border border-err/20 rounded px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading}
              className="btn-primary btn-lg w-full mt-2 text-base">
              {loading ? <Spinner size={18} /> : isReset ? 'Set password' : isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-ghost">
            collectZ v{appVersion}
          </p>
        </div>
      </div>
    </div>
  );
}
