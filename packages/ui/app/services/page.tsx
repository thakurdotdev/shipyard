'use client';

import { api } from '@/lib/api';
import { InfraService, ServiceType } from '@/lib/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Database, Server, Plus, Trash2, RotateCcw, Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ServicesPage() {
  const [services, setServices] = useState<InfraService[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('redis');
  const [bindLocalhost, setBindLocalhost] = useState(false);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const data = await api.getInfraServices();
      setServices(data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setCreating(true);
    try {
      const service = await api.createInfraService({
        name: name.trim(),
        service_type: serviceType,
        bind_localhost: bindLocalhost,
      });
      setServices([service, ...services]);
      setCreateOpen(false);
      setName('');
      setServiceType('redis');
      setBindLocalhost(false);
      toast.success(`${serviceType === 'redis' ? 'Redis' : 'PostgreSQL'} service created!`);

      // Show connection URL
      if (service.connection_url) {
        toast.info('Connection URL copied to clipboard', {
          description: service.connection_url.substring(0, 50) + '...',
        });
        navigator.clipboard.writeText(service.connection_url);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setDeleting(true);
    try {
      await api.deleteInfraService(deleteId);
      setServices(services.filter((s) => s.id !== deleteId));
      toast.success('Service deleted');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.restartInfraService(id);
      toast.success('Service restarting...');
      // Refresh after a delay
      setTimeout(loadServices, 2000);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const copyConnectionUrl = async (id: string) => {
    try {
      const service = await api.getInfraService(id);
      if (service.connection_url) {
        await navigator.clipboard.writeText(service.connection_url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
        toast.success('Connection URL copied!');
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-gray-500';
      case 'starting':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl py-10 px-4">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Infrastructure Services</h1>
          <p className="text-muted-foreground mt-1">
            Manage standalone Redis and PostgreSQL instances
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Service
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Infrastructure Service</DialogTitle>
              <DialogDescription>Spin up a new Redis or PostgreSQL instance</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="my-database"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Service Type</Label>
                <Select value={serviceType} onValueChange={(v) => setServiceType(v as ServiceType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="redis">
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-red-500" />
                        Redis
                      </div>
                    </SelectItem>
                    <SelectItem value="postgres">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-blue-500" />
                        PostgreSQL
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Localhost Only</Label>
                  <p className="text-xs text-muted-foreground">
                    Bind to 127.0.0.1 (requires SSH tunnel for external access)
                  </p>
                </div>
                <Switch checked={bindLocalhost} onCheckedChange={setBindLocalhost} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Service'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No services yet</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Create your first Redis or PostgreSQL service
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Service
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Card key={service.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {service.service_type === 'redis' ? (
                      <Server className="h-5 w-5 text-red-500" />
                    ) : (
                      <Database className="h-5 w-5 text-blue-500" />
                    )}
                    <CardTitle className="text-lg">{service.name}</CardTitle>
                  </div>
                  <Badge
                    variant="outline"
                    className={`${getStatusColor(service.status)} text-white border-0`}
                  >
                    {service.status}
                  </Badge>
                </div>
                <CardDescription>
                  {service.service_type === 'redis' ? 'Redis' : 'PostgreSQL'}{' '}
                  {service.version && `v${service.version}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground mb-4">
                  <div className="flex justify-between py-1">
                    <span>Port:</span>
                    <span className="font-mono">{service.port}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Host:</span>
                    <span className="font-mono text-xs">{service.host}</span>
                  </div>
                  {service.bind_localhost && (
                    <div className="flex justify-between py-1">
                      <span>Access:</span>
                      <span className="text-yellow-600">Localhost only</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => copyConnectionUrl(service.id)}
                  >
                    {copiedId === service.id ? (
                      <Check className="h-4 w-4 mr-1" />
                    ) : (
                      <Copy className="h-4 w-4 mr-1" />
                    )}
                    Copy URL
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestart(service.id)}
                    disabled={service.status === 'starting'}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => setDeleteId(service.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the container and delete all data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
