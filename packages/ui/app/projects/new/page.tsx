'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Github, Globe, ArrowLeft } from 'lucide-react';
import { ManualProjectForm } from '@/components/manual-project-form';

export default function NewProject() {
  const router = useRouter();
  const [mode, setMode] = useState<'select' | 'manual'>('select');

  if (mode === 'manual') {
    return (
      <div className="container mx-auto py-10 max-w-4xl space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setMode('select')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight">Manual Import</h1>
            <p className="text-muted-foreground">Configure your project manually via Git URL.</p>
          </div>
        </div>
        <ManualProjectForm />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-20 max-w-4xl">
      <div className="text-center mb-12 space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Create New Project</h1>
        <p className="text-muted-foreground text-lg">Choose how you want to deploy your project.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {/* Option 1: GitHub Import */}
        <Card
          className="group hover:border-primary/50 transition-all cursor-pointer hover:shadow-md"
          onClick={() => router.push('/import')}
        >
          <CardHeader>
            <div className="mb-4 h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
              <Github className="h-6 w-6" />
            </div>
            <CardTitle>Import Git Repository</CardTitle>
            <CardDescription>
              Connect your GitHub account to automatically deploy repositories and setup CD.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              Import from GitHub
            </Button>
          </CardContent>
        </Card>

        {/* Option 2: Manual URL */}
        <Card
          className="group hover:border-primary/50 transition-all cursor-pointer hover:shadow-md"
          onClick={() => setMode('manual')}
        >
          <CardHeader>
            <div className="mb-4 h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform">
              <Globe className="h-6 w-6" />
            </div>
            <CardTitle>Manual Import</CardTitle>
            <CardDescription>
              Deploy any public Git repository by proper URL. Good for quick tests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">
              Continue Manually
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
