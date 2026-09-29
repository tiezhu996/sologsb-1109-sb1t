import type { ProcessBatch, ProcessSegment } from '../types/process-batch';

/** 累计各段炮制时长（min） */
export function totalDuration(batch: Pick<ProcessBatch, 'segments'>): number {
  return batch.segments.reduce((sum, seg) => sum + (Number(seg.durationMin) || 0), 0);
}

/** 全部段是否都已接班确认 */
export function allConfirmed(batch: Pick<ProcessBatch, 'segments'>): boolean {
  return batch.segments.length > 0 && batch.segments.every((seg) => seg.status === '已确认');
}

/** 最后一段（当前正在进行或刚交班的一段） */
export function lastSegment(batch: Pick<ProcessBatch, 'segments'>): ProcessSegment | undefined {
  return batch.segments[batch.segments.length - 1];
}

/** 待接班段（未确认）；没有则说明全部确认 */
export function pendingSegment(batch: Pick<ProcessBatch, 'segments'>): ProcessSegment | undefined {
  return batch.segments.find((seg) => seg.status === '待接班');
}

/** 列表/看板统一状态：等待哪个班组接班 */
export function waitingTeam(batch: ProcessBatch): string | undefined {
  return pendingSegment(batch)?.nextTeam;
}

/** 作业班组链（去重，按交班顺序），如「甲班 → 乙班」 */
export function teamChain(batch: Pick<ProcessBatch, 'segments'>): string[] {
  const teams: string[] = [];
  batch.segments.forEach((seg) => {
    if (!teams.includes(seg.team)) teams.push(seg.team);
  });
  return teams;
}

/** 最后一段锅温（℃）；完工判定按最终火候参考 */
export function lastTemp(batch: Pick<ProcessBatch, 'segments'>): number | undefined {
  return lastSegment(batch)?.temp;
}

/** 批次当前阶段文案 */
export type BatchPhase = 'handover' | 'ready' | 'finalized' | 'locked';

export function batchPhase(batch: ProcessBatch): BatchPhase {
  if (batch.locked) return 'locked';
  if (batch.finalized) return 'finalized';
  if (allConfirmed(batch)) return 'ready';
  return 'handover';
}

/** 按最终重量与投料量折算得率（%） */
export function calcYieldRate(feedKg: number, outputKg: number): number {
  if (feedKg <= 0) return 0;
  return Number(((outputKg / feedKg) * 100).toFixed(1));
}
