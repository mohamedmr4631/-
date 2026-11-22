import type { Timestamp } from 'firebase/firestore';

export type EmployeeStatus = 'working' | 'break' | 'out';
export type AttendanceAction = 'check_in' | 'break_start' | 'break_end' | 'check_out';
export type AppTab = 'employee' | 'admin' | 'logs';
export type UserRole = 'admin' | 'user';
export type BreakRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export type AttendanceRequestType =
  | 'missed_check_in'
  | 'missed_check_out'
  | 'late_excuse'
  | 'early_leave'
  | 'leave';

export type AttendanceRequestStatus = 'pending' | 'approved' | 'rejected';

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  roleTitle: string;
  employeeId: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// Synchronized verbatim with firebase-blueprint.json constraints
export const SCHEMA_LIMITS = {
  BRANCH_NAME_MIN: 1,
  BRANCH_NAME_MAX: 80,
  SHIFT_NAME_MAX: 60,
  MAX_SHIFTS_PER_BRANCH: 20,
  IP_MAX: 64,
  IP_PATTERN: /^[0-9a-fA-F.:]*$/,
  TIME_HHMM_PATTERN: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
  DATE_YYYYMMDD_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  EMP_NAME_MIN: 2,
  EMP_NAME_MAX: 80,
  ROLE_TITLE_MAX: 60,
  USERNAME_MIN: 2,
  USERNAME_MAX: 60,
  PASSWORD_MIN: 4,
  PASSWORD_MAX: 100,
  PIN_MIN: 4,
  PIN_MAX: 12,
  SHA256_LENGTH: 64,
  SHA256_PATTERN: /^[a-f0-9]{64}$/,
  DEVICE_ID_MIN: 8,
  DEVICE_ID_MAX: 80,
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  BREAK_REASON_MAX: 200,
  ATTENDANCE_REQ_REASON_MAX: 250,
} as const;

export const DEFAULT_HR_POLICY = {
  SHIFT_START: '09:00',
  SHIFT_END: '17:00',
  GRACE_MINUTES: 10,
  MAX_BREAK_MINUTES: 30,
  TARGET_DAILY_HOURS: 8,
  RADIUS_METERS: 50,
} as const;

export interface BranchShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface Branch {
  id: string;
  name: string;
  allowedIp: string;
  geoEnabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  shiftStart: string;
  graceMinutes: number;
  maxBreakMinutes: number;
  targetDailyHours: number;
  shifts: BranchShift[];
  isActive: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

export interface BranchSettings {
  allowedIp: string;
  branchName: string;
  shiftStart?: string;
  graceMinutes?: number;
  maxBreakMinutes?: number;
  targetDailyHours?: number;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

export interface AdminSecret {
  passcodeHash: string;
  lockEnabled: boolean;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

export interface Employee {
  id: string;
  name: string;
  roleTitle: string;
  pinHash: string;
  status: EmployeeStatus;
  deviceId: string | null;
  branchId?: string | null;
  branchName?: string | null;
  shiftId?: string | null;
  shiftName?: string | null;
  lastCheckIn: number | null;
  lastCheckOut?: number | null;
  lastBreakStart: number | null;
  totalBreakMs: number;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  graceMinutes?: number | null;
  maxBreakMinutes?: number | null;
  targetDailyHours?: number | null;
  hourlyRate?: number | null;
  isActive: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  employeeName: string;
  action: AttendanceAction;
  ip: string;
  deviceId: string;
  createdByUid: string;
  manualRequestId?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  distanceMeters?: number | null;
  allowedRadiusMeters?: number | null;
  geoAccuracyMeters?: number | null;
  employeeCoords?: { lat: number; lng: number } | null;
  timestamp: Timestamp | null;
}

export interface BreakRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  reason: string;
  status: BreakRequestStatus;
  requestedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  notified: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AttendanceRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: AttendanceRequestType;
  targetDate: string;
  targetTime: string;
  targetTimestampMs: number | null;
  reason: string;
  status: AttendanceRequestStatus;
  requestedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  notified: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}
