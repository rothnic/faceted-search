import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FilterChip({
  label,
  active = false,
  disabled = false,
  ariaLabel,
  onClick
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return <Button
    variant={active ? 'default' : 'secondary'}
    size="sm"
    className={`filter-chip${active ? ' filter-chip-active' : ''}`}
    type="button"
    disabled={disabled}
    aria-label={ariaLabel}
    aria-pressed={active}
    onClick={onClick}
  >
    <span>{label}</span>
    {active && <X aria-hidden="true" />}
  </Button>;
}
