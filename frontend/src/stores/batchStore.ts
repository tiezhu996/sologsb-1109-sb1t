import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { judgeDegree } from '../utils/degree';
import { allConfirmed, calcYieldRate, lastSegment, lastTemp, totalDuration } from '../utils/segment';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree, ProcessSegment } from '../types/process-batch';

/** 新建工序记录时的首段（待接班）信息 */
export interface FirstSegmentInput {
  team: string;
  nextTeam?: string;
  temp: number;
  durationMin: number;
  handoverNote?: string;
  startedAt: string;
  endedAt: string;
}

export interface BatchInput {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: ProcessBatch['fireLevel'];
  startedAt: string;
  endedAt: string;
  remark?: string;
  firstSegment: FirstSegmentInput;
}

/** 下一班接续时新增的分段（先标记待接班） */
export interface AddSegmentInput {
  team: string;
  nextTeam?: string;
  temp: number;
  durationMin: number;
  handoverNote?: string;
  startedAt: string;
  endedAt: string;
}

export interface BatchPatch {
  batchNo?: string;
  herbId?: string;
  methodId?: string;
  feedKg?: number;
  auxUsedKg?: number;
  fireLevel?: ProcessBatch['fireLevel'];
  remark?: string;
  /** 质检员改判最终重量后重算得率/程度 */
  outputKg?: number;
  degree?: ProcessDegree;
}

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createBatch: (input: BatchInput) => Promise<ProcessBatch>;
  updateBatch: (id: string, patch: BatchPatch, force?: boolean) => Promise<boolean>;
  removeBatch: (id: string) => Promise<void>;
  /** 接班后新增一段（上一段必须已确认；新段先待接班） */
  addSegment: (id: string, input: AddSegmentInput) => Promise<boolean>;
  /** 下一班确认当前待接班段 */
  confirmSegment: (batchId: string, segmentId: string, confirmedBy: string) => Promise<boolean>;
  /** 全部段确认后录入最终重量，按累计时长与最终重量判定得率与程度 */
  finalizeBatch: (id: string, outputKg: number, method: ProcessingMethod, degreeOverride?: ProcessDegree) => Promise<boolean>;
  /** 完工判定后锁定该批；未完工判定不允许锁定 */
  lockBatch: (id: string) => Promise<boolean>;
  /** 质检员放行/改判：仅质检员可解锁 */
  unlockAsQc: (id: string, qcBy: string) => Promise<void>;
  degreeCount: () => Record<ProcessDegree, number>;
  pendingBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

