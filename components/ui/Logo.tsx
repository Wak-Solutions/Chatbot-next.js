/**
 * Logo — single source of truth for the WAK Solutions brand mark.
 *
 * TODO(design): replace public/wak-logo-mark.png with a full lockup SVG
 * once the design team delivers one. The `variant` prop is set up so
 * "lockup" / "wordmark" can be added without touching call sites.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

type LogoVariant = 'mark';
type LogoSize = 'sm' | 'md' | 'lg' | number;

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
  priority?: boolean;
}

const PRESET_HEIGHTS: Record<Exclude<LogoSize, number>, number> = {
  sm: 24,
  md: 36,
  lg: 56,
};

// Aspect ratio of public/wak-logo-mark.png (600 × 391). If the asset
// gets re-cropped, recompute this so width/height stay in sync.
const ASPECT = 600 / 391;

export function Logo({ variant = 'mark', size = 'md', className, priority = false }: LogoProps) {
  void variant; // reserved for future lockup/wordmark variants
  const height = typeof size === 'number' ? size : PRESET_HEIGHTS[size];
  const width = Math.round(height * ASPECT);

  return (
    <Image
      src="/wak-logo-mark.png"
      alt="WAK Solutions"
      width={width}
      height={height}
      priority={priority}
      className={cn('select-none', className)}
    />
  );
}

export default Logo;
