'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Globe, Shield, RefreshCw, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useState } from 'react';

interface DomainStatusCardProps {
  projectId: string;
  domainProvision: any;
  onRefresh: () => void;
}

function StatusBadge({ status, type }: { status: string; type: 'dns' | 'ssl' }) {
  const getVariant = () => {
    switch (status) {
      case 'created':
      case 'proxied':
      case 'issued':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'creating':
      case 'issuing':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse';
      case 'failed':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      default:
        return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'created':
      case 'proxied':
      case 'issued':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'creating':
      case 'issuing':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'failed':
        return <XCircle className="w-3 h-3" />;
      default:
        return <Clock className="w-3 h-3" />;
    }
  };

  return (
    <Badge variant="outline" className={`text-[10px] h-5 gap-1 capitalize ${getVariant()}`}>
      {getIcon()}
      {status}
    </Badge>
  );
}

export function DomainStatusCard({ projectId, domainProvision, onRefresh }: DomainStatusCardProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  if (!domainProvision || !domainProvision.provisioned) {
    return null;
  }

  const hasFailed =
    domainProvision.dns_status === 'failed' || domainProvision.ssl_status === 'failed';

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await api.retryDomainProvision(projectId);
      toast.success('Domain provisioning retry started');
      onRefresh();
    } catch (error: any) {
      toast.error(`Retry failed: ${error.message}`);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className="border-border/50 shadow-sm bg-muted/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Domain Status
          </CardTitle>
          {hasFailed && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleRetry}
              disabled={isRetrying}
            >
              {isRetrying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Retry
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Domain name */}
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-mono text-zinc-300">{domainProvision.full_domain}</span>
        </div>

        {/* DNS Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Globe className="w-3.5 h-3.5" />
            <span>DNS Record</span>
          </div>
          <StatusBadge status={domainProvision.dns_status} type="dns" />
        </div>

        {/* SSL Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Shield className="w-3.5 h-3.5" />
            <span>SSL Certificate</span>
          </div>
          <StatusBadge status={domainProvision.ssl_status} type="ssl" />
        </div>

        {/* SSL Expiry */}
        {domainProvision.ssl_expiry && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Cert Expires</span>
            </div>
            <span className="text-xs text-zinc-500">
              {new Date(domainProvision.ssl_expiry).toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Error message */}
        {domainProvision.error_message && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-2 mt-2">
            {domainProvision.error_message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
