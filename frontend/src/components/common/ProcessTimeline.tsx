import { Empty, Tag, Timeline, Typography } from 'antd';
import type { HerbMaterial } from '../../types/herb-material';
import type { ProcessingMethod } from '../../types/processing-method';
import type { ProcessBatch, ProcessDegree } from '../../types/process-batch';
import { allConfirmed, awaitingTeam, totalDuration } from '../../utils/segment';
import { formatDate } from '../../utils/degree';

const { Text } = Typography;

export interface ProcessTimelineProps {
  batches: ProcessBatch[];
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  limit?: number;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = {
  不及: 'orange',
  适中: 'green',
  太过: 'red',
};

/** 炮制工序时间线（首页复用），展示最近批次的方法、火候与得率 */
export default function ProcessTimeline({ batches, herbs, methods, limit = 6 }: ProcessTimelineProps) {
  const rows = batches.slice(0, limit);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无炮制工序记录" />;
  }

  return (
    <Timeline
      items={rows.map((batch) => {
        const herb = herbs.find((h) => h.id === batch.herbId);
        const method = methods.find((m) => m.id === batch.methodId);
        const waitTeam = awaitingTeam(batch);
        const teams = batch.segments.map((s) => s.team).join('→');
        return {
          color: batch.degree === '适中' ? 'green' : batch.degree === '太过' ? 'red' : batch.degree === '不及' ? 'orange' : 'blue',
          children: (
            <div>
              <Text strong>{batch.batchNo}</Text>
              {batch.degree ? (
                <Tag style={{ marginLeft: 8 }} color={DEGREE_COLOR[batch.degree]}>
                  {batch.degree}
                </Tag>
              ) : (
                <Tag style={{ marginLeft: 8 }}>待判定</Tag>
              )}
              {batch.locked ? (
                <Tag color="blue">已锁定</Tag>
              ) : waitTeam ? (
                <Tag color="orange">待接班 · 等{waitTeam}</Tag>
              ) : (
                <Tag color="gold">{allConfirmed(batch) ? '待完工判定' : '加工中'}</Tag>
              )}
              <div style={{ fontSize: 12, color: '#6b7a70' }}>
                {herb?.name ?? '未知药材'} · {method?.name ?? '未知方法'} · {batch.fireLevel} · {formatDate(batch.startedAt)} ·
                累计 {totalDuration(batch)}min · {batch.segments.length} 段（{teams || '—'}）· 得率{' '}
                {batch.yieldRate === undefined ? '待称量' : `${batch.yieldRate}%`}
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
