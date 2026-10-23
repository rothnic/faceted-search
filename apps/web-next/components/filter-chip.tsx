import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FilterChip({
  label,
  active = false,
  appearance = 'filter',
  disabled = false,
  ariaLabel,
  onClick
}: {
  label: string;
  active?: boolean;
  appearance?: 'filter' | 'card';
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  const showActiveState = active && appearance === 'filter';
  return <Button
    variant={showActiveState ? 'default' : 'secondary'}
    size="sm"
    className={`filter-chip${showActiveState ? ' filter-chip-active' : ''}${appearance === 'card' ? ' card-amenity-chip' : ''}`}
    type="button"
    disabled={disabled}
    aria-label={ariaLabel}
    aria-pressed={active}
    onClick={onClick}
  >
    <span>{label}</span>
    {showActiveState && <X aria-hidden="true" />}
  </Button>;
}
