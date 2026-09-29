import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch, ProcessSegment } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbherbprocess-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

/** v2 及以前的工序记录结构（v3 分段迁移用） */
interface LegacyBatch {
  id: string;
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: ProcessBatch['fireLevel'];
  startedAt: string;
  endedAt: string;
  yieldRate: number;
  degree?: ProcessBatch['degree'];
  operator?: string;
  locked?: boolean;
  lockedAt?: string;
  qcBy?: string;
  remark?: string;
}

class HerbProcessDB extends Dexie {
  herbs!: Table<HerbMaterial, string>;
  methods!: Table<ProcessingMethod, string>;
  batches!: Table<ProcessBatch, string>;
  samples!: Table<RetainSample, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      herbs: 'id, name, origin, part, batchNo, receivedAt',
      methods: 'id, name, auxiliary, fireLevel',
      batches: 'id, batchNo, herbId, methodId, degree, startedAt',
      samples: 'id, sampleNo, batchId, cabinet, retainedAt',
      meta: 'key',
    });

    // v2：批次表增加 locked 索引（锁定/质检放行查询更快），并回填历史数据的 locked 字段。
    this.version(2)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('batches')
          .toCollection()
          .modify((row: LegacyBatch) => {
            if (typeof row.locked !== 'boolean') {
              row.locked = false;
            }
          });
      });

    // v3：工序记录改为跨班分段。历史记录默认只有一段且已确认；
    // 已锁定的老记录同时视为已完工判定，未锁定的保留得率/程度作为待复核草稿。
    // 升级前请在「导出备份」中导出 JSON。
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const methods = (await tx.table('methods').toArray()) as ProcessingMethod[];
        await tx
          .table('batches')
          .toCollection()
          .modify((row: LegacyBatch & Partial<ProcessBatch>) => {
            // 已具备分段结构（理论上不会出现）则不重复迁移
            if (Array.isArray(row.segments) && row.segments.length > 0) {
              return;
            }
            const method = methods.find((m) => m.id === row.methodId);
            const team = row.operator?.trim() || '甲班';
            const feedKg = Number(row.feedKg) || 0;
            const yieldRate = Number(row.yieldRate) || 0;
            const segment: ProcessSegment = {
              id: `seg-${row.id}`,
              seq: 1,
              team,
              temp: method ? Math.round((method.tempRange[0] + method.tempRange[1]) / 2) : 100,
              durationMin: method?.duration ?? 0,
              handoverNote: '历史记录迁移：默认单段，已接班确认',
              status: '已确认',
              confirmedBy: team,
              confirmedAt: row.endedAt,
              startedAt: row.startedAt,
              endedAt: row.endedAt,
            };
            const locked = row.locked === true;
            row.segments = [segment];
            row.outputKg = feedKg > 0 ? Number(((feedKg * yieldRate) / 100).toFixed(1)) : undefined;
            row.finalized = locked;
            row.finalizedAt = locked ? row.lockedAt ?? row.endedAt : undefined;
            // operator 字段已由分段中的班组取代
            delete (row as Partial<LegacyBatch>).operator;
          });
      });
  }
}

export const db = new HerbProcessDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
