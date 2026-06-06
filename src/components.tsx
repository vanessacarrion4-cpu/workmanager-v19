/**
 * components.tsx
 * Barrel re-export — todos los componentes compartidos.
 * Los archivos reales están en archivos separados.
 */

export { getTagColor } from './helpers';
export { RecurrenceChoiceModal, BlockModal, InstancesModal } from './Modals';
export { TimerDisplay, TimeManagementPanel, MonthDatePicker } from './TimeComponents';
export { DashboardHarmonicCalendar, BulkActionBar, ToggleExpandButton } from './DashboardComponents';
export {
  TaskTypeChip, TimePickerChip, DatePickerChip, RecurrencePickerChip,
  TagPickerChip, EstimatedTimeChip, RegisteredTimeChip, BlockPickerChip,
  DelegationChip
} from './Chips';
export { TaskCard } from './TaskCard';
