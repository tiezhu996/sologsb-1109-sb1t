import { create } from 'zustand';
import { db, migrateBatchSegment } from '../utils/db';
import { uid } from '../utils/id';
import { allConfirmed, nextTeamOf } from '../utils/segment';
import type { ProcessingMethod } from '../types/processing-method';
import type { FireLevel } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree, ProcessSegment, ShiftTeam } from '../types/process-batch';

export interface BatchInput {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  remark?: string;
}

/** 新增段内容（新增段一律先标记为「待接班」） */
export interface SegmentInput {
  team: ShiftTeam;
  temp: number;
  durationMin: number;
  handover: string;
  startedAt: string;
  endedAt: string;
}

/** 表头与可改字段补丁 */
export type BatchPatch = Partial<BatchInput> &
  Partial<Pick<ProcessBatch, 'outputKg' | 'yieldRate' | 'degree' | 'lockedAt'>> & {
    segments?: ProcessSegment[];
  };

/** 全部段确认后的完工判定 */
export interface FinalizeInput {
  outputKg: number;
  yieldRate: number;
  degree: ProcessDegree;
}

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 新建工序记录：含首段，首段先待接班 */
  createBatch: (input: BatchInput, firstSegment: SegmentInput) => Promise<ProcessBatch>;
  /** 更新批号/药材/方法/投料等表头信息（锁定批仅质检员 force 可改） */
  updateBatch: (id: string, patch: BatchPatch, force?: boolean) => Promise<boolean>;
  /** 修改尚未接班确认的段（已确认的段不可改） */
  updatePendingSegment: (id: string, segmentId: string, patch: Partial<Omit<ProcessSegment, 'id' | 'seq' | 'status'>>) => Promise<boolean>;
  /** 新增一段：上一段必须已接班确认 */
  appendSegment: (id: string, input: SegmentInput) => Promise<boolean>;
  /** 下一班接班确认待接片段，确认后才允许继续下一段 */
  confirmSegment: (id: string, segmentId: string, confirmedBy: string) => Promise<boolean>;
  /** 全部段确认后，按累计时长与最终重量完成得率与程度判定（仍未锁定） */
  finalizeBatch: (id: string, input: FinalizeInput) => Promise<boolean>;
  removeBatch: (id: string) => Promise<void>;
  /** 锁定该批：仅全部段确认且已完成完工判定时允许 */
  lockBatch: (id: string) => Promise<boolean>;
  /** 质检员放行/改判：仅质检员可解锁 */
  unlockAsQc: (id: string, qcBy: string) => Promise<void>;
  degreeCount: () => Partial<Record<ProcessDegree, number>>;
  /** 未锁定批次（含待接班与待完工判定） */
  pendingBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

