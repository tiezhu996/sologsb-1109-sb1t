import type { FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/** 班组（炮制常跨班，按班组交接） */
export type ShiftTeam = '甲班' | '乙班' | '丙班';

/** 班组顺序：新增段默认等待下一班（循环轮班） */
export const SHIFT_TEAMS: ShiftTeam[] = ['甲班', '乙班', '丙班'];

/** 段状态：新增段先待接班，下一班确认后才能继续 */
export type SegmentStatus = '待接班' | '已确认';

/** 工序分段：炮制跨班时每一班记一段 */
export interface ProcessSegment {
  id: string;
  /** 序号（从 1 开始） */
  seq: number;
  /** 本段负责班组 */
  team: ShiftTeam;
  /** 本段锅温（℃） */
  temp: number;
  /** 本段炮制时长（min） */
  durationMin: number;
  /** 交接说明：本段做到哪里、下一班注意什么 */
  handover: string;
  /** 待接班 / 已确认 */
  status: SegmentStatus;
  /** 本段等待哪个班组接班确认（status=待接班 时有值） */
  awaitTeam?: ShiftTeam;
  /** 本段开始时间 ISO */
  startedAt: string;
  /** 本段交接时间 ISO */
  endedAt: string;
  /** 接班确认时间 ISO */
  confirmedAt?: string;
  /** 接班确认人 */
  confirmedBy?: string;
}

/** 炮制工序记录（跨班时由多个已交接的段组成） */
export interface ProcessBatch {
  id: string;
  /** 生产批号 */
  batchNo: string;
  /** 关联药材 */
  herbId: string;
  /** 采用方法 */
  methodId: string;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg: number;
  /** 火力 */
  fireLevel: FireLevel;
  /** 开始时间 ISO（首段开始） */
  startedAt: string;
  /** 结束时间 ISO（末段交接） */
  endedAt: string;
  /** 得率（%）：全部段确认、录入最终重量后才有值 */
  yieldRate?: number;
  /** 程度判定：全部段确认、按累计时长与最终重量判定后才有值 */
  degree?: ProcessDegree;
  /** 工序分段 */
  segments: ProcessSegment[];
  /** 最终重量（kg）：全部段确认后完工称量 */
  outputKg?: number;
  /** 全部段确认且得率程度判定后锁定，仅质检员可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 质检员放行/改判人 */
  qcBy?: string;
  /** 备注 */
  remark?: string;
  /** 旧版单操作人字段（v3 迁移前历史数据保留，仅回退展示） */
  operator?: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];
