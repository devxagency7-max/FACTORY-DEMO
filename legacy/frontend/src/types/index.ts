// DTOs based on Phase 2 implementation

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Worker extends BaseEntity {
  employeeCode: string;
  fullName: string;
  position: string;
  status: string;
  departmentId: string;
  assignedAreaId?: string;
}

export interface Rule extends BaseEntity {
  name: string;
  eventTypeCondition: string;
  action: string;
  severity: number;
  isEnabled: boolean;
}

export interface AIEvent extends BaseEntity {
  eventType: string;
  timestamp: string;
  confidence: number;
  cameraId?: string;
  workerId?: string;
  zoneId?: string;
  evidenceJson: string;
}

export interface Violation extends BaseEntity {
  ruleId: string;
  rule?: Rule;
  aiEventId?: string;
  aiEvent?: AIEvent;
  workerId?: string;
  worker?: Worker;
  type: string;
  severity: number; // Low=0, Medium=1, High=2, Critical=3
  status: number; // Pending=0, Confirmed=1, Dismissed=2, Resolved=3
  detectedAt: string;
  reviewedAt?: string;
  reviewedBy: string;
  notes: string;
  evidenceReference: string;
}

export interface Camera extends BaseEntity {
  name: string;
  description: string;
  areaId: string;
  sourceType: number;
  sourceUrl: string;
  status: string;
}

export interface Zone extends BaseEntity {
  name: string;
  type: string;
  polygonJson: string;
  status: string;
  areaId: string;
}

export interface DashboardOverview {
  activeWorkers: number;
  pendingViolations: number;
  activeCameras: number;
}
