import Dexie, { type Table } from 'dexie';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch, ProcessSegment } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';
import { uid } from './id';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbherbprocess-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

/**
 * v3 迁移：旧版一条工序记录只记一个操作人，没有分段。
 * 统一回填为「只有一段且已确认」，锅温取方法区间中值、时长取方法标准值；
 * 历史记录的 yieldRate/degree 视为完工判定结果，保持原样。
 */
export function migrateBatchSegment(row: ProcessBatch, method?: ProcessingMethod): void {
  if (Array.isArray(row.segments) && row.segments.length > 0) {
    return;
  }
  const temp = method ? Math.round((method.tempRange[0] + method.tempRange[1]) / 2) : 100;
  const durationMin = method?.duration ?? 0;
  const segment: ProcessSegment = {
    id: uid('seg'),
    seq: 1,
    team: '甲班',
    temp,
    durationMin,
    handover: '历史记录迁移：原记录跨班情况未分段，默认单段已确认',
    status: '已确认',
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    confirmedAt: row.endedAt,
    confirmedBy: row.operator ?? '系统迁移',
  };
  row.segments = [segment];
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
    // 升级前请在「导出备份」中导出 JSON。
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
          .modify((row: ProcessBatch) => {
            if (typeof row.locked !== 'boolean') {
              row.locked = false;
            }
          });
      });

    // v3：工序记录改为分段交接（班组/锅温/时长/交接说明），segments 为内嵌数组不建索引；
    // 历史记录回填为单段且已确认，得率与程度判定结果保持不变。
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const methods = await tx.table<ProcessingMethod, string>('methods').toArray();
        const methodMap = new Map(methods.map((m) => [m.id, m]));
        await tx
          .table<ProcessBatch, string>('batches')
          .toCollection()
          .modify((row) => {
            migrateBatchSegment(row, methodMap.get(row.methodId));
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
