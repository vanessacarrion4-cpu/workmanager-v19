/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TagType = 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto';
export type Priority = 'alta' | 'media' | 'baja';

export interface WorkBlock {
  id: string;
  name: string;
  color: string; // Hex color
  pastelColor: string; // Pastel version
  icon: string; // Lucide icon name
  order: number;
  isActive: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
}

export interface SubtaskTemplate {
  id: string;
  title: string;
  notes?: string;
  tags?: TagType[];
  estimatedMinutes?: number;
  priority?: Priority;
  
  // Recurrence for subtasks
  recurrence?: {
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly';
    weekDays?: number[]; // [0=lunes...6=domingo]
    monthDay?: number; // 1-31
    startDate: string; // YYYY-MM-DD
    endDate?: string | null;
  };
  
  // For non-recurrent subtasks with specific date
  dueDate?: string | null;
  subtasks?: SubtaskTemplate[];
  taskType?: 'core' | 'adhoc';
  delegation?: {
    personId: string;
    delegatedAt: string; // YYYY-MM-DD
  };
}

export interface Task {
  id: string;
  blockId: string;
  templateId?: string; // Links back to Template Parent if this is an instance
  instanceDate?: string; // The date this instance belongs to
  
  title: string;
  notes?: string;
  priority: Priority;
  parentTaskId?: string | null;
  subtasks?: string[]; // IDs of direct children
  
  status: 'pending' | 'completed';
  completedAt?: string | null;
  
  dueDate: string | null; // YYYY-MM-DD. For Template Parents, this can be null.
  dueTime?: string; // HH:mm
  
  estimatedMinutes: number;
  actualMinutes?: number;
  
  totalEstimatedCombo?: number;
  totalRegisteredCombo?: number;

  tags: TagType[];
  order: number;
  
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string | null;
  
  isTemplate?: boolean; // True if this is the "container" defined in Blocks view
  isActive?: boolean; // For templates, whether they should generate instances
  isException?: boolean; // True if edited individually
  isDeleted?: boolean; // For single instance deletion
  
  // Recurrence info - now on subtasks (if this Task is a subtask)
  recurrence?: {
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly';
    weekDays?: number[];
    monthDay?: number;
    startDate: string;
    endDate?: string | null;
  };

  attachments?: Attachment[];
  isExpanded?: boolean;
  taskType?: 'core' | 'adhoc';
  delegation?: {
    personId: string;
    delegatedAt: string; // YYYY-MM-DD
  };
}

export interface TimeEntry {
  id: string;
  taskId: string;
  subtaskId: string | null;
  date: string;
  duration: number;
  note?: string | null;
  createdAt: string;
  source: 'manual' | 'timer';
}

export type ViewType = 'dashboard' | 'blocks' | 'calendar' | 'delegadas' | 'search';

export interface Person {
  id: string;
  name: string;
  createdAt: string;
}

export interface DelegationMeetingItem {
  taskId: string;
  note: string;
}

export interface DelegationMeeting {
  id: string;
  personId: string;
  date: string; // YYYY-MM-DD
  notes: string; // General note for the meeting
  items: DelegationMeetingItem[];
  createdAt: string;
}
