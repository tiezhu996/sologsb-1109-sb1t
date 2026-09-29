import { db } from './db';
import { HERB_ORIGINS, type HerbMaterial } from '../types/herb-material';
import { METHOD_NAMES, type ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import { CABINETS, type RetainSample } from '../types/retain-sample';
import { judgeDegree, expectedYieldOf } from './degree';

/** 首次打开时写入的示例台账，便于直接查看各页面效果 */
export const SEED_HERBS: HerbMaterial[] = [
  { id: 'herb-001', name: '白术', origin: '植物', part: '根', batchNo: 'BT-2401', feedKg: 120, receivedAt: '2025-08-02T09:00:00.000Z', remark: '浙江磐安产' },
  { id: 'herb-002', name: '白芍', origin: '植物', part: '根', batchNo: 'BS-2402', feedKg: 80, receivedAt: '2025-08-05T09:00:00.000Z' },
  { id: 'herb-003', name: '当归', origin: '植物', part: '根', batchNo: 'DG-2403', feedKg: 60, receivedAt: '2025-08-06T09:00:00.000Z', remark: '甘肃岷县产' },
  { id: 'herb-004', name: '陈皮', origin: '植物', part: '果实', batchNo: 'CP-2404', feedKg: 45, receivedAt: '2025-08-08T09:00:00.000Z' },
  { id: 'herb-005', name: '黄芪', origin: '植物', part: '根', batchNo: 'HQ-2405', feedKg: 200, receivedAt: '2025-08-11T09:00:00.000Z' },
  { id: 'herb-006', name: '牡蛎', origin: '矿物', part: '果实', batchNo: 'ML-2406', feedKg: 150, receivedAt: '2025-08-12T09:00:00.000Z', remark: '煅用' },
  { id: 'herb-007', name: '全蝎', origin: '动物', part: '茎', batchNo: 'QX-2407', feedKg: 12, receivedAt: '2025-08-14T09:00:00.000Z' },
  { id: 'herb-008', name: '杜仲', origin: '植物', part: '茎', batchNo: 'DZ-2408', feedKg: 90, receivedAt: '2025-08-15T09:00:00.000Z', remark: '盐炙用' },
  { id: 'herb-009', name: '桑叶', origin: '植物', part: '叶', batchNo: 'SY-2409', feedKg: 55, receivedAt: '2025-08-18T09:00:00.000Z' },
  { id: 'herb-010', name: '甘草', origin: '植物', part: '根', batchNo: 'GC-2410', feedKg: 130, receivedAt: '2025-08-20T09:00:00.000Z' },
];

export const SEED_METHODS: ProcessingMethod[] = [
  { id: 'method-001', name: '清炒', auxiliary: '无', auxRatio: 0, fireLevel: '文火', tempRange: [90, 120], duration: 12, criterion: '表面微黄、气香、断面颜色加深', criterionDimension: '色泽', applicable: '白术、桑叶、陈皮' },
  { id: 'method-002', name: '麸炒', auxiliary: '麦麸', auxRatio: 10, fireLevel: '中火', tempRange: [130, 160], duration: 10, criterion: '色转深黄、麸皮焦香、无焦斑', criterionDimension: '色泽', applicable: '白术、黄芪、甘草' },
  { id: 'method-003', name: '酒炙', auxiliary: '黄酒', auxRatio: 10, fireLevel: '文火', tempRange: [100, 130], duration: 15, criterion: '色泽加深、酒气尽、断面棕黄', criterionDimension: '气味', applicable: '当归、白芍、黄芪' },
  { id: 'method-004', name: '醋炙', auxiliary: '米醋', auxRatio: 15, fireLevel: '文火', tempRange: [100, 130], duration: 14, criterion: '表面微亮、醋气尽、无焦糊', criterionDimension: '气味', applicable: '柴胡、延胡索' },
  { id: 'method-005', name: '盐炙', auxiliary: '食盐', auxRatio: 2, fireLevel: '文火', tempRange: [110, 140], duration: 12, criterion: '色泽加深、咸味均匀、断面油润', criterionDimension: '断面', applicable: '杜仲、黄柏' },
  { id: 'method-006', name: '蜜炙', auxiliary: '蜂蜜', auxRatio: 25, fireLevel: '中火', tempRange: [120, 150], duration: 16, criterion: '表面金黄有光泽、不粘手、蜜气香', criterionDimension: '色泽', applicable: '甘草、黄芪、桑叶' },
  { id: 'method-007', name: '蒸', auxiliary: '黄酒', auxRatio: 20, fireLevel: '武火', tempRange: [100, 110], duration: 120, criterion: '内外均呈黑褐色、断面油润光亮', criterionDimension: '断面', applicable: '何首乌、地黄' },
  { id: 'method-008', name: '煮', auxiliary: '米醋', auxRatio: 20, fireLevel: '中火', tempRange: [95, 100], duration: 60, criterion: '无白心、断面角质样、有醋香', criterionDimension: '断面', applicable: '延胡索、乌头' },
  { id: 'method-009', name: '燀', auxiliary: '无', auxRatio: 0, fireLevel: '武火', tempRange: [95, 100], duration: 5, criterion: '种皮易脱落、仁无白心', criterionDimension: '断面', applicable: '苦杏仁、桃仁' },
  { id: 'method-010', name: '煅', auxiliary: '无', auxRatio: 0, fireLevel: '武火', tempRange: [300, 500], duration: 45, criterion: '质酥脆、无光泽、断面灰白', criterionDimension: '断面', applicable: '牡蛎、龙骨' },
  { id: 'method-011', name: '麸炒', auxiliary: '麦麸', auxRatio: 12, fireLevel: '文火', tempRange: [120, 150], duration: 9, criterion: '色黄、麸香明显、无焦斑', criterionDimension: '色泽', applicable: '苍术（派生）', derivedFrom: 'method-002' },
  { id: 'method-012', name: '酒炙', auxiliary: '黄酒', auxRatio: 15, fireLevel: '文火', tempRange: [100, 130], duration: 18, criterion: '酒气尽、断面棕褐、色泽均匀', criterionDimension: '断面', applicable: '川芎（派生）', derivedFrom: 'method-003' },
];

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

interface SeedSegmentPlan {
  /** 本段作业班组 */
  team: string;
  /** 本段时长（min） */
  duration: number;
  /** 等待接班的下一班组 */
  nextTeam?: string;
  /** 接班确认人（不填表示该段待接班） */
  confirmedBy?: string;
  /** 交接说明 */
  handoverNote?: string;
}

interface SeedBatchPlan {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: string;
  remark: string;
  /** handover：有待接班段；ready：全部确认待完工判定；locked：已完工并锁定 */
  state: 'handover' | 'ready' | 'locked';
  segments: SeedSegmentPlan[];
}

const SEED_BATCH_PLANS: SeedBatchPlan[] = [
  {
    batchNo: 'PZ-25081', herbId: 'herb-001', methodId: 'method-002', feedKg: 120, auxUsedKg: 12, fireLevel: '中火', remark: '麸炒白术',
    state: 'handover',
    segments: [{ team: '甲班', duration: 5, nextTeam: '乙班', handoverNote: '麦麸已下，色泽初转黄，乙班续炒至麸香出锅' }],
  },
  {
    batchNo: 'PZ-25082', herbId: 'herb-002', methodId: 'method-003', feedKg: 80, auxUsedKg: 8, fireLevel: '文火', remark: '酒炙白芍（甲乙班交接）',
    state: 'ready',
    segments: [
      { team: '甲班', duration: 8, nextTeam: '乙班', confirmedBy: '乙班', handoverNote: '黄酒已吸尽，文火焖润中，注意防焦' },
      { team: '乙班', duration: 7, confirmedBy: '质检员 · 赵敏', handoverNote: '断面棕黄、酒气尽，已出锅待称最终重量' },
    ],
  },
  {
    batchNo: 'PZ-25083', herbId: 'herb-003', methodId: 'method-003', feedKg: 60, auxUsedKg: 6, fireLevel: '文火', remark: '酒炙当归',
    state: 'locked',
    segments: [{ team: '乙班', duration: 15, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25084', herbId: 'herb-004', methodId: 'method-001', feedKg: 45, auxUsedKg: 0, fireLevel: '文火', remark: '清炒陈皮',
    state: 'locked',
    segments: [{ team: '丙班', duration: 12, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25085', herbId: 'herb-005', methodId: 'method-006', feedKg: 200, auxUsedKg: 50, fireLevel: '中火', remark: '蜜炙黄芪（甲班拌润、乙班炒至不粘手）',
    state: 'locked',
    segments: [
      { team: '甲班', duration: 8, nextTeam: '乙班', confirmedBy: '乙班', handoverNote: '蜜水拌匀、焖润透，交乙班文火炒至不粘手' },
      { team: '乙班', duration: 8, confirmedBy: '质检员 · 赵敏', handoverNote: '金黄有光泽、不粘手，出锅' },
    ],
  },
  {
    batchNo: 'PZ-25086', herbId: 'herb-006', methodId: 'method-010', feedKg: 150, auxUsedKg: 0, fireLevel: '武火', remark: '煅牡蛎',
    state: 'locked',
    segments: [{ team: '丙班', duration: 45, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25087', herbId: 'herb-008', methodId: 'method-005', feedKg: 90, auxUsedKg: 1.8, fireLevel: '文火', remark: '盐炙杜仲',
    state: 'locked',
    segments: [{ team: '甲班', duration: 12, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25088', herbId: 'herb-009', methodId: 'method-001', feedKg: 55, auxUsedKg: 0, fireLevel: '文火', remark: '清炒桑叶',
    state: 'locked',
    segments: [{ team: '乙班', duration: 12, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25089', herbId: 'herb-010', methodId: 'method-006', feedKg: 130, auxUsedKg: 32.5, fireLevel: '中火', remark: '蜜炙甘草',
    state: 'locked',
    segments: [{ team: '乙班', duration: 16, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
  {
    batchNo: 'PZ-25090', herbId: 'herb-007', methodId: 'method-002', feedKg: 12, auxUsedKg: 1.2, fireLevel: '中火', remark: '麸炒全蝎',
    state: 'locked',
    segments: [{ team: '丙班', duration: 10, confirmedBy: '质检员 · 赵敏', handoverNote: '单班完成' }],
  },
];

function buildSeedBatches(): ProcessBatch[] {
  return SEED_BATCH_PLANS.map((plan, index) => {
    const method = SEED_METHODS.find((m) => m.id === plan.methodId)!;
    const totalMin = plan.segments.reduce((sum, seg) => sum + seg.duration, 0);
    const endedAt = isoMinutesAgo(45 * (index + 1));

    // 由末段向前倒推每段开始/结束时刻
    let cursor = new Date(endedAt).getTime();
    const segments: ProcessBatch['segments'] = plan.segments
      .map((segPlan, segIndex) => {
        const segEnd = cursor;
        const segStart = segEnd - segPlan.duration * 60_000;
        const confirmed = Boolean(segPlan.confirmedBy);
        const seg: ProcessBatch['segments'][number] = {
          id: `seg-${String(index + 1).padStart(3, '0')}-${segIndex + 1}`,
          seq: segIndex + 1,
          team: segPlan.team,
          nextTeam: segPlan.nextTeam,
          temp: Math.round((method.tempRange[0] + method.tempRange[1]) / 2),
          durationMin: segPlan.duration,
          handoverNote: segPlan.handoverNote ?? '',
          status: confirmed ? '已确认' : '待接班',
          confirmedBy: segPlan.confirmedBy,
          confirmedAt: confirmed ? new Date(segEnd).toISOString() : undefined,
          startedAt: new Date(segStart).toISOString(),
          endedAt: new Date(segEnd).toISOString(),
        };
        cursor = segStart;
        return seg;
      })
      .reverse();

    const startedAt = segments[0].startedAt;
    const locked = plan.state === 'locked';
    const finalized = locked;
    const lastSeg = segments[segments.length - 1];

    if (!locked) {
      return {
        id: `batch-${String(index + 1).padStart(3, '0')}`,
        batchNo: plan.batchNo,
        herbId: plan.herbId,
        methodId: plan.methodId,
        feedKg: plan.feedKg,
        auxUsedKg: plan.auxUsedKg,
        fireLevel: plan.fireLevel as ProcessBatch['fireLevel'],
        startedAt,
        endedAt: lastSeg.endedAt,
        segments,
        finalized: false,
        locked: false,
        remark: plan.remark,
      };
    }

    const yieldRate = Number((expectedYieldOf(method) + ((index % 5) - 2) * 0.8).toFixed(1));
    const outputKg = Number(((plan.feedKg * yieldRate) / 100).toFixed(1));
    const verdict = judgeDegree({
      method,
      fireLevel: plan.fireLevel as ProcessBatch['fireLevel'],
      duration: totalMin,
      temp: lastSeg.temp,
      yieldRate,
    });
    const lockedAt = new Date(new Date(endedAt).getTime() + 30 * 60_000).toISOString();
    return {
      id: `batch-${String(index + 1).padStart(3, '0')}`,
      batchNo: plan.batchNo,
      herbId: plan.herbId,
      methodId: plan.methodId,
      feedKg: plan.feedKg,
      auxUsedKg: plan.auxUsedKg,
      fireLevel: plan.fireLevel as ProcessBatch['fireLevel'],
      startedAt,
      endedAt: lockedAt,
      segments,
      outputKg,
      yieldRate,
      degree: verdict.degree,
      finalized: true,
      finalizedAt: lockedAt,
      locked: true,
      lockedAt,
      qcBy: '质检员 · 赵敏',
      remark: plan.remark,
    };
  });
}

function buildSeedSamples(batches: ProcessBatch[]): RetainSample[] {
  const logs = (date: string, color: string, odor: string, mold: string, observer: string): RetainSample['observeLogs'][number] => ({
    id: `log-${date}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    color,
    odor,
    mold,
    observer,
  });

  return batches.filter((b) => b.finalized).slice(0, 6).map((batch, index) => {
    const retainMonths = [6, 12, 18, 24][index % 4];
    const retainedAt = new Date(Date.now() - (index * 37 + 8) * 86_400_000).toISOString();
    return {
      id: `sample-${String(index + 1).padStart(3, '0')}`,
      sampleNo: `LY-${batch.batchNo}`,
      batchId: batch.id,
      amountG: [200, 300, 500][index % 3],
      retainMonths,
      cabinet: CABINETS[(index * 5) % CABINETS.length],
      retainedAt,
      observeLogs: [
        logs(new Date(retainedAt).toISOString().slice(0, 10), '色泽符合标准', '气味正常', '无霉变', '赵敏'),
        logs(new Date(Date.now() - (index * 11 + 2) * 86_400_000).toISOString().slice(0, 10), '色泽略深', '气味正常', '无霉变', '赵敏'),
      ],
    };
  });
}

/** 首次打开（表内无数据）时写入示例数据；已有数据则不动 */
export async function seedIfEmpty(): Promise<void> {
  const flag = await db.meta.get('seeded');
  if (flag) {
    return;
  }
  const herbCount = await db.herbs.count();
  const methodCount = await db.methods.count();
  const batchCount = await db.batches.count();
  const sampleCount = await db.samples.count();

  await db.transaction('rw', db.herbs, db.methods, db.batches, db.samples, db.meta, async () => {
    if (herbCount === 0) {
      await db.herbs.bulkPut(SEED_HERBS.filter((h) => HERB_ORIGINS.includes(h.origin)));
    }
    if (methodCount === 0) {
      await db.methods.bulkPut(SEED_METHODS.filter((m) => METHOD_NAMES.includes(m.name)));
    }
    const batches = buildSeedBatches();
    if (batchCount === 0) {
      await db.batches.bulkPut(batches);
    }
    if (sampleCount === 0) {
      await db.samples.bulkPut(buildSeedSamples(batches));
    }
    await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
  });
}

/** 清空全部本地数据（用于重置演示环境） */
export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.herbs, db.methods, db.batches, db.samples, db.meta, async () => {
    await Promise.all([db.herbs.clear(), db.methods.clear(), db.batches.clear(), db.samples.clear(), db.meta.clear()]);
  });
  await seedIfEmpty();
}
