'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AccessSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  SaveFooter,
  SettingsSection,
  useUnsavedWarning,
} from '@/components/settings/settings-section';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { generatePassword, MIN_PASSWORD_LENGTH, SESSION_LENGTHS } from '@/lib/access';

interface AccessProtectionCardProps {
  projectId: string;
  onProtectionChange?: (enabled: boolean) => void;
}

export function AccessProtectionCard({ projectId, onProtectionChange }: AccessProtectionCardProps) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sessionHours, setSessionHours] = useState('168');
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const apply = (data: AccessSettings) => {
    setSettings(data);
    setEnabled(data.enabled);
    setSessionHours(String(data.session_hours));
    setPassword('');
  };

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setLoadFailed(false);
    api
      .getAccessSettings(projectId)
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const needsPassword = enabled && !settings?.has_password && password.length === 0;
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const dirty =
    !!settings &&
    (enabled !== settings.enabled ||
      password.length > 0 ||
      Number(sessionHours) !== settings.session_hours);
  const canSave = !needsPassword && !passwordTooShort;
  useUnsavedWarning(dirty);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const data = await api.updateAccessSettings(projectId, {
        enabled,
        session_hours: Number(sessionHours),
        ...(password ? { password } : {}),
      });
      const passwordChanged = password.length > 0 && settings.has_password;
      apply(data);
      onProtectionChange?.(data.enabled);
      toast.success(data.enabled ? 'Password protection is on' : 'Password protection is off', {
        description: passwordChanged
          ? 'Visitors signed in with the old password have been signed out.'
          : data.enabled
            ? 'Visitors now need the password to open your site.'
            : 'Your site is public again.',
      });
    } catch (error) {
      toast.error('Failed to save access settings', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id="access"
      title="Password protection"
      description="Visitors enter a shared password before they reach the site. For private projects, previews and client work."
      aside={
        <Switch
          aria-label="Password protection"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!settings || saving}
        />
      }
      footer={
        settings && (
          <SaveFooter
            dirty={dirty}
            saving={saving}
            canSave={canSave}
            onSave={save}
            onReset={() => apply(settings)}
            note={
              settings.enabled
                ? `On${settings.domain ? ` for ${settings.domain}` : ''}. Changes apply immediately, no redeploy.`
                : 'Off. The site is public.'
            }
          />
        )
      }
    >
      {loadFailed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t load access settings. Reload the page to try again.
        </p>
      )}
      {!loadFailed && !settings && (
        <div className="h-16 animate-pulse rounded-lg bg-surface-muted/50" />
      )}

      {settings && !settings.enforced && (
        <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          The production web server enforces passwords. This development instance serves apps
          directly, so they stay open here.
        </p>
      )}

      {settings && (enabled || settings.enabled) && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={settings.has_password ? 'New password' : 'Password'}
              htmlFor="access-password"
              error={
                needsPassword
                  ? 'Set a password to turn protection on.'
                  : passwordTooShort
                    ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                    : null
              }
              hint={
                settings.has_password
                  ? 'Leave empty to keep the current one. Changing it signs everyone out.'
                  : `At least ${MIN_PASSWORD_LENGTH} characters, shared by everyone who needs access.`
              }
            >
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    id="access-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={settings.has_password ? '••••••••' : ''}
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={128}
                    aria-invalid={passwordTooShort || needsPassword}
                    disabled={saving}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 grid w-10 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Generate a strong password"
                  title="Generate a strong password"
                  disabled={saving}
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                >
                  <RefreshCw />
                </Button>
              </div>
            </Field>
            <Field
              label="Stay signed in for"
              htmlFor="access-session"
              hint="How long a browser stays unlocked."
            >
              <Select value={sessionHours} onValueChange={setSessionHours} disabled={saving}>
                <SelectTrigger id="access-session" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_LENGTHS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Covers everything on the site, including APIs and webhooks. The dashboard preview is
            replaced by a link while protection is on; uptime checks keep working.
          </p>
        </>
      )}
    </SettingsSection>
  );
}
