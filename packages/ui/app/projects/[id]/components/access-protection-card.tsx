'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AccessSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const MIN_PASSWORD_LENGTH = 8;

const sessionLengths = [
  { value: '1', label: '1 hour' },
  { value: '8', label: '8 hours' },
  { value: '24', label: '1 day' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
  { value: '2160', label: '90 days' },
];

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(20));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

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
  const canSave = dirty && !needsPassword && !passwordTooShort && !saving;

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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" /> Password protection
            </CardTitle>
            <CardDescription>
              Ask visitors for a password before they can reach your deployed site. Use it for
              private projects, previews and client work.
            </CardDescription>
          </div>
          <Switch
            aria-label="Password protection"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!settings || saving}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadFailed && (
          <p role="alert" className="text-sm text-destructive">
            Could not load access settings. Reload the page to try again.
          </p>
        )}
        {!loadFailed && !settings && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading access settings…
          </div>
        )}

        {settings && !settings.enforced && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Passwords are enforced by the production web server. This development instance serves
              deployed apps directly, so they stay open.
            </p>
          </div>
        )}

        {settings && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="access-password">
                  {settings.has_password ? 'New password' : 'Password'}
                </Label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      id="access-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={settings.has_password ? 'Leave blank to keep current' : ''}
                      autoComplete="new-password"
                      spellCheck={false}
                      maxLength={128}
                      aria-invalid={passwordTooShort || needsPassword}
                      aria-describedby="access-password-help"
                      disabled={saving}
                      className="pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p
                  id="access-password-help"
                  className={`text-xs ${passwordTooShort || needsPassword ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {needsPassword
                    ? 'Set a password to turn protection on.'
                    : passwordTooShort
                      ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                      : settings.has_password
                        ? 'Changing the password signs everyone out.'
                        : `At least ${MIN_PASSWORD_LENGTH} characters. Shared by everyone who needs access.`}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="access-session">Stay signed in for</Label>
                <Select value={sessionHours} onValueChange={setSessionHours} disabled={saving}>
                  <SelectTrigger id="access-session">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sessionLengths.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  How long a browser stays unlocked after the password is entered.
                </p>
              </div>
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                Applies immediately to the live site
                {settings.domain ? ` (${settings.domain})` : ''}; no redeploy needed.
              </li>
              <li>
                The dashboard’s embedded preview is replaced by an “Open live site” link while
                protection is on. Uptime monitoring keeps working.
              </li>
              <li>Everything on the site is covered, including APIs and webhooks it exposes.</li>
            </ul>

            <div className="flex justify-end">
              <Button onClick={save} disabled={!canSave}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save protection
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