function persist(batches: ProcessBatch[]) {
  return { batches };
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const rows = await db.batches.orderBy('startedAt').reverse().toArray();
    // 兼容导入的旧版备份（未经过 v3 upgrade）：补默认单段并写回
    const methods = await db.methods.toArray();
    const methodMap = new Map(methods.map((m) => [m.id, m]));
    const migrated: ProcessBatch[] = [];
    const batches = rows.map((row) => {
      if (!Array.isArray(row.segments) || row.segments.length === 0) {
        migrateBatchSegment(row, methodMap.get(row.methodId) as ProcessingMethod | undefined);
        migrated.push(row);
      }
      return row;
    });
    if (migrated.length > 0) {
      await db.batches.bulkPut(migrated);
    }
    set({ batches, hydrated: true });
  },

  createBatch: async (input, firstSegment) => {
    const segment: ProcessSegment = {
      id: uid('seg'),
      seq: 1,
      team: firstSegment.team,
      temp: Number(firstSegment.temp) || 0,
      durationMin: Number(firstSegment.durationMin) || 0,
      handover: firstSegment.handover.trim(),
      status: '待接班',
      awaitTeam: nextTeamOf(firstSegment.team),
      startedAt: firstSegment.startedAt,
      endedAt: firstSegment.endedAt,
    };
    const batch: ProcessBatch = {
      id: uid('batch'),
      batchNo: input.batchNo.trim(),
      herbId: input.herbId,
      methodId: input.methodId,
      feedKg: Number(input.feedKg) || 0,
      auxUsedKg: Number(input.auxUsedKg) || 0,
      fireLevel: input.fireLevel,
      startedAt: firstSegment.startedAt,
      endedAt: firstSegment.endedAt,
      segments: [segment],
      locked: false,
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  updateBatch: async (id, patch, force = false) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    if (current.locked && !force) {
      return false;
    }
    const next: ProcessBatch = { ...current, ...patch };
    if (force) {
      next.qcBy = next.qcBy ?? '质检员 · 赵敏';
    }
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  appendSegment: async (id, input) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked) {
      return false;
    }
    // 必须按顺序交接：存在待接片段时不能继续添加
    if (!allConfirmed(current)) {
      return false;
    }
    const segment: ProcessSegment = {
      id: uid('seg'),
      seq: current.segments.length + 1,
      team: input.team,
      temp: Number(input.temp) || 0,
      durationMin: Number(input.durationMin) || 0,
      handover: input.handover.trim(),
      status: '待接班',
      awaitTeam: nextTeamOf(input.team),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    };
    const next: ProcessBatch = {
      ...current,
      segments: [...current.segments, segment],
      endedAt: input.endedAt,
      // 加段继续加工，此前若有完工判定作废，需待全部段再次确认后重判
      yieldRate: undefined,
      degree: undefined,
      outputKg: undefined,
    };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  updatePendingSegment: async (id, segmentId, patch) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked) {
      return false;
    }
    const target = current.segments.find((s) => s.id === segmentId);
    if (!target || target.status !== '待接班') {
      return false;
    }
    const nextSegments = current.segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s));
    const edited = nextSegments.find((s) => s.id === segmentId)!;
    const isLastSegment = nextSegments[nextSegments.length - 1].id === segmentId;
    const next: ProcessBatch = {
      ...current,
      segments: nextSegments,
      // 待接片段必为末段，交班时间变化时同步批次结束时间
      endedAt: isLastSegment ? edited.endedAt : current.endedAt,
    };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  confirmSegment: async (id, segmentId, confirmedBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked) {
      return false;
    }
    const target = current.segments.find((s) => s.id === segmentId);
    if (!target || target.status !== '待接班') {
      return false;
    }
    const confirmedAt = new Date().toISOString();
    const next: ProcessBatch = {
      ...current,
      segments: current.segments.map((s) =>
        s.id === segmentId
          ? { ...s, status: '已确认', awaitTeam: undefined, confirmedAt, confirmedBy: confirmedBy.trim() }
          : s,
      ),
    };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  finalizeBatch: async (id, input) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked) {
      return false;
    }
    // 全部段确认后才允许按累计时长与最终重量判定
    if (!allConfirmed(current)) {
      return false;
    }
    const next: ProcessBatch = {
      ...current,
      outputKg: Number(input.outputKg) || 0,
      yieldRate: Number(input.yieldRate) || 0,
      degree: input.degree,
      endedAt: current.segments[current.segments.length - 1].endedAt,
    };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  removeBatch: async (id) => {
    await db.batches.delete(id);
    set(persist(get().batches.filter((b) => b.id !== id)));
  },

  lockBatch: async (id) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    // 全部段确认并完成得率、程度判定后才允许锁定
    if (!allConfirmed(current) || current.yieldRate === undefined || !current.degree) {
      return false;
    }
    const next: ProcessBatch = { ...current, locked: true, lockedAt: new Date().toISOString() };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
    return true;
  },

  unlockAsQc: async (id, qcBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: false, qcBy };
    await db.batches.put(next);
    set(persist(get().batches.map((b) => (b.id === id ? next : b))));
  },

  degreeCount: () => {
    const result: Partial<Record<ProcessDegree, number>> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      if (b.degree) {
        result[b.degree] = (result[b.degree] ?? 0) + 1;
      }
    });
    return result;
  },

  pendingBatches: () => get().batches.filter((b) => !b.locked),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
