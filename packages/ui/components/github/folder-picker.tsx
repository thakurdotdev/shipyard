'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronRight, FolderOpen } from 'lucide-react';
import { FrameworkIcon } from '@/components/ui/framework-icons';

interface Folder {
  path: string;
  name: string;
  framework: string | null;
  frameworkInfo: {
    name: string;
    icon: string;
    color: string;
  };
  hasPackageJson: boolean;
}

interface FolderPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (folder: Folder) => void;
  installationId: string;
  owner: string;
  repo: string;
}

export function FolderPicker({
  isOpen,
  onClose,
  onSelect,
  installationId,
  owner,
  repo,
}: FolderPickerProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('./');

  useEffect(() => {
    if (isOpen && installationId && owner && repo) {
      fetchFolders();
    }
  }, [isOpen, installationId, owner, repo]);

  const fetchFolders = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/github/installations/${installationId}/repositories/${owner}/${repo}/folders`,
        { credentials: 'include' },
      );

      if (!res.ok) {
        throw new Error('Failed to fetch repository structure');
      }

      const data = await res.json();
      setFolders(data.folders || []);

      // Select root by default if available
      if (data.folders?.length > 0) {
        setSelectedPath(data.folders[0].path);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load folders');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    const selected = folders.find((f) => f.path === selectedPath);
    if (selected) {
      onSelect(selected);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Root Directory
          </DialogTitle>
          <DialogDescription>
            Select the directory where your source code is located. To deploy a monorepo, create
            separate projects for other directories.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading repository structure...
              </span>
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={fetchFolders} className="mt-2">
                Retry
              </Button>
            </div>
          ) : (
            <RadioGroup value={selectedPath} onValueChange={setSelectedPath} className="space-y-2">
              {folders.map((folder) => (
                <div
                  key={folder.path}
                  className={`flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedPath === folder.path
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent'
                  }`}
                  onClick={() => setSelectedPath(folder.path)}
                >
                  <RadioGroupItem value={folder.path} id={folder.path} />
                  <Label
                    htmlFor={folder.path}
                    className="flex-1 flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      {folder.path !== './' && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{folder.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FrameworkIcon icon={folder.frameworkInfo.icon} size={18} />
                    </div>
                  </Label>
                </div>
              ))}

              {folders.length === 0 && !loading && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No deployable directories found. Make sure your project has a package.json file.
                </p>
              )}
            </RadioGroup>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={!selectedPath || loading}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
