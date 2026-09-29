import { Empty, Tag, Timeline, Typography } from 'antd';
import type { HerbMaterial } from '../../types/herb-material';
import type { ProcessingMethod } from '../../types/processing-method';
import type { ProcessBatch, ProcessDegree } from '../../types/process-batch';
import { formatDate } from '../../utils/degree';
import { batchPhase, teamChain, totalDuration, waitingTeam } from '../../utils/segment';

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

/** 炮制工序时间线（首页复用），展示最近批次的方法、火候、分段班组与得率 */
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
        const phase = batchPhase(batch);
        const statusTag =
          phase === 'locked' ? (
            <Tag color="blue">已锁定</Tag>
          ) : phase === 'finalized' ? (
            <Tag color="cyan">待锁定</Tag>
          ) : phase === 'ready' ? (
            <Tag color="green">待判定</Tag>
          ) : (
            <Tag color="orange">待接班{waitingTeam(batch) ? ` · 等${waitingTeam(batch)}` : ''}</Tag>
          );
        return {
          color: batch.degree === '适中' ? 'green' : batch.degree === '太过' ? 'red' : 'orange',
          children: (
            <div>
              <Text strong>{batch.batchNo}</Text>
              {batch.degree ? (
                <Tag style={{ marginLeft: 8 }} color={DEGREE_COLOR[batch.degree]}>
                  {batch.degree}
                </Tag>
              ) : null}
              {statusTag}
              <div style={{ fontSize: 12, color: '#6b7a70' }}>
                {herb?.name ?? '未知药材'} · {method?.name ?? '未知方法'} · {batch.fireLevel} · 累计 {totalDuration(batch)}min ·{' '}
                {formatDate(batch.startedAt)} · 班组 {teamChain(batch).join('→')} ·{' '}
                {typeof batch.yieldRate === 'number' ? `得率 ${batch.yieldRate}%` : '得率待判定'}
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
