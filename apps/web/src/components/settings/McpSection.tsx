import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktopRuntime } from '../../platform/runtime';
import { configureMcp, getMcpStatus, mcpClientConfiguration, type McpStatus } from '../../platform/mcpService';
import { track } from '../../analytics';
import { Button } from '../ui/Button';

export function McpSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const desktop = isDesktopRuntime();
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getMcpStatus().then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError(t('dialogs:settings.mcp.unavailable', 'Agent access is unavailable. Restart Ori Studio and try again.')); });
    return () => { active = false; };
  }, [desktop, t]);
  if (!desktop) return null;
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setError(''); setShowConfig(false);
    try {
      const next = await configureMcp(!status?.enabled); setStatus(next);
      track('agent access changed', { state: next.enabled ? 'enabled' : 'disabled' });
    } catch {
      setError(t('dialogs:settings.mcp.failed', 'Agent access could not be changed. Restart Ori Studio and try again.'));
      void getMcpStatus().then(setStatus).catch(() => undefined);
    } finally { setBusy(false); }
  };
  return (
    <section className="settings-section" data-testid="settings-mcp">
      <h3 className="settings-section__title">{t('dialogs:settings.mcp.title', 'AI agent access')}</h3>
      <p className="settings-toggle-row__desc">
        {t('dialogs:settings.mcp.description', 'Let an external MCP agent design, analyze and export origami in this desktop session. Agents work in isolated experiments and can commit undoable changes to your Edit canvas.')}
      </p>
      <div className="settings-toggle-row settings-toggle-row--action">
        <span className="settings-toggle-row__copy">
          <span className="settings-toggle-row__label" role="status">
            {status?.enabled ? t('dialogs:settings.mcp.enabled', 'Enabled for this session') : t('dialogs:settings.mcp.disabled', 'Disabled')}
          </span>
          <span className="settings-toggle-row__desc">
            {t('dialogs:settings.mcp.scope', 'Connections stay on this computer and require the access token. Disabling access cancels jobs and discards uncommitted experiments.')}
          </span>
        </span>
        <Button size="sm" disabled={busy || !status} onClick={() => void toggle()}>
          {busy ? t('dialogs:settings.mcp.changing', 'Changing…') : status?.enabled ? t('dialogs:settings.mcp.disable', 'Disable access') : t('dialogs:settings.mcp.enable', 'Enable access')}
        </Button>
      </div>
      {status?.enabled && (
        <>
          <Button size="sm" onClick={() => setShowConfig(!showConfig)} aria-expanded={showConfig}>
            {showConfig ? t('dialogs:settings.mcp.hide', 'Hide client configuration') : t('dialogs:settings.mcp.show', 'Show client configuration')}
          </Button>
          {showConfig && (
            <label className="settings-toggle-row__copy">
              <span className="settings-toggle-row__desc">
                {t('dialogs:settings.mcp.secret', 'Copy this into your MCP client. It contains a secret token granting access to your workspace; keep it private. The configuration changes when access is enabled again.')}
              </span>
              <textarea aria-label={t('dialogs:settings.mcp.config', 'MCP client configuration')} readOnly rows={11} value={mcpClientConfiguration(status)} className="settings-mcp-config ph-no-capture" spellCheck={false} />
            </label>
          )}
        </>
      )}
      {error && <p role="alert" className="settings-toggle-row__desc">{error}</p>}
    </section>
  );
}
