/**
 * Deterministic avatar color from any stable id (phone number, contact id,
 * email). Draws from the brand palette only; bright surfaces (cyan, amber)
 * pair with dark text for contrast, the rest with white.
 */

interface AvatarTone {
  bg: string;   // Tailwind background class
  text: string; // Tailwind text class for the initials
}

const TONES: readonly AvatarTone[] = [
  { bg: 'bg-brand-blue',    text: 'text-white' },
  { bg: 'bg-brand-cyan',    text: 'text-brand-ink' },
  { bg: 'bg-brand-emerald', text: 'text-white' },
  { bg: 'bg-brand-violet',  text: 'text-white' },
  { bg: 'bg-brand-amber',   text: 'text-brand-ink' },
  { bg: 'bg-brand-slate',   text: 'text-white' },
];

export function avatarColor(id: string): AvatarTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TONES[Math.abs(hash) % TONES.length];
}
