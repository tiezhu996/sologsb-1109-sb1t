import { SHIFT_TEAMS, type ProcessBatch, type ProcessSegment, type ShiftTeam } from '../types/process-batch';

/** 轮班规则：某班交棒后等待的下一班（甲→乙→丙→甲） */
export function nextTeamOf(team: ShiftTeam): ShiftTeam {
  const index = SHIFT_TEAMS.indexOf(team);
  return SHIFT_TEAMS[(index + 1) % SHIFT_TEAMS.length];
}

/** 累计炮制时长（min）：全部段时长之和 */
export function totalDuration(batch: Pick<ProcessBatch, 'segments'>): number {
  return batch.segments.reduce((sum, seg) => sum + (Number(seg.durationMin) || 0), 0);
}

/** 是否全部段均已接班确认（全部确认后才允许完工判定与锁定） */
export function allConfirmed(batch: Pick<ProcessBatch, 'segments'>): boolean {
  return batch.segments.length > 0 && batch.segments.every((seg) => seg.status === '已确认');
}

/** 取当前待接班的段（同一时刻最多一段待确认） */
export function pendingSegment(batch: Pick<ProcessBatch, 'segments'>): ProcessSegment | undefined {
  return batch.segments.find((seg) => seg.status === '待接班');
}

/** 批次等待接班的班组（无待接片段时返回 undefined） */
export function awaitingTeam(batch: Pick<ProcessBatch, 'segments'>): ShiftTeam | undefined {
  return pendingSegment(batch)?.awaitTeam;
}

/** 批次是否处于跨班交接等待中 */
export function isAwaitingHandover(batch: Pick<ProcessBatch, 'segments'>): boolean {
  return Boolean(pendingSegment(batch));
}

/** 末段锅温（℃）：完工判定以出锅前最后一段锅温为准 */
export function lastTemp(batch: Pick<ProcessBatch, 'segments'>): number {
  return batch.segments.reduce((last, seg) => (Number(seg.temp) || last), 0);
}

/** 各班段数汇总，如「甲班 1 段 / 乙班 1 段」 */
export function segmentSummary(batch: Pick<ProcessBatch, 'segments'>): string {
  const count = new Map<ShiftTeam, number>();
  batch.segments.forEach((seg) => count.set(seg.team, (count.get(seg.team) ?? 0) + 1));
  return SHIFT_TEAMS.filter((team) => count.has(team))
    .map((team) => `${team} ${count.get(team)} 段`)
    .join(' / ');
}

/** 由最终重量与投料量计算得率（%） */
export function calcYieldRate(feedKg: number, outputKg: number): number {
  if (feedKg <= 0) return 0;
  return Number(((outputKg / feedKg) * 100).toFixed(1));
}
