'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, Eye, EyeOff } from 'lucide-react';

export interface EnvVar {
  key: string;
  value: string;
}

interface EnvVarEditorProps {
  vars: EnvVar[];
  onChange: (vars: EnvVar[]) => void;
}

export function EnvVarEditor({ vars, onChange }: EnvVarEditorProps) {
  const [showValues, setShowValues] = useState(false);

  const addEnvVar = () => {
    onChange([...vars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    const newVars = [...vars];
    newVars.splice(index, 1);
    onChange(newVars);
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...vars];
    newVars[index][field] = value;
    onChange(newVars);
  };

  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n') || text.includes('=')) {
      e.preventDefault();
      const pastedVars: EnvVar[] = [];
      text.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          pastedVars.push({ key: match[1].trim(), value: match[2].trim() });
        }
      });

      if (pastedVars.length > 0) {
        const currentVars = [...vars];
        const isCurrentRowEmpty = !currentVars[index].key && !currentVars[index].value;
        if (isCurrentRowEmpty) {
          currentVars.splice(index, 1, ...pastedVars);
        } else {
          currentVars.splice(index + 1, 0, ...pastedVars);
        }
        onChange(currentVars);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Label>Environment Variables</Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => setShowValues(!showValues)}
          >
            {showValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </Button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addEnvVar} className="h-8">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      <div className="space-y-2">
        {vars.map((env, index) => (
          <div key={index} className="flex gap-2 items-start">
            <Input
              placeholder="KEY"
              value={env.key}
              onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              className="font-mono text-xs"
            />
            <Input
              placeholder="VALUE"
              value={env.value}
              onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              className="font-mono text-xs"
              type={showValues ? 'text' : 'password'}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => removeEnvVar(index)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        {vars.length === 0 && (
          <div
            className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-lg cursor-text hover:bg-muted/50 transition-colors"
            onClick={addEnvVar}
          >
            Click to add or paste .env content here
          </div>
        )}
        {/* Invisible input to catch paste events on the empty state area */}
        {vars.length === 0 && (
          <textarea
            className="absolute opacity-0 w-0 h-0"
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              const newVars: EnvVar[] = [];
              text.split('\n').forEach((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const match = trimmed.match(/^([^=]+)=(.*)$/);
                if (match) {
                  newVars.push({
                    key: match[1].trim(),
                    value: match[2].trim(),
                  });
                }
              });
              if (newVars.length > 0) onChange(newVars);
            }}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}
