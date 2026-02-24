import React, { useState } from 'react';

export default function ProfileView({ user, apiCall, onToast, Spinner }) {
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', current_password: '', password: '' });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email };
      if (form.password) {
        payload.current_password = form.current_password;
        payload.password = form.password;
      }
      await apiCall('patch', '/profile', payload);
      onToast('Profile updated');
      setForm((f) => ({ ...f, current_password: '', password: '' }));
    } catch (err) {
      onToast(err.response?.data?.error || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-lg">
      <h1 className="section-title mb-6">Profile</h1>
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-4 pb-4 border-b border-edge">
          <div className="w-14 h-14 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-display text-2xl">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-medium text-ink">{user?.name}</p>
            <p className="text-sm text-ghost">{user?.email}</p>
            <span className="badge badge-gold mt-1">{user?.role}</span>
          </div>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div className="field">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label">Current Password <span className="normal-case text-ghost font-normal">(required for password change)</span></label>
            <input className="input" type="password" value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label">New Password <span className="normal-case text-ghost font-normal">(leave blank to keep)</span></label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? <Spinner size={16} /> : 'Save Changes'}</button>
        </form>
      </div>
    </div>
  );
}
