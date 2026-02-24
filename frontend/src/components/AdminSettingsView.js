import React, { useEffect, useState } from 'react';

export default function AdminSettingsView({ apiCall, onToast, onSettingsChange, Spinner }) {
  const [settings, setSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiCall('get', '/settings/general').then((data) => {
      setSettings(data);
      onSettingsChange?.(data);
    }).catch(() => {});
  }, [apiCall, onSettingsChange]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await apiCall('put', '/admin/settings/general', settings);
      setSettings(updated);
      onSettingsChange?.(updated);
      onToast('Settings saved');
    } catch {
      onToast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-sm">
      <h1 className="section-title mb-6">General Settings</h1>
      <div className="card p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="field">
            <label className="label">Theme</label>
            <select className="select" value={settings.theme} onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value }))}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Density</label>
            <select className="select" value={settings.density} onChange={(e) => setSettings((s) => ({ ...s, density: e.target.value }))}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </form>
      </div>
    </div>
  );
}
