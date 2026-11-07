'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Globe } from 'lucide-react';
import { Github } from '@/components/icons';
import { ManualProjectForm } from '@/components/manual-project-form';

export default function NewProject() {
  const router = useRouter();
  const [mode, setMode] = useState<'select' | 'manual'>('select');

  if (mode === 'manual') {
    return (
      <div className="page-width max-w-4xl space-y-7 pb-16 pt-8 sm:pt-10">
        <div className="flex items-start gap-3 border-b border-border pb-6">
          <Button
            variant="outline"
            size="icon"
            aria-label="Choose another import method"
            onClick={() => setMode('select')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="page-heading">Manual import</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Configure a public Git repository and its build settings.
            </p>
          </div>
        </div>
        <ManualProjectForm />
      </div>
    );
  }

  return (
    <div className="page-width max-w-4xl pb-16 pt-8 sm:pt-10">
      <header className="border-b border-border pb-6">
        <h1 className="page-heading">Create a project</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Choose how to connect your code. You can review build settings before the first deploy.
        </p>
      </header>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => router.push('/import')}
          className="group surface-card surface-card-interactive rounded-xl border border-border bg-card p-5 text-left hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="mb-5 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-muted text-foreground">
            <Github className="size-5" />
          </div>
          <h2 className="text-base font-semibold tracking-tight">Connect GitHub</h2>
          <p className="mt-1.5 min-h-10 text-sm leading-6 text-muted-foreground">
            Select a repository and deploy new commits automatically.
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand-800 dark:text-brand-300">
            Continue with GitHub{' '}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMode('manual')}
          className="group surface-card surface-card-interactive rounded-xl border border-border bg-card p-5 text-left hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="mb-5 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-muted text-foreground">
            <Globe className="size-5" />
          </div>
          <h2 className="text-base font-semibold tracking-tight">Use a Git URL</h2>
          <p className="mt-1.5 min-h-10 text-sm leading-6 text-muted-foreground">
            Configure a public repository directly with a Git URL.
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand-800 dark:text-brand-300">
            Configure manually{' '}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