function buildSegment(seq: number, input: FirstSegmentInput): ProcessSegment {
  return {
    id: uid('seg'),
    seq,
    team: input.team.trim(),
    nextTeam: input.nextTeam?.trim() || undefined,
    temp: Number(input.temp) || 0,
    durationMin: Number(input.durationMin) || 0,
    handoverNote: input.handoverNote?.trim() || '',
    status: '待接班',
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const batches = await db.batches.orderBy('startedAt').reverse().toArray();
    set({ batches, hydrated: true });
  },

  createBatch: async (input) => {
    const batch: ProcessBatch = {
      id: uid('batch'),
      batchNo: input.batchNo.trim(),
      herbId: input.herbId,
      methodId: input.methodId,
      feedKg: Number(input.feedKg) || 0,
      auxUsedKg: Number(input.auxUsedKg) || 0,
      fireLevel: input.fireLevel,
      startedAt: input.firstSegment.startedAt,
      endedAt: input.firstSegment.endedAt,
      segments: [buildSegment(1, input.firstSegment)],
      finalized: false,
      locked: false,
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  updateBatch: (id: string, patch: BatchPatch, force?: boolean) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return Promise.resolve(false);
    }
    if (current.locked && !force) {
      return Promise.resolve(false);
    }
    // 质检员改判最终重量：按累计时长与最终重量重新判定得率与程度
    const recompute = current.finalized && typeof patch.outputKg === 'number';
    const run = async (): Promise<boolean> => {
      const next: ProcessBatch = { ...current, ...patch };
      if (recompute) {
        const method = await db.methods.get(current.methodId);
        next.outputKg = Number(patch.outputKg) || 0;
        next.yieldRate = calcYieldRate(current.feedKg, next.outputKg ?? 0);
        if (method) {
          const verdict = judgeDegree({
            method,
            fireLevel: next.fireLevel,
            duration: totalDuration(next),
            temp: lastTemp(next) ?? Math.round((method.tempRange[0] + method.tempRange[1]) / 2),
            yieldRate: next.yieldRate ?? 0,
          });
          next.degree = patch.degree ?? verdict.degree;
        }
      }
      if (force) {
        next.qcBy = next.qcBy ?? '质检员 · 赵敏';
      }
      await db.batches.put(next);
      set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
      return true;
    };
    return run();
  },

  removeBatch: async (id) => {
    await db.batches.delete(id);
    set({ batches: get().batches.filter((b) => b.id !== id) });
  },

  addSegment: async (id, input) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked || current.finalized) {
      return false;
    }
    const last = lastSegment(current);
    if (last && last.status !== '已确认') {
      // 上一段还在等接班确认，不能继续加段
      return false;
    }
    const segment = buildSegment(current.segments.length + 1, {
      team: input.team,
      nextTeam: input.nextTeam,
      temp: input.temp,
      durationMin: input.durationMin,
      handoverNote: input.handoverNote,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    });
    const next: ProcessBatch = {
      ...current,
      segments: [...current.segments, segment],
      endedAt: input.endedAt,
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  confirmSegment: async (batchId, segmentId, confirmedBy) => {
    const current = get().batches.find((b) => b.id === batchId);
    if (!current || current.locked || current.finalized) {
      return false;
    }
    // 只能确认当前待接班段（通常是最后一段）
    const target = current.segments.find((s) => s.id === segmentId);
    if (!target || target.status !== '待接班') {
      return false;
    }
    const at = new Date().toISOString();
    const next: ProcessBatch = {
      ...current,
      segments: current.segments.map((s) =>
        s.id === segmentId
          ? { ...s, status: '已确认', confirmedBy: confirmedBy.trim() || s.nextTeam || '接班班组', confirmedAt: at }
          : s,
      ),
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === batchId ? next : b)) });
    return true;
  },

  finalizeBatch: async (id, outputKg, method, degreeOverride) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.locked || current.finalized) {
      return false;
    }
    // 全部段确认后才允许完工判定
    if (!allConfirmed(current)) {
      return false;
    }
    const output = Number(outputKg) || 0;
    if (current.feedKg <= 0 || output <= 0) {
      return false;
    }
    const yieldRate = calcYieldRate(current.feedKg, output);
    const verdict = judgeDegree({
      method,
      fireLevel: current.fireLevel,
      duration: totalDuration(current),
      temp: lastTemp(current) ?? Math.round((method.tempRange[0] + method.tempRange[1]) / 2),
      yieldRate,
    });
    const at = new Date().toISOString();
    const next: ProcessBatch = {
      ...current,
      outputKg: output,
      yieldRate,
      degree: degreeOverride ?? verdict.degree,
      finalized: true,
      finalizedAt: at,
      endedAt: at,
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  lockBatch: async (id) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || !current.finalized || current.locked) {
      // 未完工判定（分段未全部确认或未录最终重量）不允许锁定
      return false;
    }
    const next: ProcessBatch = { ...current, locked: true, lockedAt: new Date().toISOString() };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  unlockAsQc: async (id, qcBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: false, qcBy };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
  },

  degreeCount: () => {
    const result: Record<ProcessDegree, number> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      if (b.degree) result[b.degree] += 1;
    });
    return result;
  },

  pendingBatches: () => get().batches.filter((b) => !b.locked),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
