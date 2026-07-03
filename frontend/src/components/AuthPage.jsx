import { useEffect, useRef, useState } from 'react';
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
  const [notice, setNotice] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [authConfig, setAuthConfig] = useState({
    register_available: false,
    invite_required: true,
    first_user_bootstrap: false,
    password_reset_available: true,
    email_verification_required: true,
    smtp_configured: false
  });
  const [authConfigLoaded, setAuthConfigLoaded] = useState(false);
  const submitInFlightRef = useRef(false);
  const verifyAttemptedRef = useRef(false);
  const inviteAvailable = Boolean(invite);
  const registerAvailable = inviteAvailable || Boolean(authConfig.register_available);
  const isRegister = route === 'register' && registerAvailable;
  const isForgot = route === 'forgot';
  const isReset = route === 'reset';
  const isVerify = route === 'verify';
  const authTabs = registerAvailable
    ? [
        { id: 'login', label: 'Sign In' },
        { id: 'register', label: 'Register' }
      ]
    : [{ id: 'login', label: 'Sign In' }];
  const modeTitle = isForgot
    ? 'Let’s get you back in'
    : isReset
      ? 'Choose a new password'
      : isVerify
        ? (loading ? 'Checking your link' : 'Confirm your email')
        : isRegister
          ? 'Start your account'
          : '';
  const modeDescription = isForgot
    ? 'Enter your email and we’ll send a reset link if we find an account for it.'
    : isReset
      ? 'Use the reset link from your inbox to choose something new.'
      : isVerify
        ? (loading
            ? 'We’re confirming your address and finishing setup now.'
            : 'Open the link from your inbox to finish setting up your account.')
        : isRegister
          ? ''
          : '';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // AuthPage is reused across auth routes; query params are route-owned URL state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get('invite')) setInvite(params.get('invite'));
    if (params.get('email')) setEmail(params.get('email'));
    if (params.get('token')) setResetToken(params.get('token'));
  }, [route]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${apiUrl}/auth/config`, { withCredentials: true })
      .then((response) => {
        if (cancelled) return;
        setAuthConfig((prev) => ({
          ...prev,
          ...(response.data || {})
        }));
        setAuthConfigLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  useEffect(() => {
    // Route changes intentionally clear transient auth feedback from the previous mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('');
    setNotice('');
    setErrorCode('');
    verifyAttemptedRef.current = false;
  }, [route]);

  useEffect(() => {
    if (!isVerify || verifyAttemptedRef.current) return;
    if (!resetToken || !email) return;

    verifyAttemptedRef.current = true;
    // Email verification is an external auth side effect that owns loading/feedback state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    setNotice('');
    setErrorCode('');

    axios.post(`${apiUrl}/auth/email-verification/consume`, { token: resetToken, email }, { withCredentials: true })
      .then((response) => {
        onAuth(response.data.user);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Verification failed');
        setErrorCode(err.response?.data?.code || '');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, email, isVerify, onAuth, resetToken]);

  const resendVerification = async () => {
    if (!email) {
      setError('Enter your email address first');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setErrorCode('');
    try {
      const response = await axios.post(`${apiUrl}/auth/email-verification/request`, { email }, { withCredentials: true });
      setNotice(response.data?.message || 'If an unverified account exists for that email, a verification email will be sent shortly.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send verification email');
      setErrorCode(err.response?.data?.code || '');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setLoading(true);
    setError('');
    setNotice('');
    setErrorCode('');
    try {
      let endpoint = '/auth/login';
      let payload = { email, password };
      if (isForgot) {
        endpoint = '/auth/password-reset/request';
        payload = { email };
      } else if (isReset) {
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
      if (isForgot) {
        setNotice(data.data?.message || 'If an account exists for that email, you will receive a password reset email shortly.');
      } else if (isRegister && data.data?.verification_required) {
        setNotice(data.data?.message || 'Check your email to verify your account before signing in.');
        setPassword('');
        setConfirmPassword('');
      } else {
        onAuth(data.data.user);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed');
      setErrorCode(err.response?.data?.code || '');
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-void">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12 sm:px-8 lg:px-12">
        <div className="w-full max-w-[28rem] space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CollectzMark className="h-9 w-9 text-gold" title="" />
              <span className="text-3xl font-semibold tracking-tight text-ink">collectZ</span>
            </div>
            <div className="space-y-2">
              <h1 className="page-title text-balance">
                Build your collection.
              </h1>
              <p className="max-w-md text-sm leading-6 text-dim sm:text-base">
                Books, games, movies, and more. Your collection, whenever you need it.
              </p>
            </div>
          </div>

          <div className="space-y-5 border-t border-edge pt-6">
            {!isReset && !isForgot && !isVerify && (
              <SectionTabs
                tabs={authTabs}
                activeId={isRegister ? 'register' : 'login'}
                onChange={onNavigate}
                semantics="buttons"
                stretch
                ariaLabel="Authentication modes"
              />
            )}

            <div className="space-y-2">
              {!(!isRegister && !isForgot && !isReset && !isVerify) && (
                <h1 className="panel-title !text-[1.75rem] sm:!text-[1.9rem]">{modeTitle}</h1>
              )}
              {modeDescription ? <p className="text-sm leading-6 text-ghost">{modeDescription}</p> : null}
            </div>

            {!isReset && route === 'register' && authConfigLoaded && !registerAvailable ? (
              <div className="rounded-md border border-edge bg-raised px-4 py-3 text-sm leading-6 text-dim">
                {authConfig.smtp_configured === false && !inviteAvailable
                  ? 'Registration is temporarily unavailable while email delivery is being configured. You can still sign in below.'
                  : 'Registration is currently invite-only. You can still sign in below.'}
              </div>
            ) : null}

            <form onSubmit={submit} className="space-y-4">
              {!isVerify && (
                <>
                  {isRegister && !isReset && !isForgot && (
                    <div className="field">
                      <label className="label" htmlFor="auth-name">Name</label>
                      <input id="auth-name" className="input input-lg" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                  )}
                  <div className="field">
                    <label className="label" htmlFor="auth-email">Email</label>
                    <input id="auth-email" className="input input-lg" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  {!isForgot && <div className="field">
                    <label className="label" htmlFor="auth-password">{isReset ? 'New Password' : 'Password'}</label>
                    <div className="relative">
                      <input id="auth-password" className="input input-lg pr-10" type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPw((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost hover:text-dim transition-colors"
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                      >
                        {showPw ? <Icons.EyeOff /> : <Icons.Eye />}
                      </button>
                    </div>
                  </div>}
                  {isReset && (
                    <div className="field">
                      <label className="label" htmlFor="auth-confirm-password">Confirm Password</label>
                      <input
                        id="auth-confirm-password"
                        className="input input-lg"
                        type={showPw ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required />
                    </div>
                  )}
                  {isRegister && !isReset && invite && (
                    <div className="rounded-md border border-gold/20 bg-gold/5 px-4 py-3 text-sm leading-6 text-gold">
                      Invite link detected for {email || 'this account'}.
                    </div>
                  )}
                </>
              )}

              {error && <p className="rounded-md border border-err/20 bg-err/10 px-4 py-3 text-sm leading-6 text-err">{error}</p>}
              {notice && <p className="rounded-md border border-ok/20 bg-ok/10 px-4 py-3 text-sm leading-6 text-ok">{notice}</p>}

              {!isVerify && (
                <button type="submit" disabled={loading}
                  className="btn-primary btn-lg mt-2 w-full text-base">
                  {loading ? <Spinner size={18} /> : isForgot ? 'Send reset email' : isReset ? 'Set password' : isRegister ? 'Create account' : 'Sign in'}
                </button>
              )}

              <div className={cx('flex flex-col gap-2 pt-1', (isVerify || isForgot || isReset) && 'sm:flex-row sm:flex-wrap')}>
                {!isRegister && !isReset && !isForgot && (
                  <button type="button" onClick={() => onNavigate('forgot')} className="btn-ghost btn-sm justify-start px-0 text-sm">
                    Forgot password?
                  </button>
                )}
                {!isRegister && !isReset && !isForgot && errorCode === 'email_verification_required' && (
                  <button type="button" onClick={resendVerification} className="btn-ghost btn-sm justify-start px-0 text-sm">
                    Resend verification email
                  </button>
                )}
                {(isReset || isForgot || (isVerify && !loading)) && (
                  <button type="button" onClick={() => onNavigate('login')} className="btn-ghost btn-sm justify-start px-0 text-sm">
                    Back to Sign In
                  </button>
                )}
              </div>
            </form>

            <div className="flex items-center justify-end border-t border-edge/80 pt-4 text-xs text-ghost">
              <p>v{appVersion}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
