import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function AuthPage({ route, onNavigate, onAuth, apiUrl, appVersion, buildSha, Icons, Spinner, cx }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isRegister = route === 'register';
  const isReset = route === 'reset';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('invite')) setInvite(params.get('invite'));
    if (params.get('email')) setEmail(params.get('email'));
    if (params.get('token')) setResetToken(params.get('token'));
  }, [route]);

  const submit = async (e) => {
    e.preventDefault();
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
      const data = await axios.post(`${apiUrl}${endpoint}`, payload, { withCredentials: true });
      onAuth(data.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-void flex">
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-abyss via-deep to-void" />
        <div className="absolute inset-0 bg-gradient-to-r from-void/20 via-void/50 to-void" />
        <div className="relative z-10">
          <span className="font-display text-3xl tracking-widest text-gold">COLLECTZ</span>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="font-display text-6xl xl:text-7xl tracking-wider text-ink leading-none">
            YOUR COLLECTION.<br />
            <span className="text-gold">PERFECTLY</span><br />
            CATALOGUED.
          </h1>
          <p className="text-dim text-lg max-w-md leading-relaxed">
            Track every disc, stream, and tape in your library. Powered by TMDB. Built for collectors.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-6">
          {['VHS', 'Blu-ray', '4K UHD', 'Digital'].map((f) => (
            <span key={f} className="text-xs text-ghost tracking-widest uppercase border border-ghost/20 px-2 py-1 rounded">{f}</span>
          ))}
        </div>
      </div>

      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden text-center">
            <span className="font-display text-4xl tracking-widest text-gold">COLLECTZ</span>
          </div>

          {!isReset && (
            <div className="tab-strip">
              <button className={cx('tab flex-1', !isRegister && 'active')} onClick={() => onNavigate('login')}>Sign In</button>
              <button className={cx('tab flex-1', isRegister && 'active')} onClick={() => onNavigate('register')}>Register</button>
            </div>
          )}
          {isReset && (
            <div className="space-y-2">
              <p className="font-display text-xl tracking-wider text-ink">RESET PASSWORD</p>
              <p className="text-xs text-ghost">Use your one-time reset link to set a new password.</p>
            </div>
          )}

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
            {isRegister && !isReset && (
              <div className="field">
                <label className="label">Invite Token <span className="text-ghost normal-case">(required after first user)</span></label>
                <input className="input input-lg font-mono" placeholder="Paste token here" value={invite} onChange={(e) => setInvite(e.target.value)} />
              </div>
            )}
            {isReset && (
              <button type="button" onClick={() => onNavigate('login')} className="btn-ghost btn-sm w-full">
                Back to Sign In
              </button>
            )}

            {error && <p className="text-sm text-err bg-err/10 border border-err/20 rounded px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading}
              className="btn-primary btn-lg w-full mt-2 font-display tracking-widest text-base">
              {loading ? <Spinner size={18} /> : isReset ? 'SET PASSWORD' : isRegister ? 'CREATE ACCOUNT' : 'SIGN IN'}
            </button>
          </form>

          <p className="text-center text-xs text-ghost">
            collectZ v{appVersion} · {buildSha}
          </p>
        </div>
      </div>
    </div>
  );
}
