'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CardShell } from '@/components/ui/card-shell';
import { Button } from '@/components/ui/button';
import { Globe, ArrowLeft } from 'lucide-react';
import { Github } from '@/components/icons';
import { ManualProjectForm } from '@/components/manual-project-form';

export default function NewProject() {
  const router = useRouter();
  const [mode, setMode] = useState<'select' | 'manual'>('select');

  if (mode === 'manual') {
    return (
      <div className="mx-auto max-w-4xl space-y-8 px-6 py-16">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setMode('select')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold tracking-[-0.035em]">Manual Import</h1>
            <p className="text-muted-foreground">Configure your project manually via Git URL.</p>
          </div>
        </div>
        <ManualProjectForm />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <div className="mb-12 space-y-2 text-center">
        <h1 className="text-4xl font-extrabold tracking-[-0.035em] md:text-5xl">
          Create New Project
        </h1>
        <p className="text-lg text-muted-foreground">Choose how you want to deploy your project.</p>
      </div>

      <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
        {/* Option 1: GitHub Import */}
        <CardShell
          className="group cursor-pointer transition-colors duration-200 hover:border-border-strong"
          innerClassName="p-6"
          onClick={() => router.push('/import')}
        >
          <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface-muted text-foreground transition-transform duration-200 group-hover:scale-[1.04]">
            <Github className="size-6" />
          </div>
          <h3 className="text-base font-bold tracking-tight">Import Git Repository</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your GitHub account to automatically deploy repositories and setup CD.
          </p>
          <Button className="mt-6 w-full" variant="outline">
            Import from GitHub
          </Button>
        </CardShell>

        {/* Option 2: Manual URL */}
        <CardShell
          className="group cursor-pointer transition-colors duration-200 hover:border-border-strong"
          innerClassName="p-6"
          onClick={() => setMode('manual')}
        >
          <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface-muted text-foreground transition-transform duration-200 group-hover:scale-[1.04]">
            <Globe className="size-6" />
          </div>
          <h3 className="text-base font-bold tracking-tight">Manual Import</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Deploy any public Git repository by proper URL. Good for quick tests.
          </p>
          <Button className="mt-6 w-full" variant="outline">
            Continue Manually
          </Button>
        </CardShell>
      </div>
    </div>
  );
}
