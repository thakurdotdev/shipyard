'use client';

import { cn } from '@/lib/utils';
import { Check, X, Loader2, Globe, Shield, Server, Rocket, HeartPulse, Circle } from 'lucide-react';

interface DeploymentPipelineProps {
  status: string;
  statusMessage?: string;
}

// Define the pipeline stages in order
const PIPELINE_STAGES = [
  { key: 'dns', label: 'DNS Setup', icon: Globe, statuses: ['dns_creating', 'dns_created'] },
  { key: 'ssl', label: 'SSL Certificate', icon: Shield, statuses: ['ssl_issuing', 'ssl_issued'] },
  {
    key: 'nginx',
    label: 'Proxy Config',
    icon: Server,
    statuses: ['nginx_configuring', 'nginx_configured'],
  },
  { key: 'app', label: 'App Start', icon: Rocket, statuses: ['app_starting'] },
  { key: 'health', label: 'Health Check', icon: HeartPulse, statuses: ['health_checking'] },
] as const;

type StageState = 'pending' | 'in_progress' | 'completed' | 'failed';

function getStageState(stageKey: string, currentStatus: string): StageState {
  if (currentStatus === 'failed') {
    // Find which stage the failure occurred at by checking the status
    const stageIndex = PIPELINE_STAGES.findIndex((s) => s.key === stageKey);
    const currentStageIndex = getActiveStageIndex(currentStatus);
    if (stageIndex < currentStageIndex) return 'completed';
    if (stageIndex === currentStageIndex) return 'failed';
    return 'pending';
  }

  if (currentStatus === 'active') return 'completed';
  if (currentStatus === 'inactive') return 'pending';
  if (currentStatus === 'pending') return 'pending';

  // Determine based on pipeline position
  const stageIndex = PIPELINE_STAGES.findIndex((s) => s.key === stageKey);
  const activeIndex = getActiveStageIndex(currentStatus);

  if (stageIndex < activeIndex) return 'completed';
  if (stageIndex === activeIndex) return 'in_progress';
  return 'pending';
}

function getActiveStageIndex(status: string): number {
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    if ((PIPELINE_STAGES[i].statuses as readonly string[]).includes(status)) return i;
  }
  // For 'active' / 'health_checking' — last stage
  if (status === 'health_checking') return 4;
  if (status === 'active') return 5; // beyond all stages
  return -1;
}

function StageIcon({ state, Icon }: { state: StageState; Icon: any }) {
  switch (state) {
    case 'completed':
      return (
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
          <Check className="w-4 h-4 text-emerald-400" />
        </div>
      );
    case 'in_progress':
      return (
        <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center animate-pulse">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
        </div>
      );
    case 'failed':
      return (
        <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center">
          <X className="w-4 h-4 text-red-400" />
        </div>
      );
    default:
      return (
        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
          <Icon className="w-4 h-4 text-zinc-500" />
        </div>
      );
  }
}

function ConnectorLine({ state }: { state: StageState }) {
  return (
    <div
      className={cn(
        'flex-1 h-0.5 mx-1 rounded-full transition-colors duration-500',
        state === 'completed' && 'bg-emerald-500/50',
        state === 'in_progress' && 'bg-blue-500/30 animate-pulse',
        state === 'failed' && 'bg-red-500/30',
        state === 'pending' && 'bg-zinc-800',
      )}
    />
  );
}

/**
 * Visual deployment pipeline showing each stage of the deployment process:
 * DNS → SSL → Nginx → App → Health Check → Live ✓
 *
 * Each step shows pending (grey), in-progress (blue spinner), success (green ✓), failed (red ✗)
 */
export function DeploymentPipeline({ status, statusMessage }: DeploymentPipelineProps) {
  // Don't show pipeline for simple statuses
  if (!status || status === 'inactive' || status === 'pending') return null;

  // For 'active' without going through pipeline (legacy), just show "Live"
  if (status === 'active' && !statusMessage) return null;

  const isActive = status === 'active';

  return (
    <div className="space-y-3">
      {/* Pipeline Visualization */}
      <div className="flex items-center gap-0 py-2 px-1">
        {PIPELINE_STAGES.map((stage, index) => {
          const state = getStageState(stage.key, status);
          const nextState =
            index < PIPELINE_STAGES.length - 1
              ? getStageState(PIPELINE_STAGES[index + 1].key, status)
              : 'pending';

          return (
            <div key={stage.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1.5 min-w-[4rem]">
                <StageIcon state={state} Icon={stage.icon} />
                <span
                  className={cn(
                    'text-[10px] font-medium text-center leading-tight',
                    state === 'completed' && 'text-emerald-400',
                    state === 'in_progress' && 'text-blue-400',
                    state === 'failed' && 'text-red-400',
                    state === 'pending' && 'text-zinc-500',
                  )}
                >
                  {stage.label}
                </span>
              </div>
              {index < PIPELINE_STAGES.length - 1 && (
                <ConnectorLine state={state === 'completed' ? 'completed' : 'pending'} />
              )}
            </div>
          );
        })}

        {/* Final "Live" indicator */}
        <div className="flex flex-col items-center gap-1.5 min-w-[4rem]">
          {isActive ? (
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <Circle className="w-4 h-4 text-zinc-500" />
            </div>
          )}
          <span
            className={cn(
              'text-[10px] font-medium',
              isActive ? 'text-emerald-400' : 'text-zinc-500',
            )}
          >
            Live
          </span>
        </div>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div
          className={cn(
            'text-xs px-3 py-2 rounded-md',
            status === 'failed'
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : status === 'active'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
          )}
        >
          {statusMessage}
        </div>
      )}
    </div>
  );
}
