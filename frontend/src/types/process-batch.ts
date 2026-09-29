import type { FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/** 分段状态：本段已由下一班/质检员确认，还是等待接班确认 */
export type SegmentStatus = '待接班' | '已确认';

/**
 * 工序分段：炮制常跨班完成，一个工序记录由多段组成。
 * 新增段先标记「待接班」，经下一班确认后状态才变为「已确认」。
 */
export interface ProcessSegment {
  id: string;
  /** 段序号，从 1 开始 */
  seq: number;
  /** 本段作业班组（操作班组） */
  team: string;
  /** 本段实际锅温（℃） */
  temp: number;
  /** 本段炮制时长（min） */
  durationMin: number;
  /** 交接说明（留给下一班的火候/色泽/注意事项） */
  handoverNote: string;
  /** 等待哪个班组来接班确认 */
  nextTeam?: string;
  /** 待接班 / 已确认 */
  status: SegmentStatus;
  /** 接班确认人（班组或质检员） */
  confirmedBy?: string;
  /** 接班确认时间 ISO */
  confirmedAt?: string;
  /** 本段开始时间 ISO */
  startedAt: string;
  /** 本段结束时间 ISO（待接班段为交班时刻） */
  endedAt: string;
}

/** 炮制工序记录（支持跨班分段） */
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
  /** 火候 */
  fireLevel: FireLevel;
  /** 开工时间 ISO（第一段开始） */
  startedAt: string;
  /** 全部段确认、完工判定时的时间 ISO */
  endedAt: string;
  /** 工序分段（跨班时为多段） */
  segments: ProcessSegment[];
  /** 炮制后最终重量（kg），完工判定时录入 */
  outputKg?: number;
  /** 得率（%），全部段确认后按最终重量折算 */
  yieldRate?: number;
  /** 程度判定，完工判定后才有值 */
  degree?: ProcessDegree;
  /** 全部段确认且完成完工判定（得率/程度已定） */
  finalized: boolean;
  /** 完工判定时间 ISO */
  finalizedAt?: string;
  /** 完工判定后锁定，仅质检员可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 质检员放行/改判人 */
  qcBy?: string;
  /** 备注 */
  remark?: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];

/** 默认班组（新建分段时下拉可直接选用） */
export const DEFAULT_TEAMS = ['甲班', '乙班', '丙班'];
