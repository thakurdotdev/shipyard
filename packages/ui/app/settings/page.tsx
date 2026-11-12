'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PlatformSettings, platformApi, SettingKey } from '@/lib/platform-api';
import { ExternalLink, Loader2, Save } from 'lucide-react';
import { Github } from '@/components/icons';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

type Drafts = Partial<Record<SettingKey, string>>;

interface FieldSpec {
  key: SettingKey;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  help?: string;
}

function SourceBadge({ source }: { source: 'dashboard' | 'env' | null }) {
  if (source === 'env') return <Badge variant="outline">from .env</Badge>;
  if (source === 'dashboard') return <Badge variant="secondary">saved</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      not set
    </Badge>
  );
}

function SettingField({
  spec,
  data,
  draft,
  onChange,
  onClear,
}: {
  spec: FieldSpec;
  data: PlatformSettings;
  draft: string | undefined;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const view = data.settings[spec.key];
  const id = `setting-${spec.key}`;
  const current = view.secret ? view.hint : view.value;
  const placeholder = view.configured
    ? view.secret
      ? `Saved (${view.hint}). Enter a new value to replace it`
      : spec.placeholder
    : spec.placeholder;
  const value = draft ?? (view.secret ? '' : (view.value ?? ''));
  const Field = spec.multiline ? Textarea : Input;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{spec.label}</Label>
        <div className="flex items-center gap-2">
          {view.source === 'dashboard' && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Remove
            </button>
          )}
          <SourceBadge source={view.source} />
        </div>
      </div>
      <Field
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={spec.multiline ? 'min-h-28 font-mono text-xs' : undefined}
        type={view.secret && !spec.multiline ? 'password' : 'text'}
      />
      {spec.help && <p className="text-xs text-muted-foreground">{spec.help}</p>}
      {!spec.help && view.source === 'env' && current && !view.secret && (
        <p className="text-xs text-muted-foreground">Saving here overrides the .env value.</p>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="surface-card rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

const GITHUB_FIELDS: FieldSpec[] = [
  { key: 'github_app_id', label: 'App ID', placeholder: '123456' },
  { key: 'github_app_slug', label: 'App slug', placeholder: 'my-shipyard' },
  { key: 'github_client_id', label: 'Client ID', placeholder: 'Iv1.…' },
  { key: 'github_client_secret', label: 'Client secret' },
  {
    key: 'github_private_key',
    label: 'Private key',
    multiline: true,
    placeholder: '-----BEGIN RSA PRIVATE KEY-----',
  },
  { key: 'github_webhook_secret', label: 'Webhook secret' },
];

const CLOUDFLARE_FIELDS: FieldSpec[] = [
  {
    key: 'cloudflare_api_token',
    label: 'API token',
    help: 'Needs Zone → DNS → Edit for the zone below.',
  },
  { key: 'cloudflare_zone_id', label: 'Zone ID', placeholder: 'From the zone’s Overview page' },
];

const EMAIL_FIELDS: FieldSpec[] = [
  { key: 'resend_api_key', label: 'Resend API key', placeholder: 're_…' },
  {
    key: 'resend_from_email',
    label: 'Sender',
    placeholder: 'ShipYard <uptime@example.com>',
    help: 'Must use a domain verified in Resend.',
  },
];

function SettingsContent() {
  const params = useSearchParams();
  const [data, setData] = useState<PlatformSettings | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [organization, setOrganization] = useState('');
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(() => {
    platformApi
      .getSettings()
      .then(setData)
      .catch((e) => toast.error('Could not load settings', { description: e.message }));
  }, []);

  useEffect(() => {
    load();
    if (params.get('github') === 'connected') toast.success('New GitHub App connected');
    const error = params.get('error');
    if (error) toast.error('GitHub App was not created', { description: error });
  }, [load, params]);

  const save = async (section: string, keys: SettingKey[], extra: Drafts = {}) => {
    const updates: Partial<Record<SettingKey, string | null>> = { ...extra };
    for (const key of keys) {
      const draft = drafts[key];
      if (draft !== undefined && draft !== (data?.settings[key].value ?? '')) {
        updates[key] = draft;
      }
    }
    if (Object.keys(updates).length === 0) {
      toast.info('Nothing to save');
      return;
    }
    setSaving(section);
    try {
      setData(await platformApi.saveSettings(updates));
      setDrafts((d) => {
        const next = { ...d };
        for (const key of Object.keys(updates)) delete next[key as SettingKey];
        return next;
      });
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error('Could not save settings', { description: e.message });
    } finally {
      setSaving(null);
    }
  };

  const clear = async (key: SettingKey) => {
    try {
      setData(await platformApi.saveSettings({ [key]: null }));
      toast.success('Removed. The .env value (if any) applies again.');
    } catch (e: any) {
      toast.error('Could not remove setting', { description: e.message });
    }
  };

  const createApp = async () => {
    setCreating(true);
    try {
      await platformApi.createGitHubApp({ organization: organization.trim() || undefined });
    } catch (e: any) {
      toast.error('Could not start GitHub App creation', { description: e.message });
      setCreating(false);
    }
  };

  if (!data) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-5 animate-spin text-brand-500" />
      </div>
    );
  }

  const fieldProps = (spec: FieldSpec) => ({
    spec,
    data,
    draft: drafts[spec.key],
    onChange: (value: string) => setDrafts((d) => ({ ...d, [spec.key]: value })),
    onClear: () => clear(spec.key),
  });
  const saveButton = (section: string, keys: SettingKey[]) => (
    <Button onClick={() => save(section, keys)} disabled={saving !== null} className="gap-1.5">
      {saving === section ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Save className="size-4" />
      )}
      Save
    </Button>
  );
  const slug = data.settings.github_app_slug.value;
  const cloudflareReady =
    data.settings.cloudflare_api_token.configured && data.settings.cloudflare_zone_id.configured;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-10">
      <div>
        <h1 className="page-heading">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Server-wide integrations. Values saved here are encrypted and override the server’s .env
          file.
        </p>
      </div>

      <Section
        title="Server"
        description="Set when ShipYard was installed. Change PUBLIC_URL in .env to move the dashboard."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ['Dashboard', data.server.public_url],
            ['Apps', `*.${data.server.base_domain}`],
            ['Server IP', data.server.server_ip],
            ['Mode', data.server.production ? 'Production (Nginx + HTTPS)' : 'Development'],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-[13px]">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title="GitHub App"
        description="Used to sign in, read repositories and receive push events."
        action={
          <Badge variant={data.github.app_ready ? 'secondary' : 'destructive'}>
            {data.github.app_ready ? 'Connected' : 'Not connected'}
          </Badge>
        }
      >
        {slug && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`https://github.com/apps/${slug}/installations/new`}
                target="_blank"
                rel="noreferrer"
              >
                Install on repositories <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`https://github.com/settings/apps/${slug}`} target="_blank" rel="noreferrer">
                App settings on GitHub <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        )}
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            {data.github.app_ready ? 'Replace with a new App' : 'Create the App in one click'}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            GitHub opens with the App filled in; confirm and you come back here.
            {data.github.app_ready && ' Repositories must then be installed on the new App.'}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Organization (optional)"
              aria-label="GitHub organization"
              className="sm:max-w-56"
            />
            <Button onClick={createApp} disabled={creating} className="gap-1.5">
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Github className="size-4" />
              )}
              Create GitHub App
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          aria-expanded={showManual}
        >
          {showManual ? 'Hide' : 'Enter'} App credentials manually
        </button>
        {showManual && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {GITHUB_FIELDS.slice(0, 4).map((spec) => (
                <SettingField key={spec.key} {...fieldProps(spec)} />
              ))}
            </div>
            {GITHUB_FIELDS.slice(4).map((spec) => (
              <SettingField key={spec.key} {...fieldProps(spec)} />
            ))}
            <div className="flex justify-end">
              {saveButton(
                'github',
                GITHUB_FIELDS.map((f) => f.key),
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="DNS (Cloudflare)"
        description={
          cloudflareReady ? (
            'Each app gets its own DNS record automatically.'
          ) : (
            <>
              Optional. Without it, add one wildcard record yourself:{' '}
              <code>*.{data.server.base_domain}</code> → <code>{data.server.server_ip}</code>.
            </>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {CLOUDFLARE_FIELDS.map((spec) => (
            <SettingField key={spec.key} {...fieldProps(spec)} />
          ))}
        </div>
        <div className="flex justify-end">
          {saveButton(
            'cloudflare',
            CLOUDFLARE_FIELDS.map((f) => f.key),
          )}
        </div>
      </Section>

      <Section
        title="Uptime emails"
        description="Optional. Down and recovery alerts are sent through Resend; until it’s set they wait in a queue."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {EMAIL_FIELDS.map((spec) => (
            <SettingField key={spec.key} {...fieldProps(spec)} />
          ))}
        </div>
        <div className="flex justify-end">
          {saveButton(
            'email',
            EMAIL_FIELDS.map((f) => f.key),
          )}
        </div>
      </Section>

      <Section title="Access" description="Anyone who can sign in can deploy code to this server.">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="allow-signups">Allow new sign-ups</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Off: only existing accounts can sign in. Turn on briefly to let a teammate create an
              account, then turn it off again.
            </p>
          </div>
          <Switch
            id="allow-signups"
            checked={data.settings.allow_signups.value === 'true'}
            disabled={saving !== null}
            onCheckedChange={(checked) =>
              save('access', [], { allow_signups: checked ? 'true' : 'false' })
            }
          />
        </div>
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="page-width">
      <Suspense>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
