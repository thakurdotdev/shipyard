'use client';

import { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Lock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_SESSION_HOURS,
  generatePassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SESSION_LENGTHS,
} from '@/lib/access';
import { cn } from '@/lib/utils';

export interface PasswordProtectionValue {
  enabled: boolean;
  password: string;
  sessionHours: string;
}

export const DEFAULT_PASSWORD_PROTECTION: PasswordProtectionValue = {
  enabled: false,
  password: '',
  sessionHours: String(DEFAULT_SESSION_HOURS),
};

/** Error to show for the current value, or null when it can be submitted. */
export function passwordProtectionError(value: PasswordProtectionValue): string | null {
  if (!value.enabled) return null;
  if (!value.password) return 'Set a password or turn protection off';
  if (value.password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  return null;
}

/** API payload for project creation; undefined when protection is off. */
export function toAccessPayload(value: PasswordProtectionValue) {
  return value.enabled
    ? { password: value.password, session_hours: Number(value.sessionHours) }
    : undefined;
}

interface PasswordProtectionFieldsProps {
  value: PasswordProtectionValue;
  onChange: (value: PasswordProtectionValue) => void;
  /** Show validation errors (after a submit attempt). */
  showErrors?: boolean;
  /** Render the on/off switch inline (false when the parent owns the toggle). */
  showToggle?: boolean;
}

/**
 * Password protection for a project that does not exist yet: the password is
 * set together with the project, so the site is never public, not even briefly.
 */
export function PasswordProtectionFields({
  value,
  onChange,
  showErrors,
  showToggle = true,
}: PasswordProtectionFieldsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const error = passwordProtectionError(value);
  const tooShort = value.password.length > 0 && value.password.length < MIN_PASSWORD_LENGTH;
  const invalid = (showErrors && !!error) || tooShort;
  const set = (patch: Partial<PasswordProtectionValue>) => onChange({ ...value, ...patch });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy the password');
    }
  };

  return (
    <div className="space-y-4">
      {showToggle && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
          <Label htmlFor="create-access-enabled" className="flex items-start gap-2.5 font-normal">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Password protect this site
              </span>
              <span className="block text-xs text-muted-foreground">
                Visitors enter a password before they see anything.
              </span>
            </span>
          </Label>
          <Switch
            id="create-access-enabled"
            checked={value.enabled}
            onCheckedChange={(enabled) => {
              // Turning it on with nothing typed yet: start from a strong generated password.
              if (enabled && !value.password) {
                onChange({ ...value, enabled, password: generatePassword() });
                setShowPassword(true);
              } else {
                set({ enabled });
              }
            }}
          />
        </div>
      )}

      {value.enabled && (
        <div className="grid gap-4 animate-in fade-in slide-in-from-top-1 duration-200 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="create-access-password">Password</Label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="create-access-password"
                  type={showPassword ? 'text' : 'password'}
                  value={value.password}
                  onChange={(e) => set({ password: e.target.value })}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={MAX_PASSWORD_LENGTH}
                  aria-invalid={invalid}
                  aria-describedby="create-access-password-help"
                  className="pr-16 font-mono text-sm"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-1">
                  <button
                    type="button"
                    onClick={copy}
                    disabled={!value.password}
                    aria-label="Copy password"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Generate a strong password"
                title="Generate a strong password"
                onClick={() => {
                  set({ password: generatePassword() });
                  setShowPassword(true);
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
            <p
              id="create-access-password-help"
              className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
            >
              {invalid && error
                ? error
                : 'Save it somewhere safe — you can change it later in Settings.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-access-session">Stay signed in for</Label>
            <Select
              value={value.sessionHours}
              onValueChange={(sessionHours) => set({ sessionHours })}
            >
              <SelectTrigger id="create-access-session" className="w-full">
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
            <p className="text-xs text-muted-foreground">
              How long a browser stays unlocked after the password is entered.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
